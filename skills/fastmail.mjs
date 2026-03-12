#!/usr/bin/env node

// FastMail JMAP skill — send, read, and reply to email as Koochi.
// Uses the JMAP protocol (RFC 8620) with FastMail's API.
//
// Usage:
//   node fastmail.mjs send "to@example.com" "Subject" "Body text"
//   node fastmail.mjs inbox [limit]
//   node fastmail.mjs read <messageId>
//   node fastmail.mjs reply <messageId> "Body text"
//
// Requires FASTMAIL_API_TOKEN in the environment.

const API = "https://api.fastmail.com/jmap/api/";
const ACCOUNT_ID = "u53d64052";
const IDENTITY_ID = "176981127"; // koochi@fastmail.com

const TOKEN = process.env.FASTMAIL_API_TOKEN;
if (!TOKEN) {
  console.error("Error: FASTMAIL_API_TOKEN not set");
  process.exit(1);
}

// Core JMAP helper — wraps every API call
async function jmap(methodCalls, using = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"]) {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ using, methodCalls }),
  });
  if (!res.ok) throw new Error(`JMAP request failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.methodResponses;
}

// --- Commands ---

async function send(to, subject, body) {
  // Step 1: Find the Drafts mailbox
  const mbRes = await jmap([
    ["Mailbox/query", { accountId: ACCOUNT_ID, filter: { role: "drafts" } }, "0"],
  ]);
  const draftsId = mbRes[0][1].ids[0];

  // Step 2: Create draft + submit in one call
  const responses = await jmap(
    [
      [
        "Email/set",
        {
          accountId: ACCOUNT_ID,
          create: {
            draft: {
              mailboxIds: { [draftsId]: true },
              from: [{ name: "Koochi", email: "koochi@fastmail.com" }],
              to: [{ email: to }],
              subject,
              bodyValues: { body: { value: body } },
              textBody: [{ partId: "body", type: "text/plain" }],
            },
          },
        },
        "1",
      ],
      [
        "EmailSubmission/set",
        {
          accountId: ACCOUNT_ID,
          create: {
            sub: {
              emailId: "#draft",
              identityId: IDENTITY_ID,
            },
          },
        },
        "2",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
  );

  const emailSet = responses[0][1];
  const subSet = responses[1][1];

  if (emailSet.notCreated?.draft) {
    console.error("Failed to create draft:", JSON.stringify(emailSet.notCreated.draft));
    process.exit(1);
  }
  if (subSet.notCreated?.sub) {
    console.error("Failed to submit email:", JSON.stringify(subSet.notCreated.sub));
    process.exit(1);
  }

  console.log(`Sent email to ${to}: "${subject}"`);
}

async function inbox(limit = 10) {
  // Query + fetch in one call using result reference
  const responses = await jmap([
    [
      "Email/query",
      {
        accountId: ACCOUNT_ID,
        filter: { inMailbox: null }, // filled below
        sort: [{ property: "receivedAt", isAscending: false }],
        limit,
      },
      "0",
    ],
    [
      "Email/get",
      {
        accountId: ACCOUNT_ID,
        "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
        properties: ["id", "from", "subject", "receivedAt", "keywords"],
      },
      "1",
    ],
  ]);

  // First, find the Koochi mailbox so we only show Koochi's mail
  const mbRes = await jmap([
    ["Mailbox/query", { accountId: ACCOUNT_ID, filter: { name: "Koochi" } }, "0"],
    [
      "Mailbox/get",
      {
        accountId: ACCOUNT_ID,
        "#ids": { resultOf: "0", name: "Mailbox/query", path: "/ids" },
      },
      "1",
    ],
  ]);

  const koochiFolderId = mbRes[0][1].ids?.[0];

  // Re-query with the Koochi folder filter
  const filtered = await jmap([
    [
      "Email/query",
      {
        accountId: ACCOUNT_ID,
        filter: koochiFolderId ? { inMailbox: koochiFolderId } : {},
        sort: [{ property: "receivedAt", isAscending: false }],
        limit,
      },
      "0",
    ],
    [
      "Email/get",
      {
        accountId: ACCOUNT_ID,
        "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
        properties: ["id", "from", "subject", "receivedAt", "keywords"],
      },
      "1",
    ],
  ]);

  const emails = filtered[1][1].list || [];
  if (emails.length === 0) {
    console.log("No emails found.");
    return;
  }

  for (const e of emails) {
    const from = e.from?.[0]?.email || "unknown";
    const read = e.keywords?.$seen ? " " : "*";
    console.log(`${read} ${e.id}  ${e.receivedAt}  ${from}  ${e.subject || "(no subject)"}`);
  }
}

async function read(messageId) {
  const responses = await jmap([
    [
      "Email/get",
      {
        accountId: ACCOUNT_ID,
        ids: [messageId],
        properties: ["id", "from", "to", "subject", "receivedAt", "textBody", "bodyValues", "messageId", "inReplyTo", "references"],
        fetchTextBodyValues: true,
      },
      "0",
    ],
  ]);

  const email = responses[0][1].list?.[0];
  if (!email) {
    console.error(`Email ${messageId} not found`);
    process.exit(1);
  }

  const from = email.from?.map((a) => `${a.name || ""} <${a.email}>`).join(", ") || "unknown";
  const to = email.to?.map((a) => `${a.name || ""} <${a.email}>`).join(", ") || "unknown";

  console.log(`From: ${from}`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${email.subject || "(no subject)"}`);
  console.log(`Date: ${email.receivedAt}`);
  console.log(`Message-ID: ${email.messageId?.[0] || "n/a"}`);
  console.log(`---`);

  // Body values are keyed by partId, on the email object itself
  const bodyValues = email.bodyValues || {};
  const bodyParts = email.textBody || [];
  for (const part of bodyParts) {
    const value = bodyValues[part.partId]?.value;
    if (value) console.log(value);
  }
}

