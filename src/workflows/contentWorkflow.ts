import { z } from "zod";
import { randomUUID } from "node:crypto";

import { generateTopics } from "../agents/topicAgent.js";
import { generateArticle } from "../agents/contentAgent.js";
import { optimizeSEO } from "../agents/seoAgent.js";
import { findFrequentPhrases, getKnownArticleCorpus, getKnownArticleTitles, isDuplicateTitle, measureArticleSimilarity } from "../services/dedupService.js";
import { sendPublishedEmail } from "../services/emailService.js";
import { getActiveNewsCategories, selectBalancedRandomNewsCategory } from "../services/newsCategoryService.js";
import { publishPost } from "../services/publishService.js";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

const DEFAULT_CATEGORY_ID = process.env.DEFAULT_NEWS_CATEGORY_ID ?? "000000000000000000000000";
const ARTICLE_SIMILARITY_THRESHOLD = 0.2;

const shuffle = <T>(items: T[]): T[] => {
	const cloned = [...items];
	for (let index = cloned.length - 1; index > 0; index -= 1) {
		const randomIndex = Math.floor(Math.random() * (index + 1));
		const temp = cloned[index];
		cloned[index] = cloned[randomIndex];
		cloned[randomIndex] = temp;
	}

	return cloned;
};

type LatestArticlePayload = {
	id: string;
	seoTitle: string;
	article: string;
	summary: string;
	tags: string[];
	categoryId: string;
	categoryName?: string;
	categoryDescription?: string;
	keyword: string;
};

const setLatestArticle = (payload: LatestArticlePayload): void => {
	(globalThis as any).latestArticle = payload;
};

const topicSchema = z.object({
	title: z.string(),
	keyword: z.string(),
	angle: z.string(),
	intent: z.string(),
	format: z.string()
});

const selectedCategorySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string()
});

const seoSchema = z.object({
	seoTitle: z.string(),
	metaDescription: z.string(),
	tags: z.array(z.string()),
	summary: z.string()
});

const outputSchema = z.object({
	topic: topicSchema,
	article: z.string(),
	seo: seoSchema
});

const getPublicSiteBaseUrl = (): string => {
	const value = (
		process.env.PUBLIC_SITE_URL ??
		process.env.FRONTEND_BASE_URL ??
		process.env.WEBSITE_BASE_URL ??
		"http://localhost:3000"
	).trim();

	return value.replace(/\/$/, "");
};

const buildPublishedArticleUrl = (published: any): string => {
	const row = published?.data ?? published;
	const slug = typeof row?.slug === "string" ? row.slug.trim() : "";
	const id = typeof row?._id === "string" ? row._id.trim() : "";
	const baseUrl = getPublicSiteBaseUrl();

	if (slug) {
		return `${baseUrl}/news/${slug}`;
	}

	if (id) {
		return `${baseUrl}/news/${id}`;
	}

	return `${baseUrl}/news`;
};

