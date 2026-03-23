import axios from "axios";
import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "./agentContextConfigService.js";

import { selectImageKeywords } from "../agents/keywordSelectionAgent.js";
import { selectBestImage, type PexelsPhotoMetadata } from "../agents/imageSelectionAgent.js";

dotenv.config();

export type ImagePlanSlot = {
  imageName: string;
  searchQuery: string;
  altText: string;
  positionPercent: number;
};

export type ArticleImagePlan = {
  desiredImageCount: number;
  coverImageName: string;
  coverQuery: string;
  coverAltText: string;
  slots: ImagePlanSlot[];
};

export type ResolvedIllustrationAsset = {
  url: string;
  provider: "pexels" | "fallback";
  imageName: string;
  altText: string;
  positionPercent: number;
  sourceAlt?: string;
  photographer?: string;
};

export type ResolvedIllustrationBundle = {
  coverUrl: string | null;
  inlineAssets: ResolvedIllustrationAsset[];
};

type ProviderImage = {
  id: string;
  url: string;
  provider: "pexels";
  alt: string;
  photographer: string;
};

type PlanInput = {
  title: string;
  summary: string;
  keyword?: string;
  tags: string[];
  htmlContent: string;
};

type ResolveInput = {
  plan: ArticleImagePlan;
  seed: string;
  fallbackQuery: string;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
};

const normalizeTopicText = (value: string): string => {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const getImageKeywordRules = (): Array<{ pattern: RegExp; keyword: string }> => {
  const contextConfig = getAgentContextConfig();

  return contextConfig.image.keywordRules
    .map((item) => {
      try {
        return {
          pattern: new RegExp(item.pattern, "i"),
          keyword: item.keyword
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is { pattern: RegExp; keyword: string } => item !== null);
};

const getTokenTranslationMap = (): Record<string, string> => {
  const contextConfig = getAgentContextConfig();
  return contextConfig.image.tokenTranslationMap;
};

const sanitizeEnglishKeyword = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const buildEnglishKeywordFromTokens = (text: string): string => {
  const tokenMap = getTokenTranslationMap();
  const tokens = normalizeTopicText(text)
    .split(" ")
    .filter((token) => token.length >= 2);

  const translated = tokens
    .map((token) => tokenMap[token])
    .filter((token): token is string => typeof token === "string" && token.length > 0);

  const unique = [...new Set(translated)];
  if (!unique.length) {
    return "organic farming";
  }

  const compact = unique.slice(0, 4);
  if (compact.includes("type") && compact.includes("plants")) {
    return "type of plants";
  }

  if (compact.includes("irrigation") && compact.includes("system")) {
    return "irrigation system";
  }

  return sanitizeEnglishKeyword(compact.join(" "));
};

const suggestImageKeyword = (textCandidates: string[], fallbackKeyword: string): string => {
  const joined = textCandidates
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ");
  const normalized = normalizeTopicText(joined);

  if (!normalized) {
    return sanitizeEnglishKeyword(fallbackKeyword) || "organic farming";
  }

  const rules = getImageKeywordRules();
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) {
      return rule.keyword;
    }
  }

  const fromTokens = buildEnglishKeywordFromTokens(joined);
  return fromTokens || sanitizeEnglishKeyword(fallbackKeyword) || "organic farming";
};

const toTokenSet = (value: string): Set<string> => {
  return new Set(
    normalizeTopicText(value)
      .split(" ")
      .filter((token) => token.length >= 3)
  );
};

const jaccardScore = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

const extractJsonObject = <T>(value: string): T => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Image planner did not return a JSON object.");
  }

  return JSON.parse(value.slice(start, end + 1)) as T;
};

const toWordCount = (htmlContent: string): number => {
  return htmlContent
    .replace(/<[^>]*>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
};

const buildFallbackPlan = (input: PlanInput): ArticleImagePlan => {
  const contextConfig = getAgentContextConfig();
  const imageConfig = contextConfig.image;
  const baseQuery = [input.keyword, ...input.tags, input.title]
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .trim() || imageConfig.defaultFallbackQuery;

  const words = toWordCount(input.htmlContent);
  const desiredImageCount = clamp(Math.round(words / 550), imageConfig.minInlineImages, imageConfig.maxInlineImages);

  const slots: ImagePlanSlot[] = [];
  for (let index = 0; index < desiredImageCount; index += 1) {
    const positionPercent = Math.round(((index + 1) / (desiredImageCount + 1)) * 100);
    slots.push({
      imageName: `canh-tac-huu-co-${index + 1}`,
      searchQuery: baseQuery,
      altText: `Hinh anh minh hoa ve ${input.title}`,
      positionPercent: clamp(positionPercent, 10, 90)
    });
  }

  return {
    desiredImageCount,
    coverImageName: "anh-bia-bai-viet",
    coverQuery: baseQuery,
    coverAltText: input.title,
    slots
  };
};

const getPlannerModel = (): string => {
  const contextConfig = getAgentContextConfig();
  return process.env.IMAGE_PLANNER_MODEL?.trim() || contextConfig.llm.imagePlannerModel;
};

const createPlannerAgent = (): ChatOpenAI => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set for image planning.");
  }

  const contextConfig = getAgentContextConfig();

  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    model: getPlannerModel(),
    temperature: contextConfig.llm.imagePlannerTemperature
  });
};

