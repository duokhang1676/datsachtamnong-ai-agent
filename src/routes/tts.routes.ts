import express, { Router, Request, Response } from "express";
import { generateAudioFile, getAudioFilePath } from "../services/ttsService.js";

const router = Router();

interface TTSGenerateRequest {
	text: string;
	lang?: string;
	slow?: boolean;
}

/**
 * POST /api/tts/generate
 * Generate audio from text using gTTS
 */
router.post("/generate", async (req: Request, res: Response) => {
	try {
		const { text, lang = "vi", slow = false } = req.body as TTSGenerateRequest;

		if (!text || typeof text !== "string") {
			return res.status(400).json({
				success: false,
				error: "Text is required and must be a string"
			});
		}

		const result = await generateAudioFile({
			text: text.trim(),
			lang,
			slow
		});

		res.json({
			success: true,
			data: result
		});
	} catch (error: any) {
		console.error("[tts-routes] Error:", error);
		res.status(500).json({
			success: false,
			error: error.message || "Failed to generate audio"
		});
	}
});

/**
 * GET /api/tts/audio/:filename
 * Serve generated audio file
 */
router.get("/audio/:filename", async (req: Request, res: Response) => {
	try {
		const { filename } = req.params;
		if (typeof filename !== "string") {
			return res.status(400).json({
				success: false,
				error: "Invalid filename"
			});
		}
		const filePath = await getAudioFilePath(filename);

		res.header("Content-Type", "audio/mpeg");
		res.header("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
		res.sendFile(filePath);
	} catch (error: any) {
		console.error("[tts-routes] Error serving audio:", error);
		res.status(404).json({
			success: false,
			error: error.message || "Audio file not found"
		});
	}
});

export default router;