async function reply(messageId, body) {
  // Fetch original email to get threading headers
  const origRes = await jmap([
    [
      "Email/get",
      {
        accountId: ACCOUNT_ID,
        ids: [messageId],
        properties: ["from", "subject", "messageId", "references"],
      },
      "0",
    ],
  ]);

  const orig = origRes[0][1].list?.[0];
  if (!orig) {
    console.error(`Email ${messageId} not found`);
    process.exit(1);
  }

  const replyTo = orig.from?.[0]?.email;
  if (!replyTo) {
    console.error("Cannot determine reply address");
    process.exit(1);
  }

  // Build References header: original's References + original's Message-ID
  const refs = [...(orig.references || []), ...(orig.messageId || [])];
  const subject = orig.subject?.startsWith("Re: ") ? orig.subject : `Re: ${orig.subject || ""}`;

  // Find Drafts mailbox
  const mbRes = await jmap([
    ["Mailbox/query", { accountId: ACCOUNT_ID, filter: { role: "drafts" } }, "0"],
  ]);
  const draftsId = mbRes[0][1].ids[0];

  // Create reply + submit
  const responses = await jmap(
    [
      [
        "Email/set",
        {
          accountId: ACCOUNT_ID,
          create: {
            draft: {
              mailboxIds: { [draftsId]: true },
              from: [{ name: "Koochi", email: "koochi@fastmail.com" }],
              to: [{ email: replyTo }],
              subject,
              inReplyTo: orig.messageId || [],
              references: refs,
              bodyValues: { body: { value: body } },
              textBody: [{ partId: "body", type: "text/plain" }],
            },
          },
        },
        "1",
      ],
      [
        "EmailSubmission/set",
        {
          accountId: ACCOUNT_ID,
          create: {
            sub: {
              emailId: "#draft",
              identityId: IDENTITY_ID,
            },
          },
        },
        "2",
      ],
    ],
    ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail", "urn:ietf:params:jmap:submission"],
  );

  if (responses[0][1].notCreated?.draft) {
    console.error("Failed to create reply:", JSON.stringify(responses[0][1].notCreated.draft));
    process.exit(1);
  }

  console.log(`Replied to ${replyTo}: "${subject}"`);
}

// --- CLI dispatch ---

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "send":
    if (args.length < 3) { console.error("Usage: fastmail.mjs send <to> <subject> <body>"); process.exit(1); }
    await send(args[0], args[1], args[2]);
    break;
  case "inbox":
    await inbox(parseInt(args[0]) || 10);
    break;
  case "read":
    if (!args[0]) { console.error("Usage: fastmail.mjs read <messageId>"); process.exit(1); }
    await read(args[0]);
    break;
  case "reply":
    if (args.length < 2) { console.error("Usage: fastmail.mjs reply <messageId> <body>"); process.exit(1); }
    await reply(args[0], args[1]);
    break;
  default:
    console.error("Commands: send, inbox, read, reply");
    console.error("  send <to> <subject> <body>");
    console.error("  inbox [limit]");
    console.error("  read <messageId>");
    console.error("  reply <messageId> <body>");
    process.exit(1);
}
