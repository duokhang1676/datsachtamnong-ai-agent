import { Router, type Request, type Response } from "express";

import { publishPost, type PublishPostInput } from "../services/publishService.js";
import { getLatestPendingArticle, getPendingArticleById } from "../services/pendingArticleStore.js";

type ApprovalStatus = "approved" | "rejected";

const articleStatusStore = new Map<string, ApprovalStatus>();

const getLatestArticle = (): (PublishPostInput & { id: string }) | null => {
	const payload = (globalThis as any).latestArticle;
	if (!payload) {
		return null;
	}

	return payload as PublishPostInput & { id: string };
};

const publishArticle = (id: string): void => {
	console.log(`Publishing article ${id}`);
};

const getErrorReason = (error: unknown): string => {
	if (error instanceof Error && error.message.trim()) {
		return error.message.trim();
	}

	const maybeError = error as any;
	const fromApi = maybeError?.response?.data?.message;
	if (typeof fromApi === "string" && fromApi.trim()) {
		return fromApi.trim();
	}

	const fromCause = maybeError?.cause?.message;
	if (typeof fromCause === "string" && fromCause.trim()) {
		return fromCause.trim();
	}

	const fromCode = maybeError?.code;
	if (typeof fromCode === "string" && fromCode.trim()) {
		return fromCode.trim();
	}

	return "Unknown publish error";
};

export const approvalRouter = Router();

approvalRouter.get("/approve/:id", async (req: Request, res: Response) => {
	const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
	if (!id) {
		res.status(400).json({ message: "id is required" });
		return;
	}
	articleStatusStore.set(id, "approved");

	try {
		const articleById = await getPendingArticleById(id);
		const latestArticle = articleById ?? getLatestArticle() ?? await getLatestPendingArticle();
		if (!latestArticle) {
			res.status(404).json({
				id,
				status: "approved",
				message: "No latestArticle found to publish"
			});
			return;
		}

		const published = await publishPost(latestArticle);
		publishArticle(id);

		res.status(200).json({
			id,
			status: "approved",
			message: "Article approved and published",
			published
		});
	} catch (error) {
		console.error("[approvalRoutes] Failed to publish approved article:", error);
		const reason = getErrorReason(error);
		res.status(500).json({
			id,
			status: "approved",
			message: "Article approved but publishing failed",
			reason
		});
	}
});

approvalRouter.get("/reject/:id", (req: Request, res: Response) => {
	const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
	if (!id) {
		res.status(400).json({ message: "id is required" });
		return;
	}
	articleStatusStore.set(id, "rejected");

	res.status(200).json({
		id,
		status: "rejected",
		message: "Article rejected"
	});
});

export default approvalRouter;
