import axios from "axios";
import dotenv from "dotenv";
import { marked } from "marked";

import { getAuthToken, refreshAuthToken } from "./authService.js";
import { planArticleIllustrations, resolveIllustrationAssets, type ResolvedIllustrationAsset } from "./articleImageService.js";

dotenv.config();

export interface PublishPostInput {
  seoTitle: string;
  article: string;
  summary: string;
  categoryId: string;
  categoryName?: string;
  categoryDescription?: string;
  tags: string[];
  keyword?: string;
}

const LOCAL_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const normalizeAndValidateApiBaseUrl = (rawValue: string): string => {
  const normalized = rawValue.trim().replace(/\/$/, "");

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`API_BASE_URL is invalid: ${normalized}`);
  }

  const isProduction = (process.env.NODE_ENV ?? "development").trim().toLowerCase() === "production";
  if (isProduction && LOCAL_API_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      `API_BASE_URL points to a local host (${parsed.hostname}) in production. Set it to your deployed backend URL.`
    );
  }

  return normalized;
};

const getApiBaseUrl = (): string => {
  const value = process.env.API_BASE_URL?.trim();
  if (!value) {
    throw new Error("API_BASE_URL is not configured.");
  }

  return normalizeAndValidateApiBaseUrl(value);
};

const buildBackendUrl = (pathAfterApi: string): string => {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = pathAfterApi.startsWith("/") ? pathAfterApi : `/${pathAfterApi}`;

  if (baseUrl.endsWith("/api")) {
    return `${baseUrl}${normalizedPath}`;
  }

  return `${baseUrl}/api${normalizedPath}`;
};

const getPublishErrorMessage = (error: any): string => {
  const apiMessage = error?.response?.data?.message;
  const axiosMessage = error?.message;
  const code = error?.code;
  const causeMessage = error?.cause?.message;

  if (typeof apiMessage === "string" && apiMessage.trim()) {
    return apiMessage.trim();
  }

  if (typeof axiosMessage === "string" && axiosMessage.trim()) {
    return axiosMessage.trim();
  }

  if (typeof causeMessage === "string" && causeMessage.trim()) {
    return causeMessage.trim();
  }

  if (typeof code === "string" && code.trim()) {
    return code.trim();
  }

  return "Unknown publish error";
};

const looksLikeHtml = (value: string): boolean => {
  return /<\/?[a-z][\s\S]*>/i.test(value);
};

const toPublishableContent = (article: string): string => {
  const normalized = article.trim();
  if (!normalized) {
    return "";
  }

  if (looksLikeHtml(normalized)) {
    return normalized;
  }

  const rendered = marked.parse(normalized, {
    gfm: true,
    breaks: true
  });

  return typeof rendered === "string" ? rendered : normalized;
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
};

const toSeedToken = (value: string): string => {
  const normalized = normalizeTopicText(value).replace(/\s+/g, "-");
  return normalized.slice(0, 70) || "organic-farming";
};

const buildArticleSeed = (data: PublishPostInput): string => {
  const raw = `${data.seoTitle}|${data.keyword ?? ""}|${(data.tags ?? []).join("|")}`;
  return toSeedToken(raw);
};

const getImageTagCount = (content: string): number => {
  return (content.match(/<img\b[^>]*>/gi) ?? []).length;
};

