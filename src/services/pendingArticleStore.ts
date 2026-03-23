import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { PublishPostInput } from "./publishService.js";

export type PendingArticle = PublishPostInput & {
	id: string;
	createdAt: string;
};

type PendingArticleDb = {
	articles: PendingArticle[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "pending-articles.json");

const defaultDb = (): PendingArticleDb => ({ articles: [] });

const ensureDataFile = async (): Promise<void> => {
	await mkdir(DATA_DIR, { recursive: true });

	try {
		await readFile(DATA_FILE, "utf-8");
	} catch {
		await writeFile(DATA_FILE, JSON.stringify(defaultDb(), null, 2), "utf-8");
	}
};

const readDb = async (): Promise<PendingArticleDb> => {
	await ensureDataFile();

	try {
		const raw = await readFile(DATA_FILE, "utf-8");
		const parsed = JSON.parse(raw) as PendingArticleDb;
		if (!parsed || !Array.isArray(parsed.articles)) {
			return defaultDb();
		}

		return parsed;
	} catch {
		return defaultDb();
	}
};

const writeDb = async (db: PendingArticleDb): Promise<void> => {
	await ensureDataFile();
	await writeFile(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
};

export const savePendingArticle = async (article: PendingArticle): Promise<void> => {
	const db = await readDb();
	const existingIndex = db.articles.findIndex((item) => item.id === article.id);

	if (existingIndex >= 0) {
		db.articles[existingIndex] = article;
	} else {
		db.articles.push(article);
	}

	await writeDb(db);
};

export const getPendingArticleById = async (id: string): Promise<PendingArticle | null> => {
	const db = await readDb();
	return db.articles.find((item) => item.id === id) ?? null;
};

export const getLatestPendingArticle = async (): Promise<PendingArticle | null> => {
	const db = await readDb();
	if (!db.articles.length) {
		return null;
	}

	const latest = [...db.articles].sort((a, b) => {
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	})[0];

	return latest ?? null;
};

export const listPendingArticles = async (): Promise<PendingArticle[]> => {
	const db = await readDb();
	return db.articles;
};
