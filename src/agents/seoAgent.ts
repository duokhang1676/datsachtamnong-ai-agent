import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

dotenv.config();

export interface SeoOptimizationResult {
	seoTitle: string;
	metaDescription: string;
	tags: string[];
	summary: string;
}

const parseSeoResult = (rawText: string): SeoOptimizationResult => {
	const start = rawText.indexOf("{");
	const end = rawText.lastIndexOf("}");

	if (start === -1 || end === -1 || end < start) {
		throw new Error("Model did not return a JSON object.");
	}

	const jsonSegment = rawText.slice(start, end + 1);
	const parsed = JSON.parse(jsonSegment) as Partial<SeoOptimizationResult>;

	const seoTitle = typeof parsed.seoTitle === "string" ? parsed.seoTitle.trim() : "";
	const metaDescription = typeof parsed.metaDescription === "string" ? parsed.metaDescription.trim() : "";
	const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
	const tags = Array.isArray(parsed.tags)
		? parsed.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)
		: [];

	if (!seoTitle || !metaDescription || !summary || tags.length === 0) {
		throw new Error("Invalid SEO JSON format returned by model.");
	}

	return {
		seoTitle,
		metaDescription,
		tags,
		summary
	};
};

export const createSeoAgent = (): ChatOpenAI => {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set.");
	}

	const contextConfig = getAgentContextConfig();

	return new ChatOpenAI({
		openAIApiKey: process.env.OPENAI_API_KEY,
		model: contextConfig.llm.seoModel,
		temperature: contextConfig.llm.seoTemperature
	});
};

export const optimizeArticleSeo = async (articleContent: string): Promise<SeoOptimizationResult> => {
	const content = articleContent.trim();

	if (!content) {
		throw new Error("article content is required.");
	}

	const contextConfig = getAgentContextConfig();
	const seoConfig = contextConfig.seo;
	const agent = createSeoAgent();

	const prompt = [
		seoConfig.systemPrompt,
		seoConfig.metadataInstruction,
		"Yêu cầu phản hồi chỉ là JSON hợp lệ, không thêm markdown hoặc giải thích.",
		"Cấu trúc JSON bắt buộc:",
		...seoConfig.jsonSchemaLines,
		"Quy tắc:",
		...seoConfig.rules.map((rule) => `- ${rule}`),
		"Bài viết đầu vào:",
		content
	].join("\n");

	const response = await agent.invoke(prompt);
	const rawText = typeof response.content === "string"
		? response.content
		: JSON.stringify(response.content);

	return parseSeoResult(rawText);
};

export const generateSeo = optimizeArticleSeo;
export const optimizeSEO = optimizeArticleSeo;

