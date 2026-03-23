import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

let cachedToken: string | null = null;

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

const getAgentCredentials = (): { email: string; password: string } => {
	const email = process.env.AGENT_EMAIL?.trim();
	const password = process.env.AGENT_PASSWORD?.trim();

	if (!email || !password) {
		throw new Error("AGENT_EMAIL and AGENT_PASSWORD must be configured.");
	}

	return { email, password };
};

const extractToken = (payload: any): string => {
	const candidates = [
		payload?.token,
		payload?.accessToken,
		payload?.jwt,
		payload?.data?.token,
		payload?.data?.accessToken,
		payload?.user?.token
	];

	for (const item of candidates) {
		if (typeof item === "string" && item.trim()) {
			return item.trim();
		}
	}

	throw new Error("Login succeeded but JWT token was not found in response.");
};

export const loginAndGetToken = async (): Promise<string> => {
	const { email, password } = getAgentCredentials();

	try {
		const response = await axios.post(buildBackendUrl("/auth/login"), {
			email,
			password
		});

		const token = extractToken(response.data);
		cachedToken = token;
		return token;
	} catch (error) {
		console.error("[authService] Failed to login to backend:", error);
		throw error;
	}
};

export const getAuthToken = async (): Promise<string> => {
	if (cachedToken) {
		return cachedToken;
	}

	return loginAndGetToken();
};

export const refreshAuthToken = async (): Promise<string> => {
	cachedToken = null;
	return loginAndGetToken();
};
