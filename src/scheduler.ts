import cron, { type ScheduledTask } from "node-cron";
import { randomUUID } from "node:crypto";
import { CronExpressionParser } from "cron-parser";

import { appendRunLog, createQueuedRun, getAgentDashboard, getAgentRuns, setRunFailed, setRunStarted, setRunSucceeded, type AgentRunReason, type AgentRunResultMeta } from "./services/agentRunStore.js";
import { runContentWorkflow } from "./workflows/contentWorkflow.js";

let runningTask: ScheduledTask | null = null;
let isWorkflowRunning = false;

const toBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
	if (typeof value !== "string") {
		return defaultValue;
	}

	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") {
		return true;
	}

	if (normalized === "false" || normalized === "0" || normalized === "no") {
		return false;
	}

	return defaultValue;
};

const getSchedulerConfig = () => {
	const enabled = toBoolean(process.env.NEWS_PUBLISH_CRON_ENABLED, true);
	const expression = (process.env.NEWS_PUBLISH_CRON ?? "0 9 * * *").trim();
	const timezone = (process.env.NEWS_PUBLISH_CRON_TIMEZONE ?? "Asia/Ho_Chi_Minh").trim();
	const runOnStartup = toBoolean(process.env.NEWS_PUBLISH_ON_STARTUP, false);

	return {
		enabled,
		expression,
		timezone,
		runOnStartup
	};
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  const maybe = error as any;
  if (typeof maybe?.message === "string" && maybe.message.trim()) {
    return maybe.message.trim();
  }

  return "Unknown workflow error";
};

const sanitizeText = (value: string): string => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const countWords = (htmlOrText: string): number => {
	const normalized = sanitizeText(htmlOrText);
	if (!normalized) {
		return 0;
	}

	return normalized.split(" ").filter(Boolean).length;
};

const countImages = (htmlOrText: string): number => {
	const matches = htmlOrText.match(/<img\b/gi);
	return matches?.length ?? 0;
};

const buildRunResultMeta = (result: Awaited<ReturnType<typeof runContentWorkflow>>): AgentRunResultMeta => {
	return {
		keyword: result.topic.keyword,
		categoryName: result.topic.intent || undefined,
		tags: result.seo.tags,
		wordCount: countWords(result.article),
		imageCount: countImages(result.article)
	};
};

const runWorkflowSafely = async (reason: AgentRunReason): Promise<void> => {
	const runId = randomUUID();
	createQueuedRun(runId, reason);

	if (isWorkflowRunning) {
		const message = `[scheduler] Skip ${reason} run: previous workflow execution is still in progress.`;
		console.warn(message);
		setRunFailed(runId, "Skipped because another run is in progress.");
		return;
	}

	isWorkflowRunning = true;
	const startedAt = Date.now();
	setRunStarted(runId);

	try {
		const startMessage = `[scheduler] Starting content workflow (${reason})...`;
		console.log(startMessage);
		appendRunLog(runId, "info", startMessage);
		const result = await runContentWorkflow();
		const durationMs = Date.now() - startedAt;
		const doneMessage = `[scheduler] Workflow completed in ${durationMs}ms. Published title: \"${result.seo.seoTitle}\"`;
		console.log(doneMessage);
		setRunSucceeded(runId, result.seo.seoTitle, buildRunResultMeta(result));
	} catch (error) {
		const message = getErrorMessage(error);
		console.error(`[scheduler] Workflow failed during ${reason} run:`, error);
		setRunFailed(runId, message);
	} finally {
		isWorkflowRunning = false;
	}
};

export const triggerContentWorkflowNow = async (): Promise<void> => {
  await runWorkflowSafely("manual");
};

export const getSchedulerOverview = () => {
  const config = getSchedulerConfig();
  return {
    cronEnabled: config.enabled,
    cronExpression: config.expression,
    timezone: config.timezone,
    runOnStartup: config.runOnStartup,
    ...getAgentDashboard()
  };
};

export const getSchedulerRuns = (limit = 20, status?: "queued" | "running" | "success" | "failed") => {
  return getAgentRuns(limit, status);
};

export const validateCronExpression = (expression: string): { valid: boolean; error?: string } => {
	const trimmed = expression.trim();
	
	if (!trimmed) {
		return { valid: false, error: "Cron expression cannot be empty" };
	}

	if (!cron.validate(trimmed)) {
		return { valid: false, error: `Invalid cron expression: ${trimmed}` };
	}

	try {
		CronExpressionParser.parse(trimmed);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid cron expression";
		return { valid: false, error: message };
	}

	return { valid: true };
};