const sanitizePlan = (raw: Partial<ArticleImagePlan>, fallback: ArticleImagePlan): ArticleImagePlan => {
  const contextConfig = getAgentContextConfig();
  const imageConfig = contextConfig.image;
  const desiredImageCount = clamp(
    Math.round(Number(raw.desiredImageCount ?? fallback.desiredImageCount)),
    imageConfig.minInlineImages,
    imageConfig.maxInlineImages
  );

  const fallbackCoverKeyword = suggestImageKeyword(
    [fallback.coverQuery, fallback.coverImageName, fallback.coverAltText],
    "organic farming"
  );

  const rawCoverKeyword = suggestImageKeyword(
    [
      typeof raw.coverQuery === "string" ? raw.coverQuery : "",
      typeof raw.coverImageName === "string" ? raw.coverImageName : "",
      typeof raw.coverAltText === "string" ? raw.coverAltText : ""
    ],
    fallbackCoverKeyword
  );

  const sanitizedSlots = Array.isArray(raw.slots)
    ? raw.slots
      .map((slot) => ({
        imageName: typeof slot?.imageName === "string" && slot.imageName.trim() ? slot.imageName.trim() : "hinh-minh-hoa",
        searchQuery: suggestImageKeyword(
          [
            typeof slot?.searchQuery === "string" ? slot.searchQuery : "",
            typeof slot?.imageName === "string" ? slot.imageName : "",
            typeof slot?.altText === "string" ? slot.altText : ""
          ],
          rawCoverKeyword
        ),
        altText: typeof slot?.altText === "string" && slot.altText.trim() ? slot.altText.trim() : fallback.coverAltText,
        positionPercent: clamp(Math.round(Number(slot?.positionPercent ?? 50)), 10, 90)
      }))
      .slice(0, desiredImageCount)
    : fallback.slots.slice(0, desiredImageCount);

  const slots = sanitizedSlots.length > 0 ? sanitizedSlots : fallback.slots.slice(0, desiredImageCount);

  return {
    desiredImageCount: slots.length,
    coverImageName: typeof raw.coverImageName === "string" && raw.coverImageName.trim() ? raw.coverImageName.trim() : fallback.coverImageName,
    coverQuery: rawCoverKeyword,
    coverAltText: typeof raw.coverAltText === "string" && raw.coverAltText.trim() ? raw.coverAltText.trim() : fallback.coverAltText,
    slots
  };
};

export const planArticleIllustrations = async (input: PlanInput): Promise<ArticleImagePlan> => {
  const fallback = buildFallbackPlan(input);
  const contextConfig = getAgentContextConfig();
  const imageConfig = contextConfig.image;

  try {
    const planner = createPlannerAgent();
    const compactArticle = input.htmlContent
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);

    const prompt = [
      "Bạn là biên tập viên hình ảnh cho bài blog nông nghiệp.",
      "Nhiệm vụ: lập kế hoạch ảnh minh họa cho bài viết.",
      "Yêu cầu:",
      `1) Chọn số lượng ảnh minh họa từ ${imageConfig.minInlineImages} đến ${imageConfig.maxInlineImages} phù hợp độ dài bài.`,
      "2) Chọn vị trí ảnh bằng positionPercent (10..90) theo dòng chảy nội dung.",
      "3) Đặt imageName ngắn gọn, rõ nghĩa, dạng tiếng Việt không dấu, có nội dung cụ thể (không dùng tên chung chung như minh-hoa-1).",
      "4) searchQuery phải là keyword tiếng Anh ngắn gọn (2-4 từ), bám sát imageName để kết quả ảnh khớp tiêu đề ảnh.",
      "5) altText mô tả đúng nội dung ảnh và nhất quán với imageName.",
      "6) Mỗi ảnh nên đại diện cho một ý/chủ điểm khác nhau trong bài viết.",
      imageConfig.plannerPromptAddon,
      "Trả về DUY NHAT JSON object theo schema:",
      "{",
      "  \"desiredImageCount\": number,",
      "  \"coverImageName\": string,",
      "  \"coverQuery\": string,",
      "  \"coverAltText\": string,",
      "  \"slots\": [",
      "    { \"imageName\": string, \"searchQuery\": string, \"altText\": string, \"positionPercent\": number }",
      "  ]",
      "}",
      `Title: ${input.title}`,
      `Summary: ${input.summary}`,
      `Keyword: ${input.keyword ?? ""}`,
      `Tags: ${input.tags.join(", ")}`,
      `Article content excerpt: ${compactArticle}`
    ].join("\n");

    const response = await planner.invoke(prompt);
    const rawText = typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

    const parsed = extractJsonObject<Partial<ArticleImagePlan>>(rawText);
    const sanitizedPlan = sanitizePlan(parsed, fallback);
    return await enhancePlanKeywordsWithAI(sanitizedPlan, input);
  } catch (error) {
    console.warn("[articleImageService] AI image planner failed. Use fallback plan.", error);
    return await enhancePlanKeywordsWithAI(fallback, input);
  }
};

