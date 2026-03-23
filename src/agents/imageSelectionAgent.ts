import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { getAgentContextConfig } from "../services/agentContextConfigService.js";

dotenv.config();

export interface PexelsPhotoMetadata {
  id: number;
  url: string;
  photographer: string;
  alt: string;
  width: number;
  height: number;
}

export interface ImageSelectionRequest {
  articleTitle: string;
  articleSummary: string;
  articleContent?: string;
  searchKeyword: string;
  availableImages: PexelsPhotoMetadata[];
  imageName?: string;
}

export interface ImageSelectionResult {
  selectedImageId: number;
  selectedImageUrl: string;
  selectedPhotographer: string;
  reason: string;
}

const parseImageSelectionResponse = (rawText: string): { selectedImageIndex: number; reason: string } => {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      selectedImageIndex: Math.max(0, Math.min(parseInt(parsed.selectedImageIndex) || 0, 11)),
      reason: typeof parsed.reason === "string" ? parsed.reason : "Selected by AI evaluation"
    };
  } catch (error) {
    console.error("[parseImageSelectionResponse] Parse error:", error);
    return {
      selectedImageIndex: 0,
      reason: "AI evaluation failed, using first image"
    };
  }
};

export const createImageSelectionAgent = (): ChatOpenAI => {
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

export const selectBestImage = async (
  request: ImageSelectionRequest
): Promise<ImageSelectionResult> => {
  if (!request.articleTitle || !request.availableImages || request.availableImages.length === 0) {
    throw new Error("Article title and available images are required.");
  }

  // Build image list with descriptions
  const imageListStr = request.availableImages
    .map(
      (img, idx) =>
        `[${idx}] ID: ${img.id} | Alt: "${img.alt}" | Photographer: ${img.photographer} | Size: ${img.width}x${img.height}`
    )
    .join("\n");

  const contentPreview = request.articleContent ? request.articleContent.substring(0, 1500) : "";

  const prompt = `Bạn là biên tập viên hình ảnh chuyên lựa chọn ảnh phù hợp cho bài viết nông nghiệp.
Nhiệm vụ: Chọn ảnh TỐT NHẤT từ danh sách ảnh tìm được trên Pexels dựa vào nội dung bài viết.

Bài viết:
- Tiêu đề: ${request.articleTitle}
- Từ khóa tìm: ${request.searchKeyword}
- Mục đích ảnh: ${request.imageName || "General illustration"}
- Tóm tắt: ${request.articleSummary}
- Nội dung (đoạn đầu): ${contentPreview}

Danh sách ảnh tìm được (${request.availableImages.length} hình):
${imageListStr}

Yêu cầu:
1. Đọc kỹ alt text (mô tả) của từng ảnh
2. Đánh giá độ phù hợp với nội dung bài (chủ đề, tông màu, bối cảnh)
3. Chọn ảnh có:
   - Mô tả phù hợp nhất với từ khóa tìm và nội dung bài
   - Chất lượng cao (hình rõ, không mờ)
   - Không có văn bản hay logo che phủ
   - Bối cảnh phù hợp với nông nghiệp (nếu khả năng)
4. Trả lại INDEX (0-${request.availableImages.length - 1}) của ảnh được chọn + lý do

Trả về JSON object này (không thêm gì khác):
{
  "selectedImageIndex": <number 0 to ${request.availableImages.length - 1}>,
  "reason": "explanation why this image is best"
}`;

  try {
    const agent = createImageSelectionAgent();
    const response = await agent.invoke(prompt);
    const rawText =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    if (!rawText || rawText.length === 0) {
      throw new Error("Empty response from image selection agent");
    }

    const selection = parseImageSelectionResponse(rawText);
    const safeIndex = Math.max(0, Math.min(selection.selectedImageIndex, request.availableImages.length - 1));
    const selectedImage = request.availableImages[safeIndex];

    return {
      selectedImageId: selectedImage.id,
      selectedImageUrl: selectedImage.url,
      selectedPhotographer: selectedImage.photographer,
      reason: selection.reason
    };
  } catch (error) {
    console.error("[selectBestImage] Error with agent:", error);
    // Fallback to first image
    const fallbackImage = request.availableImages[0];
    return {
      selectedImageId: fallbackImage.id,
      selectedImageUrl: fallbackImage.url,
      selectedPhotographer: fallbackImage.photographer,
      reason: "AI selection failed, using first available image"
    };
  }
};
