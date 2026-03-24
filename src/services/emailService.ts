import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

let resendClient: Resend | null = null;

export interface ApprovalEmailInput {
	id: string;
	title: string;
	summary: string;
	categoryName?: string;
	to?: string;
	approveLink?: string;
	rejectLink?: string;
}

export interface PublishedEmailInput {
	title: string;
	summary: string;
	categoryName?: string;
	articleUrl: string;
	to?: string;
}

const getResendClient = (): Resend => {
	if (resendClient) {
		return resendClient;
	}

	const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
	if (!apiKey) {
		throw new Error("RESEND_API_KEY must be set.");
	}

	resendClient = new Resend(apiKey);
	return resendClient;
};

const getFromAddress = (): string => {
	const from = (
		process.env.RESEND_FROM_EMAIL ??
		process.env.EMAIL_FROM ??
		process.env.EMAIL_USER ??
		""
	).trim();

	if (!from) {
		throw new Error("RESEND_FROM_EMAIL (or EMAIL_FROM) must be set.");
	}

	return from;
};

const getPublishedTemplateId = (): string => {
	return (process.env.RESEND_PUBLISHED_TEMPLATE_ID ?? "").trim();
};

const stripHtml = (value: string): string => {
	return value.replace(/<[^>]*>/g, " ");
};

const stripDataUriPayload = (value: string): string => {
	return value.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, "[embedded-image]");
};

const normalizeText = (value: string): string => {
	return value.replace(/\s+/g, " ").trim();
};

const sanitizeEmailText = (value: unknown, maxLength: number): string => {
	const raw = String(value ?? "");
	const cleaned = normalizeText(stripHtml(stripDataUriPayload(raw)));

	if (cleaned.length <= maxLength) {
		return cleaned;
	}

	return `${cleaned.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const escapeHtml = (value: string): string => {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
};

const sendMail = async (mailOptions: { to: string; subject: string; text: string; html: string }): Promise<void> => {
	const resend = getResendClient();
	const from = getFromAddress();

	const response = await resend.emails.send({
		from,
		to: mailOptions.to,
		subject: mailOptions.subject,
		text: mailOptions.text,
		html: mailOptions.html
	});

	if (response.error) {
		throw new Error(`Resend error: ${response.error.message}`);
	}
};

const sendTemplateMail = async (mailOptions: {
	to: string;
	subject: string;
	templateId: string;
	variables: {
		title: string;
		summary: string;
		categoryName: string;
		articleUrl: string;
	};
}): Promise<void> => {
	const resend = getResendClient();
	const from = getFromAddress();

	const response = await resend.emails.send({
		from,
		to: mailOptions.to,
		subject: mailOptions.subject,
		template: {
			id: mailOptions.templateId,
			variables: mailOptions.variables
		}
	} as any);

	if (response.error) {
		throw new Error(`Resend template error: ${response.error.message}`);
	}
};

const getApprovalBaseUrl = (): string => {
	const defaultAgentPort = (process.env.PORT ?? "4000").trim() || "4000";
	const base = (
		process.env.AGENT_BASE_URL ??
		process.env.APP_BASE_URL ??
		`http://localhost:${defaultAgentPort}`
	).trim();

	return base.replace(/\/$/, "");
};

export async function sendApprovalEmail(data: any): Promise<void> {
	const { title, summary, categoryName, id, to, approveLink, rejectLink } = data;

	if (!to) {
		throw new Error("Recipient email is required.");
	}

	const recipient = String(to).trim();
	const safeTitle = sanitizeEmailText(title, 180);
	const safeSummary = sanitizeEmailText(summary, 600);
	const safeCategoryName = sanitizeEmailText(categoryName ?? "", 120);

	const baseUrl = getApprovalBaseUrl();
	const finalApproveLink = approveLink ?? `${baseUrl}/approve/${id}`;
	const finalRejectLink = rejectLink ?? `${baseUrl}/reject/${id}`;

	await sendMail({
		to: recipient,
		subject: `Content Review: ${safeTitle}`,
		text: [
			`Title: ${safeTitle}`,
			safeCategoryName ? `Category: ${safeCategoryName}` : "",
			"",
			`Summary: ${safeSummary}`,
			"",
			`Approve: ${finalApproveLink}`,
			`Reject: ${finalRejectLink}`
		].join("\n"),
		html: `
		  <h2>${escapeHtml(safeTitle)}</h2>
		  ${safeCategoryName ? `<p><strong>Category:</strong> ${escapeHtml(safeCategoryName)}</p>` : ""}
		  <p><strong>Summary:</strong> ${escapeHtml(safeSummary)}</p>
		  <p>
		    <a href="${finalApproveLink}" style="margin-right: 12px;">Approve</a>
		    <a href="${finalRejectLink}">Reject</a>
		  </p>
		`
	});
}

export async function sendPublishedEmail(data: PublishedEmailInput): Promise<void> {
	const { title, summary, categoryName, articleUrl, to } = data;

	if (!to) {
		throw new Error("Recipient email is required.");
	}

	const recipient = String(to).trim();
	const safeTitle = sanitizeEmailText(title, 180);
	const safeSummary = sanitizeEmailText(summary, 600);
	const safeCategoryName = sanitizeEmailText(categoryName ?? "", 120);
	const normalizedArticleUrl = String(articleUrl ?? "").trim();
	if (!normalizedArticleUrl) {
		throw new Error("articleUrl is required.");
	}

	const templateId = getPublishedTemplateId();
	if (templateId) {
		await sendTemplateMail({
			to: recipient,
			subject: `Bản tin đã đăng: ${safeTitle}`,
			templateId,
			variables: {
				title: safeTitle,
				summary: safeSummary,
				categoryName: safeCategoryName,
				articleUrl: normalizedArticleUrl
			}
		});
		return;
	}

	await sendMail({
		to: recipient,
		subject: `Bản tin đã đăng: ${safeTitle}`,
		text: [
			`Tiêu đề: ${safeTitle}`,
			safeCategoryName ? `Danh mục: ${safeCategoryName}` : "",
			"",
			`Tóm tắt: ${safeSummary}`,
			"",
			`Đường dẫn bản tin: ${normalizedArticleUrl}`
		].join("\n"),
		html: `
		  <h2>${escapeHtml(safeTitle)}</h2>
		  ${safeCategoryName ? `<p><strong>Danh mục:</strong> ${escapeHtml(safeCategoryName)}</p>` : ""}
		  <p><strong>Tóm tắt:</strong> ${escapeHtml(safeSummary)}</p>
		  <p>
		    <a href="${normalizedArticleUrl}">Xem bản tin đã đăng</a>
		  </p>
		`
	});
}

