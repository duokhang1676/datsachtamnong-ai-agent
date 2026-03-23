import { Router, type Request, type Response } from "express";

import { getSchedulerOverview, getNextRunTimes } from "../scheduler.js";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  const scheduler = getSchedulerOverview();
  const nextRun = getNextRunTimes(1)[0] ?? null;
  const context = getAgentContextConfig();

  res.status(200).json({
    status: "healthy",
    service: "ai-marketing-agent",
    online: true,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    scheduler: {
      enabled: scheduler.cronEnabled,
      isRunning: scheduler.isRunning,
      cronExpression: scheduler.cronExpression,
      timezone: scheduler.timezone,
      nextRun
    },
    context: {
      imagePlannerModel: context.llm.imagePlannerModel,
      imageProviderOrder: context.image.providerOrder,
      topicsPerRun: context.topic.topicsPerRun
    }
  });
});