export const validateTimezone = (timezone: string): { valid: boolean; error?: string } => {
	const trimmed = timezone.trim();

	if (!trimmed) {
		return { valid: false, error: "Timezone cannot be empty" };
	}

	// node-cron doesn't export timezone validation, so we try to schedule and catch errors
	try {
		const testTask = cron.schedule("0 0 * * *", () => {}, { timezone: trimmed });
		testTask.stop();
		return { valid: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown timezone error";
		return { valid: false, error: `Invalid timezone "${trimmed}": ${message}` };
	}
};

const buildNextRunTimes = (expression: string, timezone: string, count = 5): string[] => {
	const validation = validateCronExpression(expression);
	if (!validation.valid) {
		return [];
	}

	const timezoneValidation = validateTimezone(timezone);
	if (!timezoneValidation.valid) {
		return [];
	}

	try {
		const interval = CronExpressionParser.parse(expression.trim(), {
			tz: timezone.trim(),
			currentDate: new Date()
		});

		const nextTimes: string[] = [];
		for (let i = 0; i < count; i += 1) {
			const next = interval.next();
			if (!next) {
				break;
			}

			const iso = next.toISOString();
			if (!iso) {
				break;
			}

			nextTimes.push(iso);
		}

		return nextTimes;
	} catch (error) {
		console.error("[scheduler] Error calculating next run times:", error);
		return [];
	}
};

export const getNextRunTimes = (count = 5): string[] => {
	const config = getSchedulerConfig();

	if (!config.enabled) {
		return [];
	}

	return buildNextRunTimes(config.expression, config.timezone, count);
};

export const getNextRunTimesPreview = (
	expression: string,
	timezone: string,
	count = 5
): string[] => buildNextRunTimes(expression, timezone, count);

export type SchedulerConfigUpdateInput = {
	expression?: string;
	timezone?: string;
	enabled?: boolean;
	runOnStartup?: boolean;
};

export const updateSchedulerConfig = (
	input: SchedulerConfigUpdateInput
): { success: boolean; error?: string } => {
	try {
		const newExpression = typeof input.expression === "string" ? input.expression.trim() : undefined;
		const newTimezone = typeof input.timezone === "string" ? input.timezone.trim() : undefined;
		const newEnabled = typeof input.enabled === "boolean" ? input.enabled : undefined;
		const newRunOnStartup = typeof input.runOnStartup === "boolean" ? input.runOnStartup : undefined;

		// Validate inputs
		if (newExpression) {
			const validation = validateCronExpression(newExpression);
			if (!validation.valid) {
				return { success: false, error: validation.error };
			}
		}

		if (newTimezone) {
			const validation = validateTimezone(newTimezone);
			if (!validation.valid) {
				return { success: false, error: validation.error };
			}
		}

		// Update process.env
		if (newExpression) {
			process.env.NEWS_PUBLISH_CRON = newExpression;
		}

		if (newTimezone) {
			process.env.NEWS_PUBLISH_CRON_TIMEZONE = newTimezone;
		}

		if (typeof newEnabled === "boolean") {
			process.env.NEWS_PUBLISH_CRON_ENABLED = String(newEnabled);
		}

		if (typeof newRunOnStartup === "boolean") {
			process.env.NEWS_PUBLISH_ON_STARTUP = String(newRunOnStartup);
		}

		// Restart the scheduler with new config
		stopContentPublishScheduler();
		if (toBoolean(process.env.NEWS_PUBLISH_CRON_ENABLED, true)) {
			startContentPublishScheduler();
		}

		const config = getSchedulerConfig();
		const message = `[scheduler] Config updated: enabled=${config.enabled}, expression="${config.expression}", timezone="${config.timezone}", runOnStartup=${config.runOnStartup}`;
		console.log(message);

		return { success: true };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error";
		return { success: false, error: `Failed to update config: ${errorMessage}` };
	}
};

export const startContentPublishScheduler = (): void => {
	if (runningTask) {
		return;
	}

	const { enabled, expression, timezone, runOnStartup } = getSchedulerConfig();

	if (!enabled) {
		console.log("[scheduler] NEWS_PUBLISH_CRON is disabled by configuration.");
		return;
	}

	if (!cron.validate(expression)) {
		throw new Error(`[scheduler] Invalid NEWS_PUBLISH_CRON expression: ${expression}`);
	}

	runningTask = cron.schedule(expression, () => {
		void runWorkflowSafely("cron");
	}, {
		timezone
	});

	console.log(`[scheduler] Content publish cron started. expression=\"${expression}\", timezone=\"${timezone}\"`);

	if (runOnStartup) {
		void runWorkflowSafely("startup");
	}
};

export const stopContentPublishScheduler = (): void => {
	if (!runningTask) {
		return;
	}

	runningTask.stop();
	runningTask = null;
	console.log("[scheduler] Content publish cron stopped.");
};

