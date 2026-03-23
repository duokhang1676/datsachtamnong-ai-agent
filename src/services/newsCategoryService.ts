import axios from "axios";
import dotenv from "dotenv";

import { listPendingArticles } from "./pendingArticleStore.js";

dotenv.config();

export type NewsCategory = {
  id: string;
  name: string;
  description: string;
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

const extractCategoryId = (value: any): string => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  const objectId = value?._id;
  if (typeof objectId === "string" && objectId.trim()) {
    return objectId.trim();
  }

  return "";
};

const mergeCounts = (primary: Map<string, number>, secondary: Map<string, number>): Map<string, number> => {
  const merged = new Map<string, number>(primary);

  for (const [categoryId, count] of secondary.entries()) {
    merged.set(categoryId, (merged.get(categoryId) ?? 0) + count);
  }

  return merged;
};

const fetchPublishedCategoryUsage = async (): Promise<Map<string, number>> => {
  try {
    const response = await axios.get(buildBackendUrl("/news"), {
      params: {
        isActive: true,
        page: 1,
        limit: 400
      },
      timeout: 8000
    });

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    const counts = new Map<string, number>();

    for (const row of rows) {
      const categoryId = extractCategoryId(row?.category);
      if (!categoryId) {
        continue;
      }

      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    return counts;
  } catch (error) {
    console.warn("[newsCategoryService] Could not fetch published category usage.", error);
    return new Map<string, number>();
  }
};

const fetchPendingCategoryUsage = async (): Promise<Map<string, number>> => {
  try {
    const rows = await listPendingArticles();
    const counts = new Map<string, number>();

    for (const row of rows) {
      const categoryId = typeof row?.categoryId === "string" ? row.categoryId.trim() : "";
      if (!categoryId) {
        continue;
      }

      counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
    }

    return counts;
  } catch (error) {
    console.warn("[newsCategoryService] Could not read pending category usage.", error);
    return new Map<string, number>();
  }
};

export const getActiveNewsCategories = async (): Promise<NewsCategory[]> => {
  try {
    const response = await axios.get(buildBackendUrl("/categories"), {
      params: {
        type: "news",
        isActive: true
      },
      timeout: 8000
    });

    const rows = Array.isArray(response.data?.data) ? response.data.data : [];
    return rows
      .map((item: any) => ({
        id: typeof item?._id === "string" ? item._id.trim() : "",
        name: typeof item?.name === "string" ? item.name.trim() : "",
        description: typeof item?.description === "string" ? item.description.trim() : ""
      }))
      .filter((item: NewsCategory) => item.id.length > 0 && item.name.length > 0);
  } catch (error) {
    console.warn("[newsCategoryService] Could not fetch active news categories from API.", error);
    return [];
  }
};

export const selectBalancedRandomNewsCategory = async (categories: NewsCategory[]): Promise<NewsCategory> => {
  if (!categories.length) {
    throw new Error("No categories provided.");
  }

  const [publishedUsage, pendingUsage] = await Promise.all([
    fetchPublishedCategoryUsage(),
    fetchPendingCategoryUsage()
  ]);

  const usageByCategory = mergeCounts(publishedUsage, pendingUsage);

  for (const category of categories) {
    if (!usageByCategory.has(category.id)) {
      usageByCategory.set(category.id, 0);
    }
  }

  const usageValues = categories.map((category) => usageByCategory.get(category.id) ?? 0);
  const minUsage = Math.min(...usageValues);

  // Keep randomness while preventing large category gaps from growing further.
  const candidatePool = categories.filter((category) => {
    const count = usageByCategory.get(category.id) ?? 0;
    return count <= minUsage + 1;
  });

  const pool = candidatePool.length > 0 ? candidatePool : categories;
  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex];
};
