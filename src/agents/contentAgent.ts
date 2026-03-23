import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

dotenv.config();

export interface ContentRequest {
	topic: string;
	keyword: string;
	angle?: string;
	intent?: string;
	format?: string;
	categoryName?: string;
	categoryDescription?: string;
	styleHint?: string;
	templateHint?: string;
	historyTitles?: string[];
	avoidPhrases?: string[];
}

const pickRandom = <T>(items: T[]): T => {
	return items[Math.floor(Math.random() * items.length)];
};

export const createContentWritingAgent = (): ChatOpenAI => {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set.");
	}

	const contextConfig = getAgentContextConfig();

	return new ChatOpenAI({
		openAIApiKey: process.env.OPENAI_API_KEY,
		model: contextConfig.llm.contentModel,
		temperature: contextConfig.llm.contentTemperature
	});
};

export const writeVietnameseBlogArticle = async ({ topic, keyword, angle, intent, format, categoryName, categoryDescription, styleHint, templateHint, historyTitles, avoidPhrases }: ContentRequest): Promise<string> => {
	const cleanTopic = topic.trim();
	const cleanKeyword = keyword.trim();
	const cleanAngle = (angle ?? "").trim();
	const cleanIntent = (intent ?? "").trim();
	const cleanFormat = (format ?? "").trim();
	const cleanCategoryName = (categoryName ?? "").trim();
	const cleanCategoryDescription = (categoryDescription ?? "").trim();
	const cleanStyleHint = (styleHint ?? "").trim();
	const cleanTemplateHint = (templateHint ?? "").trim();
	const recentTitles = Array.isArray(historyTitles)
		? historyTitles.filter((item) => typeof item === "string" && item.trim().length > 0).slice(0, 10)
		: [];
	const disallowedPhrases = Array.isArray(avoidPhrases)
		? avoidPhrases.filter((item) => typeof item === "string" && item.trim().length > 0).slice(0, 12)
		: [];
	const contextConfig = getAgentContextConfig();
	const styleProfiles = contextConfig.content.styleProfiles;
	const randomStyleProfile = pickRandom(styleProfiles);

	if (!cleanTopic) {
		throw new Error("topic is required.");
	}

	if (!cleanKeyword) {
		throw new Error("keyword is required.");
	}

	const agent = createContentWritingAgent();

	const prompt = [
		contextConfig.content.systemRolePrompt,
		"Hãy viết một bài blog đầy đủ bằng tiếng Việt.",
		`Chủ đề: ${cleanTopic}`,
		`Từ khóa chính: ${cleanKeyword}`,
		cleanCategoryName ? `Danh mục mục tiêu: ${cleanCategoryName}` : "",
		cleanCategoryDescription ? `Mô tả phạm vi danh mục: ${cleanCategoryDescription}` : "",
		cleanAngle ? `Góc nhìn bài viết bắt buộc: ${cleanAngle}` : "",
		cleanIntent ? `Search/User intent chính: ${cleanIntent}` : "",
		cleanFormat ? `Định dạng nội dung chính: ${cleanFormat}` : "",
		`Style profile ngẫu nhiên cho lần viết này: ${randomStyleProfile}`,
		cleanStyleHint ? `Blueprint phong cách bắt buộc ưu tiên: ${cleanStyleHint}` : "",
		cleanTemplateHint ? `Template variation bắt buộc áp dụng: ${cleanTemplateHint}` : "",
		recentTitles.length > 0 ? "Lịch sử tiêu đề gần đây, không được lặp lại góc nhìn/cách đặt vấn đề:" : "",
		...recentTitles.map((title, index) => `${index + 1}) ${title.trim()}`),
		disallowedPhrases.length > 0 ? "Các cụm từ/heading cần tránh lặp lại từ bài cũ:" : "",
		...disallowedPhrases.map((phrase, index) => `${index + 1}) ${phrase.trim()}`),
		"Yêu cầu bắt buộc:",
		...contextConfig.content.mandatoryRequirements.map((rule, index) => `${index + 1}) ${rule}`),
		"Chỉ trả về nội dung bài viết, không thêm giải thích ngoài bài."
	].filter(Boolean).join("\n");

	const response = await agent.invoke(prompt);
	const article = typeof response.content === "string"
		? response.content.trim()
		: JSON.stringify(response.content);

	if (!article) {
		throw new Error("Model returned empty article content.");
	}

	return article;
};

export const generateContent = writeVietnameseBlogArticle;
export const generateArticle = writeVietnameseBlogArticle;

