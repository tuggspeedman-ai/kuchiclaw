// Shared type definitions for KuchiClaw

/** MCP server configuration — matches the format expected by Claude Agent SDK */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Input passed to the container via stdin */
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  /** Chat ID where the message originated — used for IPC replies */
  chatId?: string;
  secrets: Record<string, string>;
  /** System prompt built from living files (SOUL.md + TOOLS.md + MEMORY.md + CONTEXT.md) */
  systemPrompt?: string;
  /** Recent message history formatted for injection into the prompt */
  messageHistory?: string;
  /** MCP server configs to pass to the SDK */
  mcpServers?: Record<string, McpServerConfig>;
}

/** IPC request written by the container to the mounted IPC directory */
export interface IpcRequest {
  /** Operation type */
  op: "message";
  /** Target chat ID */
  chatId: string;
  /** Message text to send */
  text: string;
  /** Group that originated this request (for authorization) */
  group: string;
}

/** Output received from the container via stdout sentinel markers */
export interface ContainerOutput {
  status: "success" | "error";
  result?: string;
  newSessionId?: string;
  error?: string;
}
