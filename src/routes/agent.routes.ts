import { Router, type Request, type Response } from "express";

import { runMarketingWorkflow } from "../workflows/runMarketingWorkflow.js";

export const agentRouter = Router();

agentRouter.post("/run", async (req: Request, res: Response) => {
  const goal = String(req.body?.goal ?? "").trim();
  const context = req.body?.context;

  if (!goal) {
    res.status(400).json({ message: "goal is required" });
    return;
  }

  const result = await runMarketingWorkflow({
    id: crypto.randomUUID(),
    goal,
    context: typeof context === "object" && context !== null ? context : undefined
  });

  res.status(200).json(result);
});