const searchPexels = async (query: string): Promise<ProviderImage[]> => {
  const apiKey = process.env.PEXELS_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const contextConfig = getAgentContextConfig();
  const pexelsConfig = contextConfig.image.pexels;

  try {
    const response = await axios.get(pexelsConfig.endpoint, {
      headers: {
        Authorization: apiKey
      },
      params: {
        query,
        per_page: pexelsConfig.perPage,
        orientation: pexelsConfig.orientation,
        size: pexelsConfig.size
      },
      timeout: pexelsConfig.timeoutMs
    });

    const rows = Array.isArray(response.data?.photos) ? response.data.photos : [];
    return rows
      .map((photo: any) => ({
        id: String(photo?.id ?? ""),
        url: typeof photo?.src?.large2x === "string" && photo.src.large2x.trim()
          ? photo.src.large2x.trim()
          : (typeof photo?.src?.large === "string" ? photo.src.large.trim() : ""),
        provider: "pexels" as const,
        alt: typeof photo?.alt === "string" ? photo.alt.trim() : "",
        photographer: typeof photo?.photographer === "string" ? photo.photographer.trim() : ""
      }))
      .filter((item: ProviderImage) => item.id.length > 0 && item.url.length > 0);
  } catch (error) {
    console.warn(`[articleImageService] Pexels search failed for query: ${query}`, error);
    return [];
  }
};

const mergeUniqueImages = (images: ProviderImage[]): ProviderImage[] => {
  const seen = new Set<string>();
  const unique: ProviderImage[] = [];

  for (const image of images) {
    if (seen.has(image.url)) {
      continue;
    }

    seen.add(image.url);
    unique.push(image);
  }

  return unique;
};

const deterministicPick = (items: ProviderImage[], seed: string): ProviderImage | null => {
  if (!items.length) {
    return null;
  }

  const index = hashString(seed) % items.length;
  return items[index];
};

const scoreCandidateForSlot = (slot: ImagePlanSlot, candidate: ProviderImage): number => {
  const slotTokens = toTokenSet(`${slot.imageName} ${slot.searchQuery} ${slot.altText}`);
  const candidateTokens = toTokenSet(`${candidate.alt} ${candidate.photographer}`);
  const baseScore = jaccardScore(slotTokens, candidateTokens);

  // Favor photos with meaningful alt text since they tend to match visual content better.
  const altBoost = candidate.alt.length >= 12 ? 0.08 : 0;
  return baseScore + altBoost;
};

const enhancePlanKeywordsWithAI = async (
  plan: ArticleImagePlan,
  input: PlanInput
): Promise<ArticleImagePlan> => {
  try {
    const keywordResult = await selectImageKeywords({
      title: input.title,
      summary: input.summary,
      content: input.htmlContent,
      tags: input.tags,
      categoryName: ""
    });

    // Update plan with AI-generated keywords
    const enhancedPlan: ArticleImagePlan = {
      ...plan,
      coverQuery: keywordResult.primaryKeywords[0] || plan.coverQuery,
      slots: plan.slots.map((slot, index) => ({
        ...slot,
        searchQuery:
          keywordResult.primaryKeywords[index % keywordResult.primaryKeywords.length] ||
          keywordResult.primaryKeywords[0] ||
          slot.searchQuery
      }))
    };

    return enhancedPlan;
  } catch (error) {
    console.warn("[articleImageService] AI keyword enhancement failed, use plan as-is", error);
    return plan;
  }
};

