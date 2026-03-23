import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

dotenv.config();

export interface TopicSuggestion {
	title: string;
	keyword: string;
	angle: string;
	intent: string;
	format: string;
}

export interface TopicCategoryContext {
	name: string;
	description?: string;
}

const parseTopicSuggestions = (rawText: string, expectedCount: number): TopicSuggestion[] => {
	const start = rawText.indexOf("[");
	const end = rawText.lastIndexOf("]");

	if (start === -1 || end === -1 || end < start) {
		throw new Error("Model did not return a JSON array.");
	}

	const jsonSegment = rawText.slice(start, end + 1);
	const parsed = JSON.parse(jsonSegment) as unknown;

	if (!Array.isArray(parsed)) {
		throw new Error("Invalid topic format: expected an array.");
	}

	const normalized = parsed
		.map((item) => ({
			title: typeof item?.title === "string" ? item.title.trim() : "",
			keyword: typeof item?.keyword === "string" ? item.keyword.trim() : "",
			angle: typeof item?.angle === "string" ? item.angle.trim() : "",
			intent: typeof item?.intent === "string" ? item.intent.trim() : "",
			format: typeof item?.format === "string" ? item.format.trim() : ""
		}))
		.filter((item) => item.title.length > 0 && item.keyword.length > 0 && item.angle.length > 0 && item.intent.length > 0 && item.format.length > 0);

	return normalized.slice(0, expectedCount);
};

export const createTopicResearchAgent = (): ChatOpenAI => {
	if (!process.env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set.");
	}

	const contextConfig = getAgentContextConfig();

	return new ChatOpenAI({
		openAIApiKey: process.env.OPENAI_API_KEY,
		model: contextConfig.llm.topicModel,
		temperature: contextConfig.llm.topicTemperature
	});
};

export const generateOrganicSoilBlogTopics = async (
	excludedTitles: string[] = [],
	categoryContext?: TopicCategoryContext
): Promise<TopicSuggestion[]> => {
	const agent = createTopicResearchAgent();
	const contextConfig = getAgentContextConfig();
	const topicConfig = contextConfig.topic;

	const exclusions = excludedTitles
		.filter((title) => typeof title === "string" && title.trim().length > 0)
		.slice(0, 20)
		.map((title, index) => `${index + 1}. ${title.trim()}`);

	const prompt = [
		topicConfig.strategyPrompt,
		categoryContext
			? `This run must target the selected news category: \"${categoryContext.name}\".`
			: "",
		categoryContext?.description
			? `Category description and scope: ${categoryContext.description}`
			: "",
		`Generate exactly ${topicConfig.topicsPerRun} Vietnamese blog topics suitable for SEO and customer education.`,
		exclusions.length > 0
			? "Do not repeat or closely paraphrase any title in the forbidden list below."
			: "",
		exclusions.length > 0 ? "Forbidden titles:" : "",
		...exclusions,
		"Each topic must have a different angle, different search intent, and different output format.",
		`Allowed intents examples: ${topicConfig.requiredIntents.join(", ")}.`,
		`Allowed formats examples: ${topicConfig.requiredFormats.join(", ")}.`,
		"Each item must include:",
		"- title: concise and compelling blog title",
		"- keyword: one primary SEO keyword",
		"- angle: unique perspective of the article",
		"- intent: dominant search/user intent",
		"- format: primary content format",
		"Return ONLY valid JSON using this exact structure:",
		"[",
		"  {",
		"    \"title\": \"string\",",
		"    \"keyword\": \"string\",",
		"    \"angle\": \"string\",",
		"    \"intent\": \"string\",",
		"    \"format\": \"string\"",
		"  }",
		"]"
	].join("\n");

	const response = await agent.invoke(prompt);
	const rawText = typeof response.content === "string"
		? response.content
		: JSON.stringify(response.content);

	const topics = parseTopicSuggestions(rawText, topicConfig.topicsPerRun);

	if (topics.length !== topicConfig.topicsPerRun) {
		throw new Error(`Model did not return exactly ${topicConfig.topicsPerRun} valid topic suggestions.`);
	}

	return topics;
};

export const generateTopics = generateOrganicSoilBlogTopics;

