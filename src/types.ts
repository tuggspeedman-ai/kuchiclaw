// Shared type definitions for KuchiClaw

/** Input passed to the container via stdin */
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  secrets: Record<string, string>;
  /** System prompt built from living files (SOUL.md + TOOLS.md + MEMORY.md + CONTEXT.md) */
  systemPrompt?: string;
  /** Recent message history formatted for injection into the prompt */
  messageHistory?: string;
}

/** Output received from the container via stdout sentinel markers */
export interface ContainerOutput {
  status: "success" | "error";
  result?: string;
  newSessionId?: string;
  error?: string;
}
