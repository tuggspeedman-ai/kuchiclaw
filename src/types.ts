// Shared type definitions for KuchiClaw

/** Input passed to the container via stdin */
export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  secrets: Record<string, string>;
}

/** Output received from the container via stdout sentinel markers */
export interface ContainerOutput {
  status: "success" | "error";
  result?: string;
  newSessionId?: string;
  error?: string;
}
