export type AgentRunStatus = "queued" | "running" | "success" | "failed";
export type AgentRunReason = "cron" | "startup" | "manual";

export type AgentRunLog = {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
};

export type AgentRunResultMeta = {
  keyword?: string;
  categoryName?: string;
  tags?: string[];
  wordCount?: number;
  imageCount?: number;
};

export type AgentRunRecord = {
  id: string;
  reason: AgentRunReason;
  status: AgentRunStatus;
  queuedAt: string;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  title?: string;
  error?: string;
  resultMeta?: AgentRunResultMeta;
  logs: AgentRunLog[];
};

const MAX_RUN_HISTORY = 120;

let currentRunId: string | null = null;
const runs: AgentRunRecord[] = [];

const nowIso = (): string => new Date().toISOString();

const trimHistory = (): void => {
  if (runs.length <= MAX_RUN_HISTORY) {
    return;
  }

  runs.splice(MAX_RUN_HISTORY);
};

const pushLog = (record: AgentRunRecord, level: AgentRunLog["level"], message: string): void => {
  record.logs.unshift({
    at: nowIso(),
    level,
    message
  });

  if (record.logs.length > 40) {
    record.logs.splice(40);
  }
};

const findRun = (runId: string): AgentRunRecord | null => {
  return runs.find((item) => item.id === runId) ?? null;
};

export const createQueuedRun = (runId: string, reason: AgentRunReason): AgentRunRecord => {
  const queuedAt = nowIso();
  const record: AgentRunRecord = {
    id: runId,
    reason,
    status: "queued",
    queuedAt,
    logs: []
  };

  pushLog(record, "info", `Run queued (${reason}).`);
  runs.unshift(record);
  trimHistory();
  return record;
};

export const setRunStarted = (runId: string): void => {
  const record = findRun(runId);
  if (!record) {
    return;
  }

  record.status = "running";
  record.startedAt = nowIso();
  currentRunId = runId;
  pushLog(record, "info", "Workflow started.");
};

export const appendRunLog = (runId: string, level: AgentRunLog["level"], message: string): void => {
  const record = findRun(runId);
  if (!record) {
    return;
  }

  pushLog(record, level, message);
};

export const setRunSucceeded = (runId: string, title?: string, resultMeta?: AgentRunResultMeta): void => {
  const record = findRun(runId);
  if (!record) {
    return;
  }

  record.status = "success";
  record.endedAt = nowIso();
  record.title = title;
  if (resultMeta) {
    record.resultMeta = resultMeta;
  }

  if (record.startedAt) {
    record.durationMs = Date.parse(record.endedAt) - Date.parse(record.startedAt);
  }

  pushLog(record, "info", title ? `Workflow succeeded. Published: ${title}` : "Workflow succeeded.");

  if (currentRunId === runId) {
    currentRunId = null;
  }
};

export const setRunFailed = (runId: string, error: string): void => {
  const record = findRun(runId);
  if (!record) {
    return;
  }

  record.status = "failed";
  record.endedAt = nowIso();
  record.error = error;

  if (record.startedAt) {
    record.durationMs = Date.parse(record.endedAt) - Date.parse(record.startedAt);
  }

  pushLog(record, "error", `Workflow failed: ${error}`);

  if (currentRunId === runId) {
    currentRunId = null;
  }
};

export const getAgentRuns = (limit = 20, status?: AgentRunStatus): AgentRunRecord[] => {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const filtered = status ? runs.filter((item) => item.status === status) : runs;
  return filtered.slice(0, safeLimit);
};

const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.round((sum / values.length) * 100) / 100;
};

const percentile = (values: number[], p: number): number => {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
};

