import dotenv from "dotenv";
import nodemailer from "nodemailer";
import dns from "node:dns";

dotenv.config();

// Prefer IPv4 globally to avoid cloud environments that cannot route IPv6 SMTP traffic.
if (typeof dns.setDefaultResultOrder === "function") {
	dns.setDefaultResultOrder("ipv4first");
}

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

const buildLookupByFamily = (forcedFamily: 4 | 6) => {
	return (
		hostname: string,
		optionsOrCallback: any,
		maybeCallback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
	) => {
		const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
		if (typeof callback !== "function") {
			return;
		}

		dns.lookup(hostname, { family: forcedFamily, all: false, verbatim: false }, callback);
	};
};

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
		},
		// Always force IPv4 to avoid Render's IPv6 SMTP routing issues
		family: 4,
		lookup: (
			hostname: string,
			optionsOrCallback: any,
			maybeCallback?: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
		) => buildLookupByFamily(4)(hostname, optionsOrCallback, maybeCallback)
	};

	return nodemailer.createTransport(transportOptions);
};

const shouldRetryWithFallback = (error: unknown): boolean => {
	const maybe = error as any;
	const code = typeof maybe?.code === "string" ? maybe.code.trim().toUpperCase() : "";
	return code === "ETIMEDOUT" || code === "ENETUNREACH" || code === "ECONNRESET";
};

const createGmailFallbackTransporter = () => {
	const user = process.env.EMAIL_USER;
	const pass = process.env.EMAIL_PASS;

	if (!user || !pass) {
		throw new Error("EMAIL_USER and EMAIL_PASS must be set.");
	}

	const smtpHost = (process.env.SMTP_HOST ?? "smtp.gmail.com").trim();
	const fallbackPort = Number(process.env.SMTP_FALLBACK_PORT ?? 587);

	const transportOptions: any = {
		host: smtpHost,
		port: Number.isFinite(fallbackPort) ? fallbackPort : 587,
		secure: false,
		family: 4,
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

	// Keep fallback path on IPv4 for cloud providers where IPv6 SMTP route is unstable.
	transportOptions.lookup = buildLookupByFamily(4);

	return nodemailer.createTransport(transportOptions);
};

const sendMailWithRetry = async (mailOptions: nodemailer.SendMailOptions): Promise<void> => {
	const primary = createGmailTransporter();

	try {
		await primary.sendMail(mailOptions);
		return;
	} catch (error) {
		if (!shouldRetryWithFallback(error)) {
			throw error;
		}

		console.warn("[emailService] Primary SMTP connection failed, retry with fallback config.", error);
	}

	const fallback = createGmailFallbackTransporter();
	await fallback.sendMail(mailOptions);
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

	const from = process.env.EMAIL_USER as string;

	await sendMailWithRetry({
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

	const from = process.env.EMAIL_USER as string;

	await sendMailWithRetry({
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

