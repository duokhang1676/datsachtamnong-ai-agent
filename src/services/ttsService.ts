import { exec } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";

const execAsync = promisify(exec);

// Ensure audio directory exists
const AUDIO_DIR = path.join(process.cwd(), "data", "audio");

export interface TTSGenerateOptions {
	text: string;
	lang?: string; // default: 'vi' for Vietnamese
	slow?: boolean;
}

/**
 * Generate audio file using gTTS (Google Text-to-Speech)
 * Requires Python gTTS: pip install gtts
 */
export async function generateAudioFile(options: TTSGenerateOptions): Promise<{
	filename: string;
	url: string;
	path: string;
}> {
	const { text, lang = "vi", slow = false } = options;

	if (!text || text.trim().length === 0) {
		throw new Error("Text cannot be empty");
	}

	// Ensure audio directory exists
	try {
		await fs.mkdir(AUDIO_DIR, { recursive: true });
	} catch (err) {
		console.error("[ttsService] Error creating audio directory:", err);
	}

	// Generate unique filename based on hash of text + lang
	const hash = crypto
		.createHash("md5")
		.update(`${text}:${lang}:${slow ? "slow" : "fast"}`)
		.digest("hex");
	const filename = `${hash}.mp3`;
	const filePath = path.join(AUDIO_DIR, filename);
	const relativePath = path.relative(process.cwd(), filePath);

	// Check if file already exists
	try {
		await fs.access(filePath);
		console.log(`[ttsService] Audio file already exists: ${filename}`);
		const baseUrl = (process.env.AGENT_BASE_URL || process.env.APP_BASE_URL || `http://localhost:4000`).trim();
		return {
			filename,
			url: `${baseUrl}/api/tts/audio/${filename}`,
			path: filePath
		};
	} catch {
		// File doesn't exist, generate it
	}

	try {
		// Escape text for shell and Python
		const escapedText = text.replace(/'/g, "'\\''").replace(/"/g, '\\"');
		
		// Build gtts command
		const slowFlag = slow ? "-slow" : "";
		const command = `gtts-cli '${escapedText}' -l ${lang} ${slowFlag} -o "${filePath}"`;

		console.log(`[ttsService] Generating audio: ${filename}`);
		const { stdout, stderr } = await execAsync(command);

		if (stderr && stderr.trim()) {
			console.warn(`[ttsService] gTTS warning: ${stderr}`);
		}

		console.log(`[ttsService] Audio generated successfully: ${filename}`);

		const baseUrl = (process.env.AGENT_BASE_URL || process.env.APP_BASE_URL || `http://localhost:4000`).trim();
		return {
			filename,
			url: `${baseUrl}/api/tts/audio/${filename}`,
			path: filePath
		};
	} catch (error: any) {
		console.error(`[ttsService] Error generating audio:`, error);
		const errorMsg = error.stderr || error.message || "Unknown error";
		throw new Error(`Failed to generate TTS audio: ${errorMsg}`);
	}
}

/**
 * Get audio file path
 */
export async function getAudioFilePath(filename: string): Promise<string> {
	const filePath = path.join(AUDIO_DIR, filename);

	// Security: prevent directory traversal
	if (!filePath.startsWith(AUDIO_DIR)) {
		throw new Error("Invalid filename");
	}

	try {
		await fs.access(filePath);
		return filePath;
	} catch {
		throw new Error(`Audio file not found: ${filename}`);
	}
}

/**
 * Clean old audio files (optional maintenance)
 */
export async function cleanOldAudioFiles(maxAgeHours: number = 24): Promise<number> {
	try {
		const files = await fs.readdir(AUDIO_DIR);
		const now = Date.now();
		let deletedCount = 0;

		for (const file of files) {
			if (!file.endsWith(".mp3")) continue;

			const filePath = path.join(AUDIO_DIR, file);
			const stats = await fs.stat(filePath);
			const ageHours = (now - stats.mtimeMs) / (1000 * 60 * 60);

			if (ageHours > maxAgeHours) {
				await fs.unlink(filePath);
				deletedCount++;
				console.log(`[ttsService] Deleted old audio file: ${file}`);
			}
		}

		return deletedCount;
	} catch (error) {
		console.error("[ttsService] Error cleaning old audio files:", error);
		return 0;
	}
}
