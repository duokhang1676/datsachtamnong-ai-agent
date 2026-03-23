import axios from "axios";
import dotenv from "dotenv";

import { listPendingArticles } from "./pendingArticleStore.js";

dotenv.config();

const normalizeTitle = (value: string): string => {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeText = (value: string): string => {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_`>\-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const tokenize = (value: string): string[] => {
  const stopwords = new Set([
    "va", "la", "cho", "cua", "voi", "nhung", "trong", "mot", "nhieu", "khi", "de", "the", "nhu",
    "dat", "sach", "huu", "co", "blog", "bai", "viet"
  ]);

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !stopwords.has(token));
};

const toNgrams = (tokens: string[], n = 3): Set<string> => {
  const grams = new Set<string>();
  if (tokens.length < n) {
    tokens.forEach((token) => grams.add(token));
    return grams;
  }

  for (let index = 0; index <= tokens.length - n; index += 1) {
    grams.add(tokens.slice(index, index + n).join(" "));
  }

  return grams;
};

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

export type KnownArticle = {
  title: string;
  text: string;
};

const getApiBaseUrl = (): string => {
  const value = process.env.API_BASE_URL?.trim();
  if (!value) {
    throw new Error("API_BASE_URL is not configured.");
  }

  return value.replace(/\/$/, "");
};

const buildBackendUrl = (pathAfterApi: string): string => {
  const baseUrl = getApiBaseUrl();
  const normalizedPath = pathAfterApi.startsWith("/") ? pathAfterApi : `/${pathAfterApi}`;

  if (baseUrl.endsWith("/api")) {
    return `${baseUrl}${normalizedPath}`;
  }

  return `${baseUrl}/api${normalizedPath}`;
};

const fetchPublishedTitles = async (): Promise<string[]> => {
  try {
    const response = await axios.get(buildBackendUrl("/news"), {
      params: {
        isActive: true,
        page: 1,
        limit: 200
      },
      timeout: 8000
    });

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows
      .map((item: any) => (typeof item?.title === "string" ? item.title.trim() : ""))
      .filter(Boolean);
  } catch (error) {
    console.warn("[dedupService] Could not fetch published titles. Continue with pending-only dedup.", error);
    return [];
  }
};

const fetchPublishedArticles = async (): Promise<KnownArticle[]> => {
  try {
    const response = await axios.get(buildBackendUrl("/news"), {
      params: {
        isActive: true,
        page: 1,
        limit: 100
      },
      timeout: 8000
    });

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows
      .map((item: any) => ({
        title: typeof item?.title === "string" ? item.title.trim() : "",
        text: [item?.title, item?.excerpt, item?.content].filter((part) => typeof part === "string").join(" ")
      }))
      .filter((item: KnownArticle) => item.title.length > 0 && item.text.trim().length > 0);
  } catch (error) {
    console.warn("[dedupService] Could not fetch published article corpus.", error);
    return [];
  }
};

const fetchPendingTitles = async (): Promise<string[]> => {
  try {
    const pending = await listPendingArticles();
    return pending
      .map((item) => (typeof item?.seoTitle === "string" ? item.seoTitle.trim() : ""))
      .filter(Boolean);
  } catch (error) {
    console.warn("[dedupService] Could not read pending titles.", error);
    return [];
  }
};

const fetchPendingArticles = async (): Promise<KnownArticle[]> => {
  try {
    const pending = await listPendingArticles();
    return pending
      .map((item) => ({
        title: typeof item?.seoTitle === "string" ? item.seoTitle.trim() : "",
        text: [item?.seoTitle, item?.summary, item?.article].filter((part) => typeof part === "string").join(" ")
      }))
      .filter((item) => item.title.length > 0 && item.text.trim().length > 0);
  } catch (error) {
    console.warn("[dedupService] Could not read pending article corpus.", error);
    return [];
  }
};

export const getKnownArticleTitles = async (): Promise<string[]> => {
  const [publishedTitles, pendingTitles] = await Promise.all([
    fetchPublishedTitles(),
    fetchPendingTitles()
  ]);

  return [...new Set([...publishedTitles, ...pendingTitles])];
};

export const getKnownArticleCorpus = async (): Promise<KnownArticle[]> => {
  const [publishedArticles, pendingArticles] = await Promise.all([
    fetchPublishedArticles(),
    fetchPendingArticles()
  ]);

  const merged = [...publishedArticles, ...pendingArticles];
  const seen = new Set<string>();

  return merged.filter((item) => {
    const key = normalizeTitle(item.title);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

export const findFrequentPhrases = (corpus: KnownArticle[], maxItems = 10): string[] => {
  const phraseCount = new Map<string, number>();

  corpus.forEach((item) => {
    const tokens = tokenize(item.text).slice(0, 160);
    const grams = toNgrams(tokens, 3);
    grams.forEach((gram) => {
      phraseCount.set(gram, (phraseCount.get(gram) ?? 0) + 1);
    });
  });

  return [...phraseCount.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([phrase]) => phrase);
};

export const measureArticleSimilarity = (candidate: string, corpus: KnownArticle[]): { maxSimilarity: number; closestTitle: string } => {
  const candidateTokens = tokenize(candidate).slice(0, 220);
  const candidateGrams = toNgrams(candidateTokens, 3);

  if (candidateGrams.size === 0 || corpus.length === 0) {
    return { maxSimilarity: 0, closestTitle: "" };
  }

  let maxSimilarity = 0;
  let closestTitle = "";

  corpus.forEach((item) => {
    const itemGrams = toNgrams(tokenize(item.text).slice(0, 220), 3);
    const score = jaccard(candidateGrams, itemGrams);
    if (score > maxSimilarity) {
      maxSimilarity = score;
      closestTitle = item.title;
    }
  });

  return { maxSimilarity, closestTitle };
};

export const isDuplicateTitle = (candidateTitle: string, existingTitles: string[]): boolean => {
  const normalizedCandidate = normalizeTitle(candidateTitle);
  if (!normalizedCandidate) {
    return false;
  }

  return existingTitles.some((title) => normalizeTitle(title) === normalizedCandidate);
};
