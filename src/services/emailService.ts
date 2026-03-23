import dotenv from "dotenv";
import nodemailer from "nodemailer";
import dns from "node:dns";

dotenv.config();

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

const createGmailTransporter = () => {
	const user = process.env.EMAIL_USER;
	const pass = process.env.EMAIL_PASS;

	if (!user || !pass) {
		throw new Error("EMAIL_USER and EMAIL_PASS must be set.");
	}

	const smtpHost = (process.env.SMTP_HOST ?? "smtp.gmail.com").trim();
	const smtpPort = Number(process.env.SMTP_PORT ?? 465);
	const smtpSecure = String(process.env.SMTP_SECURE ?? "true").trim().toLowerCase() !== "false";
	const smtpFamilyRaw = String(process.env.SMTP_FAMILY ?? "").trim();
	const smtpFamily = smtpFamilyRaw === "4" ? 4 : smtpFamilyRaw === "6" ? 6 : undefined;

	const transportOptions: any = {
		host: smtpHost,
		port: Number.isFinite(smtpPort) ? smtpPort : 465,
		secure: smtpSecure,
		auth: {
			user,
			pass
		},
		connectionTimeout: 15000,
		greetingTimeout: 15000,
		socketTimeout: 20000,
		tls: {
			servername: smtpHost
		}
	};

	if (smtpFamily) {
		transportOptions.lookup = (
			hostname: string,
			_options: any,
			callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
		) => {
			dns.lookup(hostname, { family: smtpFamily }, callback);
		};
	}

	return nodemailer.createTransport(transportOptions);
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

	const transporter = createGmailTransporter();
	const from = process.env.EMAIL_USER as string;

	await transporter.sendMail({
		from,
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

	const transporter = createGmailTransporter();
	const from = process.env.EMAIL_USER as string;

	await transporter.sendMail({
		from,
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

