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

	const baseUrl = getApprovalBaseUrl();
	const finalApproveLink = approveLink ?? `${baseUrl}/approve/${id}`;
	const finalRejectLink = rejectLink ?? `${baseUrl}/reject/${id}`;

	await sendMail({
		to: recipient,
		subject: `Content Review: ${title}`,
		text: [
			`Title: ${title}`,
			categoryName ? `Category: ${categoryName}` : "",
			"",
			`Summary: ${summary}`,
			"",
			`Approve: ${finalApproveLink}`,
			`Reject: ${finalRejectLink}`
		].join("\n"),
		html: `
		  <h2>${title}</h2>
		  ${categoryName ? `<p><strong>Category:</strong> ${categoryName}</p>` : ""}
		  <p><strong>Summary:</strong> ${summary}</p>
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
	const normalizedArticleUrl = String(articleUrl ?? "").trim();
	if (!normalizedArticleUrl) {
		throw new Error("articleUrl is required.");
	}

	await sendMail({
		to: recipient,
		subject: `Bản tin đã đăng: ${title}`,
		text: [
			`Tiêu đề: ${title}`,
			categoryName ? `Danh mục: ${categoryName}` : "",
			"",
			`Tóm tắt: ${summary}`,
			"",
			`Đường dẫn bản tin: ${normalizedArticleUrl}`
		].join("\n"),
		html: `
		  <h2>${title}</h2>
		  ${categoryName ? `<p><strong>Danh mục:</strong> ${categoryName}</p>` : ""}
		  <p><strong>Tóm tắt:</strong> ${summary}</p>
		  <p>
		    <a href="${normalizedArticleUrl}">Xem bản tin đã đăng</a>
		  </p>
		`
	});
}

