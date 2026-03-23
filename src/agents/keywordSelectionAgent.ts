import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

dotenv.config();

export interface KeywordSelectionRequest {
  title: string;
  summary: string;
  content?: string;
  tags?: string[];
  categoryName?: string;
}

export interface KeywordSelectionResult {
  primaryKeywords: string[];
  fallbackKeywords: string[];
}

const parseKeywordResponse = (rawText: string): KeywordSelectionResult => {
  try {
    // Try to extract JSON from response (might be wrapped in markdown)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const result: KeywordSelectionResult = {
      primaryKeywords: Array.isArray(parsed.primaryKeywords)
        ? parsed.primaryKeywords.filter((k: any) => typeof k === "string" && k.length > 0).slice(0, 6)
        : ["organic farming"],
      fallbackKeywords: Array.isArray(parsed.fallbackKeywords)
        ? parsed.fallbackKeywords.filter((k: any) => typeof k === "string" && k.length > 0).slice(0, 3)
        : ["agriculture", "soil", "farming"]
    };

    if (result.primaryKeywords.length === 0) {
      result.primaryKeywords = ["organic farming"];
    }
    if (result.fallbackKeywords.length === 0) {
      result.fallbackKeywords = ["agriculture"];
    }

    return result;
  } catch (error) {
    console.error("[parseKeywordResponse] Failed to parse response:", rawText, error);
    return {
      primaryKeywords: ["organic farming", "agriculture"],
      fallbackKeywords: ["soil", "farming", "plants"]
    };
  }
};

export const createKeywordSelectionAgent = (): ChatOpenAI => {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const contextConfig = getAgentContextConfig();

  return new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    model: contextConfig.llm.imagePlannerModel,
    temperature: contextConfig.llm.imagePlannerTemperature
  });
};

export const selectImageKeywords = async (
  request: KeywordSelectionRequest
): Promise<KeywordSelectionResult> => {
  if (!request.title || !request.summary) {
    throw new Error("Title and summary are required for keyword selection.");
  }

  const agent = createKeywordSelectionAgent();

  const contentPreview = request.content ? request.content.substring(0, 2000) : "";
  const tagsStr = request.tags?.length ? request.tags.join(", ") : "";
  const categoryStr = request.categoryName || "";

  const prompt = `Bạn là chuyên gia tìm kiếm ảnh minh họa cho bài viết nông nghiệp.
Nhiệm vụ: Chọn các từ khóa tiếng Anh tối ưu để tìm ảnh phù hợp nhất với nội dung bài viết.

Bài viết:
- Tiêu đề: ${request.title}
- Danh mục: ${categoryStr}
- Tags: ${tagsStr}
- Tóm tắt: ${request.summary}
- Nội dung (đoạn đầu): ${contentPreview}

Yêu cầu:
1. Phân tích nội dung và xác định chủ đề chính, khía cạnh quan trọng
2. Chọn 4-6 từ khóa PRIMARY (tiếng Anh, 1-3 từ mỗi cái) có khả năng cao cho ra ảnh đúng chủ đề
   - Ưu tiên: cụ thể, bối cảnh nông nghiệp, không quá chung chung
   - Tránh: quá hẹp, không tìm thấy ảnh trên Pexels
3. Chọn 2-3 từ khóa FALLBACK (tiếng Anh) nếu primary không có ảnh
   - Là từ khóa rộng hơn, chắc chắn có kết quả trên Pexels

Trả về JSON object này (không thêm gì khác):
{
  "primaryKeywords": ["keyword1", "keyword2", "keyword3"],
  "fallbackKeywords": ["fallback1", "fallback2"]
}`;

  try {
    const response = await agent.invoke(prompt);
    const rawText =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    if (!rawText || rawText.length === 0) {
      throw new Error("Empty response from keyword selection agent");
    }

    return parseKeywordResponse(rawText);
  } catch (error) {
    console.error("[selectImageKeywords] Error with agent:", error);
    throw error;
  }
};
