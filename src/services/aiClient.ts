import OpenAI from "openai";

import { env } from "../utils/env.js";

const client = env.openAiApiKey
  ? new OpenAI({ apiKey: env.openAiApiKey })
  : null;

export const aiClient = {
  async generateText(prompt: string): Promise<string> {
    if (!client) {
      return "OPENAI_API_KEY is not configured.";
    }

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    return completion.output_text || "";
  }
};