const isNotificationEmailDisabled = (): boolean => {
	const raw = (process.env.DISABLE_NOTIFICATION_EMAIL ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
};

export type ContentWorkflowResult = z.infer<typeof outputSchema>;

const loadMastraWorkflows = (): Promise<typeof import("@mastra/core/workflows")> => {
	const dynamicImport = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<typeof import("@mastra/core/workflows")>;
	return dynamicImport("@mastra/core/workflows");
};

const buildContentWorkflow = () => loadMastraWorkflows().then(({ createStep, createWorkflow }) => {

	const generateTopicStep = createStep({
		id: "generate-topic",
		description: "Generate and select one blog topic",
		inputSchema: z.object({}),
		outputSchema: z.object({
			topic: topicSchema,
			selectedCategory: selectedCategorySchema
		}),
		execute: async () => {
			const knownTitles = await getKnownArticleTitles();
			const categories = await getActiveNewsCategories();
			const selectedCategory = categories.length > 0
				? await selectBalancedRandomNewsCategory(categories)
				: {
					id: DEFAULT_CATEGORY_ID,
					name: "Tin tuc",
					description: "Danh muc fallback khi khong lay duoc danh muc tu DB"
				};

			if (!categories.length) {
				console.warn("[content-workflow] No active news categories found from DB. Falling back to DEFAULT_NEWS_CATEGORY_ID.");
			}

			const topics = await generateTopics(knownTitles, {
				name: selectedCategory.name,
				description: selectedCategory.description
			});

			if (!topics.length) {
				throw new Error("No topics generated.");
			}

			const uniqueTopic = topics.find((topic) => !isDuplicateTitle(topic.title, knownTitles));
			if (!uniqueTopic) {
				throw new Error("All generated topics are duplicates of existing articles. Please run again.");
			}

			return {
				topic: uniqueTopic,
				selectedCategory
			};
		}
	});

	const generateArticleStep = createStep({
		id: "generate-article",
		description: "Generate full article content from topic",
		inputSchema: z.object({
			topic: topicSchema,
			selectedCategory: selectedCategorySchema
		}),
		outputSchema: z.object({
			topic: topicSchema,
			selectedCategory: selectedCategorySchema,
			article: z.string()
		}),
		execute: async ({ inputData }) => {
			const contextConfig = getAgentContextConfig();
			const styleBlueprints = contextConfig.workflow.styleBlueprints;
			const templateVariations = contextConfig.workflow.templateVariations;
			const corpus = await getKnownArticleCorpus();
			const frequentPhrases = findFrequentPhrases(corpus, 10);
			const recentTitles = corpus.map((item) => item.title).slice(0, 12);
			const runStyles = shuffle(styleBlueprints);
			const runTemplates = shuffle(templateVariations);

			let bestArticle = "";
			let bestSimilarity = Number.POSITIVE_INFINITY;
			let bestClosestTitle = "";

			for (let attempt = 0; attempt < runStyles.length; attempt += 1) {
				const styleHint = runStyles[attempt];
				const templateHint = runTemplates[attempt % runTemplates.length];
				const article = await generateArticle({
					topic: inputData.topic.title,
					keyword: inputData.topic.keyword,
					angle: inputData.topic.angle,
					intent: inputData.topic.intent,
					format: inputData.topic.format,
					categoryName: inputData.selectedCategory.name,
					categoryDescription: inputData.selectedCategory.description,
					styleHint,
					templateHint,
					historyTitles: recentTitles,
					avoidPhrases: frequentPhrases
				});

				const similarity = measureArticleSimilarity(article, corpus);
				if (similarity.maxSimilarity < bestSimilarity) {
					bestArticle = article;
					bestSimilarity = similarity.maxSimilarity;
					bestClosestTitle = similarity.closestTitle;
				}

				if (similarity.maxSimilarity <= ARTICLE_SIMILARITY_THRESHOLD) {
					bestArticle = article;
					bestSimilarity = similarity.maxSimilarity;
					bestClosestTitle = similarity.closestTitle;
					break;
				}
			}

			if (!bestArticle) {
				throw new Error("Could not generate a diverse enough article.");
			}

			if (bestSimilarity > ARTICLE_SIMILARITY_THRESHOLD) {
				console.warn(`[content-workflow] Article similarity remains high (${bestSimilarity.toFixed(3)}) vs \"${bestClosestTitle}\". Using best available variant.`);
			}

			return {
				topic: inputData.topic,
				selectedCategory: inputData.selectedCategory,
				article: bestArticle
			};
		}
	});

	const optimizeSeoStep = createStep({
		id: "optimize-seo",
		description: "Optimize generated article for SEO, publish, and notify",
		inputSchema: z.object({
			topic: topicSchema,
			selectedCategory: selectedCategorySchema,
			article: z.string()
		}),
		outputSchema,
		execute: async ({ inputData }) => {
			const seo = await optimizeSEO(inputData.article);
			const knownTitles = await getKnownArticleTitles();
			if (isDuplicateTitle(seo.seoTitle, knownTitles)) {
				throw new Error(`Generated title is duplicate: ${seo.seoTitle}. Please rerun workflow for a new topic.`);
			}

			const articleId = randomUUID();

			setLatestArticle({
				id: articleId,
				seoTitle: seo.seoTitle,
				article: inputData.article,
				summary: seo.summary,
				tags: seo.tags,
				categoryId: inputData.selectedCategory.id,
				categoryName: inputData.selectedCategory.name,
				categoryDescription: inputData.selectedCategory.description,
				keyword: inputData.topic.keyword
			});

			const published = await publishPost({
				seoTitle: seo.seoTitle,
				article: inputData.article,
				summary: seo.summary,
				tags: seo.tags,
				categoryId: inputData.selectedCategory.id,
				categoryName: inputData.selectedCategory.name,
				categoryDescription: inputData.selectedCategory.description,
				keyword: inputData.topic.keyword
			});

			const articleUrl = buildPublishedArticleUrl(published);

			if (!isNotificationEmailDisabled()) {
				try {
					await sendPublishedEmail({
						title: seo.seoTitle,
						summary: seo.summary,
						categoryName: inputData.selectedCategory.name,
						articleUrl,
						to: process.env.EMAIL_USER
					});
				} catch (error) {
					console.warn("[content-workflow] Published article but failed to send notification email:", error);
				}
			}

			return {
				topic: inputData.topic,
				article: inputData.article,
				seo
			};
		}
	});

	const workflow = createWorkflow({
		id: "content-workflow",
		description: "Generate topic, article, and SEO metadata using specialized agents",
		inputSchema: z.object({}),
		outputSchema
	})
		.then(generateTopicStep)
		.then(generateArticleStep)
		.then(optimizeSeoStep)
		.commit();

	// Wrap workflow to avoid Promise thenable-assimilation because Mastra Workflow has a .then() method.
	return { workflow };
});

export const runContentWorkflow = async (): Promise<ContentWorkflowResult> => {
	const { workflow: contentWorkflow } = await buildContentWorkflow();
	const run = await contentWorkflow.createRunAsync();
	const workflowResult = await run.start({ inputData: {} });

	if (workflowResult.status !== "success") {
		throw new Error(`Workflow failed with status: ${workflowResult.status}`);
	}

	return workflowResult.result;
};