const topN = (counter: Map<string, number>, limit = 5): Array<{ label: string; count: number }> => {
  return Array.from(counter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
};

export const getAgentDashboard = () => {
  const byStatus = {
    queued: runs.filter((item) => item.status === "queued").length,
    running: runs.filter((item) => item.status === "running").length,
    success: runs.filter((item) => item.status === "success").length,
    failed: runs.filter((item) => item.status === "failed").length
  };

  const latest = runs[0] ?? null;
  const successfulRuns = runs.filter((item) => item.status === "success");
  const failedRuns = runs.filter((item) => item.status === "failed");
  const completedDurations = runs
    .filter((item) => typeof item.durationMs === "number" && Number.isFinite(item.durationMs))
    .map((item) => item.durationMs as number);

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent24h = runs.filter((item) => Date.parse(item.queuedAt) >= dayAgo);
  const recent24hSuccess = recent24h.filter((item) => item.status === "success").length;
  const recent24hFailed = recent24h.filter((item) => item.status === "failed").length;

  const keywordCounter = new Map<string, number>();
  const categoryCounter = new Map<string, number>();
  const allTagCounter = new Map<string, number>();

  let totalWords = 0;
  let totalImages = 0;
  let totalTags = 0;
  let withWordCount = 0;
  let withImageCount = 0;
  let noImageArticles = 0;

  for (const run of successfulRuns) {
    const meta = run.resultMeta;
    if (!meta) {
      continue;
    }

    if (meta.keyword) {
      keywordCounter.set(meta.keyword, (keywordCounter.get(meta.keyword) ?? 0) + 1);
    }

    if (meta.categoryName) {
      categoryCounter.set(meta.categoryName, (categoryCounter.get(meta.categoryName) ?? 0) + 1);
    }

    if (typeof meta.wordCount === "number" && Number.isFinite(meta.wordCount)) {
      totalWords += meta.wordCount;
      withWordCount += 1;
    }

    if (typeof meta.imageCount === "number" && Number.isFinite(meta.imageCount)) {
      totalImages += meta.imageCount;
      withImageCount += 1;
      if (meta.imageCount === 0) {
        noImageArticles += 1;
      }
    }

    if (Array.isArray(meta.tags)) {
      totalTags += meta.tags.length;
      for (const tag of meta.tags) {
        if (!tag) {
          continue;
        }

        const normalized = tag.trim();
        if (!normalized) {
          continue;
        }

        allTagCounter.set(normalized, (allTagCounter.get(normalized) ?? 0) + 1);
      }
    }
  }

  const successRate = runs.length ? Math.round((successfulRuns.length / runs.length) * 10000) / 100 : 0;
  const failureRate = runs.length ? Math.round((failedRuns.length / runs.length) * 10000) / 100 : 0;

  return {
    online: true,
    isRunning: currentRunId !== null,
    queuedJobs: byStatus.queued,
    totalRuns: runs.length,
    byStatus,
    latestRun: latest,
    uptimeSeconds: Math.round(process.uptime()),
    successRate,
    failureRate,
    performance: {
      avgDurationMs: average(completedDurations),
      p95DurationMs: percentile(completedDurations, 95),
      last24hRuns: recent24h.length,
      last24hSuccess: recent24hSuccess,
      last24hFailed: recent24hFailed
    },
    contentInsights: {
      totalPublished: successfulRuns.length,
      avgWordCount: withWordCount ? Math.round(totalWords / withWordCount) : 0,
      avgTagsPerArticle: successfulRuns.length ? Math.round((totalTags / successfulRuns.length) * 100) / 100 : 0,
      topKeywords: topN(keywordCounter, 5),
      topCategories: topN(categoryCounter, 5),
      topTags: topN(allTagCounter, 8),
      recentPublished: successfulRuns.slice(0, 8).map((run) => ({
        id: run.id,
        title: run.title ?? "-",
        keyword: run.resultMeta?.keyword ?? "",
        categoryName: run.resultMeta?.categoryName ?? "",
        publishedAt: run.endedAt ?? run.queuedAt
      }))
    },
    imageInsights: {
      totalImages,
      avgImagesPerArticle: withImageCount ? Math.round((totalImages / withImageCount) * 100) / 100 : 0,
      noImageArticles,
      withImageArticles: withImageCount - noImageArticles,
      coverageRate: withImageCount ? Math.round((((withImageCount - noImageArticles) / withImageCount) * 10000)) / 100 : 0
    },
    recentFailures: failedRuns.slice(0, 5).map((run) => ({
      id: run.id,
      at: run.endedAt ?? run.queuedAt,
      reason: run.reason,
      error: run.error ?? "Unknown"
    }))
  };
};