const queryCache = new Map<string, ProviderImage[]>();

const selectBestCandidate = async (
  items: ProviderImage[],
  slot: ImagePlanSlot,
  seed: string,
  articleContext?: { title: string; summary: string; content?: string }
): Promise<ProviderImage | null> => {
  if (!items.length) {
    return null;
  }

  // If only 1-2 items or no article context, use fast scoring
  if (items.length <= 2 || !articleContext) {
    const ranked = [...items]
      .map((item) => ({
        item,
        score: scoreCandidateForSlot(slot, item)
      }))
      .sort((a, b) => b.score - a.score);

    const topBucket = ranked.slice(0, Math.min(3, ranked.length));
    const tieBreakItems = topBucket.map((entry) => entry.item);
    return deterministicPick(tieBreakItems, seed);
  }

  // Use AI agent to select best image when multiple good candidates are available.
  try {
    const pexelsMetadata: PexelsPhotoMetadata[] = items.map((item) => ({
      id: parseInt(item.id, 10) || 0,
      url: item.url,
      photographer: item.photographer,
      alt: item.alt,
      width: 1200,
      height: 630
    }));

    const selection = await selectBestImage({
      articleTitle: articleContext.title,
      articleSummary: articleContext.summary,
      articleContent: articleContext.content,
      searchKeyword: slot.searchQuery,
      availableImages: pexelsMetadata,
      imageName: slot.imageName
    });

    // Find the selected image in original items
    const selectedItem = items.find((img) => img.id === String(selection.selectedImageId));
    return selectedItem || items[0];
  } catch (error) {
    console.warn("[articleImageService] AI image selection failed, falling back to scoring", error);
    // Fallback to scoring
    const ranked = [...items]
      .map((item) => ({
        item,
        score: scoreCandidateForSlot(slot, item)
      }))
      .sort((a, b) => b.score - a.score);

    const topBucket = ranked.slice(0, Math.min(3, ranked.length));
    const tieBreakItems = topBucket.map((entry) => entry.item);
    return deterministicPick(tieBreakItems, seed);
  }
};

const getProviderImages = async (query: string): Promise<ProviderImage[]> => {
  const contextConfig = getAgentContextConfig();
  const imageConfig = contextConfig.image;
  if (!imageConfig.providerOrder.includes("pexels")) {
    return [];
  }

  const normalizedQuery = normalizeTopicText(query);
  if (!normalizedQuery) {
    return [];
  }

  if (queryCache.has(normalizedQuery)) {
    return queryCache.get(normalizedQuery) ?? [];
  }

  const pexels = await searchPexels(normalizedQuery);
  const merged = mergeUniqueImages(pexels);
  queryCache.set(normalizedQuery, merged);
  return merged;
};

export const resolveIllustrationAssets = async (
  { plan, seed, fallbackQuery }: ResolveInput,
  articleContext?: { title: string; summary: string; content?: string }
): Promise<ResolvedIllustrationBundle> => {
  const resolvedInlineAssets: ResolvedIllustrationAsset[] = [];

  for (let index = 0; index < plan.slots.length; index += 1) {
    const slot = plan.slots[index];
    const candidates = await getProviderImages(slot.searchQuery || fallbackQuery);
    const picked = await selectBestCandidate(
      candidates,
      slot,
      `${seed}|slot|${index}|${slot.imageName}|${slot.searchQuery}`,
      articleContext
    );

    if (!picked) {
      continue;
    }

    resolvedInlineAssets.push({
      url: picked.url,
      provider: picked.provider,
      imageName: slot.imageName,
      altText: picked.alt && picked.alt.trim().length > 0 ? picked.alt.trim() : slot.altText,
      positionPercent: slot.positionPercent,
      sourceAlt: picked.alt,
      photographer: picked.photographer
    });
  }

  const coverCandidates = await getProviderImages(plan.coverQuery || fallbackQuery);
  const coverSlot: ImagePlanSlot = {
    imageName: plan.coverImageName,
    searchQuery: plan.coverQuery,
    altText: plan.coverAltText,
    positionPercent: 10
  };
  const pickedCover = await selectBestCandidate(
    coverCandidates,
    coverSlot,
    `${seed}|cover|${plan.coverImageName}|${plan.coverQuery}`,
    articleContext
  );

  return {
    coverUrl: pickedCover?.url ?? null,
    inlineAssets: resolvedInlineAssets
  };
};
