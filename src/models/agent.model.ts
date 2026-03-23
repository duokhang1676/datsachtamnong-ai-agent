export interface AgentTask {
  id: string;
  goal: string;
  context?: Record<string, unknown>;
}

export interface AgentResult {
  taskId: string;
  output: string;
  metadata?: Record<string, unknown>;
}
