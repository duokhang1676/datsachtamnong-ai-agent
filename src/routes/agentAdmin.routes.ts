import { Router, type Request, type Response } from "express";

import { getSchedulerOverview, getSchedulerRuns, triggerContentWorkflowNow, getNextRunTimes, getNextRunTimesPreview, validateCronExpression, validateTimezone, updateSchedulerConfig } from "../scheduler.js";
import { getAgentContextConfig, saveAgentContextConfig, resetAgentContextConfig } from "../services/agentContextConfigService.js";

export const agentAdminRouter = Router();

agentAdminRouter.get("/dashboard", (_req: Request, res: Response) => {
  const data = getSchedulerOverview();
  res.status(200).json({
    success: true,
    data
  });
});

agentAdminRouter.get("/runs", (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 20);
  const statusValue = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
  const status = (statusValue === "queued" || statusValue === "running" || statusValue === "success" || statusValue === "failed")
    ? statusValue
    : undefined;

  const runs = getSchedulerRuns(Number.isFinite(limit) ? limit : 20, status);

  res.status(200).json({
    success: true,
    count: runs.length,
    data: runs
  });
});

agentAdminRouter.post("/runs/trigger", async (_req: Request, res: Response) => {
  void triggerContentWorkflowNow();

  res.status(202).json({
    success: true,
    message: "Workflow trigger accepted"
  });
});

agentAdminRouter.get("/config", (_req: Request, res: Response) => {
  const overview = getSchedulerOverview();
  const nextRunTimes = getNextRunTimes(5);

  res.status(200).json({
    success: true,
    data: {
      cronEnabled: overview.cronEnabled,
      cronExpression: overview.cronExpression,
      timezone: overview.timezone,
      runOnStartup: overview.runOnStartup,
      nextRunTimes
    }
  });
});

agentAdminRouter.post("/config/validate", (req: Request, res: Response) => {
  const { expression, timezone } = req.body;

  if (expression !== undefined && typeof expression !== "string") {
    return res.status(400).json({
      success: false,
      error: "expression must be a string"
    });
  }

  if (timezone !== undefined && typeof timezone !== "string") {
    return res.status(400).json({
      success: false,
      error: "timezone must be a string"
    });
  }

  // Validate expression
  if (expression !== undefined && expression !== null) {
    const validation = validateCronExpression(expression);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }
  }

  // Validate timezone
  if (timezone !== undefined && timezone !== null) {
    const validation = validateTimezone(timezone);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }
  }

  const overview = getSchedulerOverview();
  const expressionToUse = typeof expression === "string" ? expression : overview.cronExpression;
  const timezoneToUse = typeof timezone === "string" ? timezone : overview.timezone;
  const nextRunTimes = getNextRunTimesPreview(expressionToUse, timezoneToUse, 5);

  res.status(200).json({
    success: true,
    message: "Configuration is valid",
    data: {
      nextRunTimes
    }
  });
});

agentAdminRouter.put("/config", (req: Request, res: Response) => {
  const { expression, timezone, enabled, runOnStartup } = req.body;

  if (expression !== undefined && typeof expression !== "string") {
    return res.status(400).json({
      success: false,
      error: "expression must be a string"
    });
  }

  if (timezone !== undefined && typeof timezone !== "string") {
    return res.status(400).json({
      success: false,
      error: "timezone must be a string"
    });
  }

  if (enabled !== undefined && typeof enabled !== "boolean") {
    return res.status(400).json({
      success: false,
      error: "enabled must be a boolean"
    });
  }

  if (runOnStartup !== undefined && typeof runOnStartup !== "boolean") {
    return res.status(400).json({
      success: false,
      error: "runOnStartup must be a boolean"
    });
  }

  if (expression === undefined && timezone === undefined && enabled === undefined && runOnStartup === undefined) {
    return res.status(400).json({
      success: false,
      error: "At least one config field must be provided"
    });
  }

  const result = updateSchedulerConfig({
    expression,
    timezone,
    enabled,
    runOnStartup
  });

  if (!result.success) {
    return res.status(400).json({
      success: false,
      error: result.error
    });
  }

  const overview = getSchedulerOverview();
  const nextRunTimes = getNextRunTimes(5);

  res.status(200).json({
    success: true,
    message: "Configuration updated successfully",
    data: {
      cronEnabled: overview.cronEnabled,
      cronExpression: overview.cronExpression,
      timezone: overview.timezone,
      runOnStartup: overview.runOnStartup,
      nextRunTimes
    }
  });
});

agentAdminRouter.get("/context", (_req: Request, res: Response) => {
  const data = getAgentContextConfig();

  res.status(200).json({
    success: true,
    data
  });
});

agentAdminRouter.put("/context", (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({
      success: false,
      error: "Request body must be an object"
    });
  }

  try {
    const updated = saveAgentContextConfig(req.body);

    return res.status(200).json({
      success: true,
      message: "Agent context updated successfully",
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update agent context"
    });
  }
});

agentAdminRouter.post("/context/reset", (_req: Request, res: Response) => {
  const reset = resetAgentContextConfig();

  res.status(200).json({
    success: true,
    message: "Agent context reset to defaults",
    data: reset
  });
});
