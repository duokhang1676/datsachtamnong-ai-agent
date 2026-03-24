import { Router } from "express";

import { healthRouter } from "./health.routes.js";
import { agentRouter } from "./agent.routes.js";
import { approvalRouter } from "./approvalRoutes.js";
import { agentAdminRouter } from "./agentAdmin.routes.js";
import ttsRouter from "./tts.routes.js";

export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/agents", agentRouter);
apiRouter.use("/approval", approvalRouter);
apiRouter.use("/agent-admin", agentAdminRouter);
apiRouter.use("/tts", ttsRouter);
