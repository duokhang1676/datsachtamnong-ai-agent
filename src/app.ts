import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import cors from "cors";

import { apiRouter } from "./routes/index.js";
import approvalRoutes from "./routes/approvalRoutes.js";
import { startContentPublishScheduler } from "./scheduler.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
	res.status(200).send("AI Agent running");
});

app.use("/", approvalRoutes);
app.use("/api", apiRouter);

startContentPublishScheduler();

app.listen(PORT, () => {
	console.log(`Server running on port ${PORT}`);
});