const stripHtmlTags = (value: string): string => {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

const removeLeadingDuplicateTitle = (content: string, title: string): string => {
  const headingRegex = /^\s*<(h1|h2)[^>]*>([\s\S]*?)<\/\1>\s*/i;
  const match = content.match(headingRegex);
  if (!match) {
    return content;
  }

  const headingText = stripHtmlTags(match[2]);
  const normalizedHeading = normalizeTopicText(headingText);
  const normalizedTitle = normalizeTopicText(title);

  if (!normalizedHeading || !normalizedTitle) {
    return content;
  }

  if (normalizedHeading === normalizedTitle || normalizedHeading.includes(normalizedTitle) || normalizedTitle.includes(normalizedHeading)) {
    return content.replace(headingRegex, "").trim();
  }

  return content;
};

const buildDeterministicFallbackImageUrl = (seedToken: string, width: number, height: number): string => {
  return `https://picsum.photos/seed/${encodeURIComponent(seedToken)}/${width}/${height}`;
};

const findParagraphInsertionPoints = (content: string): number[] => {
  const matches: number[] = [];
  const regex = /<\/p>/gi;
  let match: RegExpExecArray | null = regex.exec(content);

  while (match) {
    matches.push(match.index + match[0].length);
    match = regex.exec(content);
  }

  if (matches.length > 0) {
    return matches;
  }

  const headingMatches: number[] = [];
  const headingRegex = /<\/h[2-4]>/gi;
  let headingMatch: RegExpExecArray | null = headingRegex.exec(content);

  while (headingMatch) {
    headingMatches.push(headingMatch.index + headingMatch[0].length);
    headingMatch = headingRegex.exec(content);
  }

  return headingMatches;
};

const buildInlineImageBlock = (asset: ResolvedIllustrationAsset): string => {
  const titleText = asset.imageName.replace(/-/g, " ").trim();
  const captionText = asset.altText && asset.altText.trim().length > 0
    ? asset.altText.trim()
    : asset.sourceAlt && asset.sourceAlt.trim().length > 0
      ? `Mo ta anh goc: ${asset.sourceAlt.trim()}`
    : `Anh minh hoa: ${titleText}`;
  const creditText = asset.photographer && asset.photographer.trim().length > 0
    ? `Ảnh minh họa: Pexels - ${asset.photographer.trim()}`
    : "Ảnh minh họa: Pexels";
  const escapedCaption = captionText.replace(/"/g, "&quot;");
  const effectiveAlt = (asset.altText && asset.altText.trim().length > 0
    ? asset.altText
    : asset.sourceAlt ?? `Anh minh hoa: ${titleText}`).trim();
  const escapedAlt = effectiveAlt.replace(/"/g, "&quot;");
  const escapedImageName = asset.imageName.replace(/"/g, "&quot;");
  const escapedCredit = creditText.replace(/"/g, "&quot;");

  return [
    `<figure class="article-inline-image" data-image-name="${escapedImageName}" data-image-provider="${asset.provider}" style="margin:24px 0;">`,
    `  <img src="${asset.url}" alt="${escapedAlt}" loading="lazy" style="width:100%;height:auto;border-radius:12px;object-fit:cover;" />`,
    "  <figcaption style=\"margin-top:8px;text-align:center;\">",
    `    <div style="color:#374151;font-size:14px;font-style:italic;">${escapedCaption}</div>`,
    `    <div style="margin-top:4px;color:#6b7280;font-size:12px;">${escapedCredit}</div>`,
    "  </figcaption>",
    "</figure>"
  ].join("\n");
};

const buildPlacementBlocks = (positions: number[], assets: ResolvedIllustrationAsset[]): Array<{ position: number; asset: ResolvedIllustrationAsset }> => {
  if (!positions.length || !assets.length) {
    return [];
  }

  const usedIndices = new Set<number>();
  const blocks: Array<{ position: number; asset: ResolvedIllustrationAsset }> = [];

  for (const asset of assets) {
    const preferredIndex = Math.max(0, Math.min(positions.length - 1, Math.floor((asset.positionPercent / 100) * positions.length)));
    let chosenIndex = -1;

    for (let offset = 0; offset < positions.length; offset += 1) {
      const left = preferredIndex - offset;
      const right = preferredIndex + offset;

      if (left >= 0 && !usedIndices.has(left)) {
        chosenIndex = left;
        break;
      }

      if (right < positions.length && !usedIndices.has(right)) {
        chosenIndex = right;
        break;
      }
    }

    if (chosenIndex === -1) {
      continue;
    }

    usedIndices.add(chosenIndex);
    blocks.push({
      position: positions[chosenIndex],
      asset
    });
  }

  return blocks.sort((a, b) => a.position - b.position);
};

const buildIllustratedContent = async (content: string, data: PublishPostInput): Promise<{ content: string; featuredImageUrl: string }> => {
  const trimmedContent = content.trim();
  const articleSeed = buildArticleSeed(data);
  const fallbackFeaturedImageUrl = buildDeterministicFallbackImageUrl(`${articleSeed}-cover`, 1200, 630);

  if (!trimmedContent) {
    return {
      content,
      featuredImageUrl: fallbackFeaturedImageUrl
    };
  }

  const plan = await planArticleIllustrations({
    title: data.seoTitle,
    summary: data.summary,
    keyword: data.keyword,
    tags: data.tags,
    htmlContent: trimmedContent
  });

  const resolved = await resolveIllustrationAssets({
    plan,
    seed: articleSeed,
    fallbackQuery: buildSemanticImageQuery(data)
  }, {
    title: data.seoTitle,
    summary: data.summary,
    content: trimmedContent
  });

  const featuredImageUrl = resolved.coverUrl
    ?? resolved.inlineAssets[0]?.url
    ?? fallbackFeaturedImageUrl;

  if (trimmedContent.includes("article-inline-image")) {
    return {
      content,
      featuredImageUrl
    };
  }

  const existingImageCount = getImageTagCount(trimmedContent);
  if (existingImageCount > 0) {
    return {
      content,
      featuredImageUrl
    };
  }

  const insertionPoints = findParagraphInsertionPoints(trimmedContent);
  if (!insertionPoints.length) {
    return {
      content,
      featuredImageUrl
    };
  }

  const desiredCount = Math.max(1, Math.min(plan.desiredImageCount, 3, insertionPoints.length));
  const assets = resolved.inlineAssets.slice(0, desiredCount);
  if (!assets.length) {
    return {
      content,
      featuredImageUrl
    };
  }

  const placementBlocks = buildPlacementBlocks(insertionPoints, assets);
  if (!placementBlocks.length) {
    return {
      content,
      featuredImageUrl
    };
  }

  let result = trimmedContent;
  const descendingBlocks = placementBlocks.sort((a, b) => b.position - a.position);
  for (const item of descendingBlocks) {
    const block = buildInlineImageBlock(item.asset);
    result = `${result.slice(0, item.position)}\n${block}\n${result.slice(item.position)}`;
  }

  return {
    content: result,
    featuredImageUrl
  };
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

const topicMappings: Array<{ pattern: RegExp; query: string }> = [
  { pattern: /(dat huu co|dat sach|soil|organic soil)/, query: "organic soil compost" },
  { pattern: /(phan bon|fertilizer|compost)/, query: "organic fertilizer compost farm" },
  { pattern: /(trau|cay trong|rau|vegetable|garden)/, query: "vegetable garden organic farming" },
  { pattern: /(sau benh|pest|sau hai)/, query: "natural pest control agriculture" },
  { pattern: /(nong nghiep huu co|nong nghiep xanh|agriculture|farming)/, query: "sustainable organic farming field" },
  { pattern: /(u phan|composting)/, query: "composting organic waste agriculture" }
];

const buildSemanticImageQuery = (data: PublishPostInput): string => {
  const rawSource = [
    data.keyword,
    data.seoTitle,
    ...(Array.isArray(data.tags) ? data.tags : [])
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ");

  const normalized = normalizeTopicText(rawSource);

  for (const mapping of topicMappings) {
    if (mapping.pattern.test(normalized)) {
      return mapping.query;
    }
  }

  const stopwords = new Set([
    "huong",
    "dan",
    "cach",
    "gi",
    "la",
    "cho",
    "va",
    "voi",
    "tot",
    "nhat",
    "loi",
    "ich"
  ]);

  const fallbackTokens = normalized
    .split(" ")
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .slice(0, 4);

  const fallbackQuery = fallbackTokens.join(" ").trim();
  if (fallbackQuery) {
    return `${fallbackQuery} agriculture soil`;
  }

  return "organic farming soil compost";
};

const isDuplicateSlugError = (error: any): boolean => {
  const message = getPublishErrorMessage(error).toLowerCase();
  return message.includes("e11000") && (message.includes("slug_1") || message.includes("dup key"));
};

const buildUniqueTitle = (title: string, attempt: number): string => {
  const now = new Date();
  const dateStamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const timeStamp = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  return `${title} ${dateStamp}-${timeStamp}-${attempt}`;
};

const requestPublish = async (data: PublishPostInput, token: string, titleOverride?: string) => {
  const titleToUse = titleOverride ?? data.seoTitle;
  const normalizedContent = removeLeadingDuplicateTitle(toPublishableContent(data.article), titleToUse);
  const illustrationResult = await buildIllustratedContent(normalizedContent, {
    ...data,
    seoTitle: titleToUse
  });

  return axios.post(
    buildBackendUrl("/news"),
    {
      title: titleToUse,
      content: illustrationResult.content,
      excerpt: data.summary,
      featuredImage: {
        url: illustrationResult.featuredImageUrl,
        publicId: ""
      },
      category: data.categoryId,
      tags: data.tags,
      isActive: true,
      publishedAt: new Date()
    },
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
};

const publishWithDuplicateRetry = async (data: PublishPostInput, token: string) => {
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const titleOverride = attempt === 1 ? undefined : buildUniqueTitle(data.seoTitle, attempt);

    try {
      return await requestPublish(data, token, titleOverride);
    } catch (error: any) {
      if (isDuplicateSlugError(error) && attempt < maxAttempts) {
        console.warn(`[publishService] Duplicate slug detected. Retrying publish with unique title (attempt ${attempt + 1}/${maxAttempts}).`);
        continue;
      }

      throw error;
    }
  }

  throw new Error("Publish failed after duplicate-slug retries.");
};

export async function publishPost(data: PublishPostInput) {
  const {
    seoTitle,
    article,
    summary,
    tags,
    categoryId
  } = data;

  if (!seoTitle || !article || !summary || !categoryId) {
    throw new Error("Missing required publishing fields.");
  }

  if (!Array.isArray(tags)) {
    throw new Error("tags must be an array.");
  }

  try {
    const token = await getAuthToken();
    const response = await publishWithDuplicateRetry(data, token);
    return response.data;
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401) {
      console.warn("[publishService] Token expired or invalid. Re-authenticating...");
      try {
        const newToken = await refreshAuthToken();
        const retryResponse = await publishWithDuplicateRetry(data, newToken);
        return retryResponse.data;
      } catch (retryError: any) {
        const retryMessage = getPublishErrorMessage(retryError);
        console.error("[publishService] Retry publish failed:", retryError);
        throw new Error(`Publish retry failed: ${retryMessage}`);
      }
    }

    console.error("[publishService] Failed to publish article:", error);
    const message = getPublishErrorMessage(error);
    throw new Error(`Publish failed: ${message}`);
  }
}