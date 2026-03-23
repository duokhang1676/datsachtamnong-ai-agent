import { MarketingAgent } from "../agents/marketingAgent.js";
import type { AgentResult, AgentTask } from "../models/agent.model.js";

const marketingAgent = new MarketingAgent();

export const runMarketingWorkflow = async (task: AgentTask): Promise<AgentResult> => {
  return marketingAgent.execute(task);
};
