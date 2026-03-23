import { aiClient } from "../services/aiClient.js";
import type { AgentResult, AgentTask } from "../models/agent.model.js";

export class MarketingAgent {
  async execute(task: AgentTask): Promise<AgentResult> {
    const prompt = `Goal: ${task.goal}\nContext: ${JSON.stringify(task.context ?? {})}`;
    const output = await aiClient.generateText(prompt);

    return {
      taskId: task.id,
      output,
      metadata: {
        agent: "marketing"
      }
    };
  }
}
