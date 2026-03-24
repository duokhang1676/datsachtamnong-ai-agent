import textToSpeech from "@google-cloud/text-to-speech";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

// Ensure audio directory exists
const AUDIO_DIR = path.join(process.cwd(), "data", "audio");
const DEFAULT_TTS_BASE_URL = "http://localhost:4000";
const MAX_CHARS_PER_REQUEST = 4500;

let ttsClient: textToSpeech.TextToSpeechClient | null = null;

export interface TTSGenerateOptions {
	text: string;
	lang?: string;
	slow?: boolean;
}

const normalizePrivateKey = (value: string): string => {
	return value
		.trim()
		.replace(/\r\n/g, "\n")
		.replace(/\\r\\n/g, "\n")
		.replace(/\\\\n/g, "\n")
		.replace(/\\n/g, "\n");
};

const parseCredentialsJson = (rawCredentials: string): {
	project_id?: string;
	client_email?: string;
	private_key?: string;
} => {
	const trimmed = rawCredentials.trim();
	const unwrapped = (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	)
		? trimmed.slice(1, -1)
		: trimmed;

	try {
		return JSON.parse(unwrapped);
	} catch {
		// Some environments escape quotes in JSON string values.
		return JSON.parse(unwrapped.replace(/\\"/g, '"'));
	}
};

const buildClientFromEnv = (): textToSpeech.TextToSpeechClient => {
	const rawCredentials = process.env.GCP_TTS_CREDENTIALS_JSON?.trim();

	if (rawCredentials) {
		const parsed = parseCredentialsJson(rawCredentials);

		if (!parsed.client_email || !parsed.private_key) {
			throw new Error("GCP_TTS_CREDENTIALS_JSON is missing client_email or private_key");
		}

		const normalizedPrivateKey = normalizePrivateKey(parsed.private_key);
		if (!normalizedPrivateKey.includes("BEGIN PRIVATE KEY") || !normalizedPrivateKey.includes("END PRIVATE KEY")) {
			throw new Error("GCP_TTS_CREDENTIALS_JSON.private_key has invalid format. Check newline escaping in Render env.");
		}

		return new textToSpeech.TextToSpeechClient({
			projectId: process.env.GCP_PROJECT_ID?.trim() || parsed.project_id,
			credentials: {
				client_email: parsed.client_email,
				private_key: normalizedPrivateKey
			}
		});
	}

	// Fall back to Google Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)
	return new textToSpeech.TextToSpeechClient({
		projectId: process.env.GCP_PROJECT_ID?.trim() || undefined
	});
};

const getTtsClient = (): textToSpeech.TextToSpeechClient => {
	if (!ttsClient) {
		ttsClient = buildClientFromEnv();
	}

	return ttsClient;
};

const normalizeLanguageCode = (lang?: string): string => {
	const value = (lang ?? "vi-VN").trim();
	if (!value) {
		return "vi-VN";
	}

	if (value.toLowerCase() === "vi") {
		return "vi-VN";
	}

	if (value.includes("-")) {
		return value;
	}

	return `${value}-${value.toUpperCase()}`;
};

const resolveVoiceName = (languageCode: string): string => {
	const fromEnv = process.env.GCP_TTS_VOICE_NAME?.trim();
	if (fromEnv) {
		return fromEnv;
	}

	if (languageCode.startsWith("vi")) {
		return "vi-VN-Neural2-A";
	}

	return "";
};

const chunkText = (input: string, maxChars: number): string[] => {
	const cleaned = input.replace(/\s+/g, " ").trim();
	if (!cleaned) {
		return [];
	}

	if (cleaned.length <= maxChars) {
		return [cleaned];
	}

	const sentences = cleaned.split(/(?<=[.!?])\s+/);
	const chunks: string[] = [];
	let current = "";

	for (const sentence of sentences) {
		if (!sentence) {
			continue;
		}

		if (!current) {
			if (sentence.length <= maxChars) {
				current = sentence;
				continue;
			}

			for (let i = 0; i < sentence.length; i += maxChars) {
				chunks.push(sentence.slice(i, i + maxChars));
			}
			continue;
		}

		const next = `${current} ${sentence}`;
		if (next.length <= maxChars) {
			current = next;
			continue;
		}

		chunks.push(current);
		if (sentence.length <= maxChars) {
			current = sentence;
			continue;
		}

		for (let i = 0; i < sentence.length; i += maxChars) {
			const segment = sentence.slice(i, i + maxChars);
			if (segment.length === maxChars) {
				chunks.push(segment);
			} else {
				current = segment;
			}
		}
	}

	if (current) {
		chunks.push(current);
	}

	return chunks;
};

const audioToBuffer = (audioContent: Uint8Array | Buffer | string | null | undefined): Buffer => {
	if (!audioContent) {
		throw new Error("Google TTS returned empty audio content");
	}

	if (Buffer.isBuffer(audioContent)) {
		return audioContent;
	}

	if (audioContent instanceof Uint8Array) {
		return Buffer.from(audioContent);
	}

	if (typeof audioContent === "string") {
		return Buffer.from(audioContent, "base64");
	}

	throw new Error("Unsupported audio content type returned by Google TTS");
};

const getPublicBaseUrl = (): string => {
	const value = (process.env.AGENT_BASE_URL || process.env.APP_BASE_URL || DEFAULT_TTS_BASE_URL).trim();
	return value.replace(/\/$/, "");
};

/**
	* Generate audio file using Google Cloud Text-to-Speech API.
 */
export async function generateAudioFile(options: TTSGenerateOptions): Promise<{
	filename: string;
	url: string;
	path: string;
}> {
	const { text, lang = "vi", slow = false } = options;
	const languageCode = normalizeLanguageCode(lang);
	const voiceName = resolveVoiceName(languageCode);

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
		.update(`${text}:${languageCode}:${voiceName}:${slow ? "slow" : "fast"}`)
		.digest("hex");
	const filename = `${hash}.mp3`;
	const filePath = path.join(AUDIO_DIR, filename);

	// Check if file already exists
	try {
		await fs.access(filePath);
		console.log(`[ttsService] Audio file already exists: ${filename}`);
		const baseUrl = getPublicBaseUrl();
		return {
			filename,
			url: `${baseUrl}/api/tts/audio/${filename}`,
			path: filePath
		};
	} catch {
		// File doesn't exist, generate it
	}

	try {
		const client = getTtsClient();
		const chunks = chunkText(text, MAX_CHARS_PER_REQUEST);
		if (chunks.length === 0) {
			throw new Error("Text is empty after normalization");
		}

		const buffers: Buffer[] = [];
		for (const chunk of chunks) {
			const request: textToSpeech.protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
				input: { text: chunk },
				voice: {
					languageCode,
					name: voiceName || undefined
				},
				audioConfig: {
					audioEncoding: "MP3",
					speakingRate: slow ? 0.85 : 1.0
				}
			};

			const [response] = await client.synthesizeSpeech(request);
			buffers.push(audioToBuffer(response.audioContent));
		}

		await fs.writeFile(filePath, Buffer.concat(buffers));
		console.log(`[ttsService] Audio generated via Google Cloud TTS: ${filename}`);

		const baseUrl = getPublicBaseUrl();
		return {
			filename,
			url: `${baseUrl}/api/tts/audio/${filename}`,
			path: filePath
		};
	} catch (error: any) {
		console.error(`[ttsService] Error generating audio:`, error);
		const errorMsg = error?.message || "Unknown error";
		throw new Error(`Failed to generate TTS audio: ${errorMsg}`);
	}
}

/**
 * Get audio file path
 */
export async function getAudioFilePath(filename: string): Promise<string> {
	if (!/^[a-f0-9]{32}\.mp3$/i.test(filename)) {
		throw new Error("Invalid filename format");
	}

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
