import fs from "node:fs";
import path from "node:path";

export type AgentContextConfig = {
  llm: {
    contentModel: string;
    contentTemperature: number;
    topicModel: string;
    topicTemperature: number;
    seoModel: string;
    seoTemperature: number;
    imagePlannerModel: string;
    imagePlannerTemperature: number;
  };
  content: {
    systemRolePrompt: string;
    mandatoryRequirements: string[];
    styleProfiles: string[];
  };
  workflow: {
    styleBlueprints: string[];
    templateVariations: string[];
  };
  topic: {
    strategyPrompt: string;
    requiredIntents: string[];
    requiredFormats: string[];
    topicsPerRun: number;
  };
  seo: {
    systemPrompt: string;
    metadataInstruction: string;
    jsonSchemaLines: string[];
    rules: string[];
  };
  image: {
    plannerPromptAddon: string;
    defaultFallbackQuery: string;
    minInlineImages: number;
    maxInlineImages: number;
    providerOrder: Array<"pexels" | "fallback">;
    keywordRules: Array<{ pattern: string; keyword: string }>;
    tokenTranslationMap: Record<string, string>;
    pexels: {
      endpoint: string;
      perPage: number;
      orientation: "landscape" | "portrait" | "square";
      size: "small" | "medium" | "large";
      timeoutMs: number;
    };
  };
};

export type PartialAgentContextConfig = Partial<{
  llm: Partial<AgentContextConfig["llm"]>;
  content: Partial<AgentContextConfig["content"]>;
  workflow: Partial<AgentContextConfig["workflow"]>;
  topic: Partial<AgentContextConfig["topic"]>;
  seo: Partial<AgentContextConfig["seo"]>;
  image: Partial<AgentContextConfig["image"]>;
}>;

const CONFIG_PATH = path.join(process.cwd(), "data", "agent-context-config.json");

const DEFAULT_CONFIG: AgentContextConfig = {
  llm: {
    contentModel: "gpt-4o-mini",
    contentTemperature: 0.7,
    topicModel: "gpt-4o-mini",
    topicTemperature: 0.7,
    seoModel: "gpt-4o-mini",
    seoTemperature: 0.4,
    imagePlannerModel: "gpt-4o-mini",
    imagePlannerTemperature: 0.25
  },
  content: {
    systemRolePrompt: "Bạn là chuyên gia viết blog SEO cho website nông nghiệp.",
    mandatoryRequirements: [
      "Độ dài 1200-1500 từ.",
      "Có cấu trúc H1/H2/H3 rõ ràng.",
      "Tích hợp từ khóa chính tự nhiên.",
      "Có mẹo thực tế để áp dụng ngay.",
      "Văn phong dễ đọc, hữu ích.",
      "Kết bài có tóm tắt và gợi ý hành động.",
      "Đa dạng khung bài viết giữa các lần tạo.",
      "Không lặp một khung heading cố định.",
      "Tránh lặp lại cụm từ cần tránh."
    ],
    styleProfiles: [
      "Giọng tư vấn thực chiến, ngắn gọn.",
      "Giọng chuyên gia kỹ thuật dễ hiểu.",
      "Giọng phân tích dữ liệu thực tế.",
      "Giọng đồng hành cùng nông hộ.",
      "Giọng so sánh ưu nhược điểm."
    ]
  },
  workflow: {
    styleBlueprints: [
      "Khung vấn đề-nguyên nhân-giải pháp.",
      "Khung hướng dẫn từng bước theo timeline.",
      "Khung sai lầm thường gặp và khắc phục.",
      "Khung hỏi đáp + so sánh lựa chọn.",
      "Khung case study gia đình."
    ],
    templateVariations: [
      "Template A: bối cảnh -> 3 phần -> khuyến nghị áp dụng.",
      "Template B: câu hỏi lớn -> nguyên nhân -> giải pháp.",
      "Template C: lỗi phổ biến -> chẩn đoán -> kế hoạch.",
      "Template D: bảng tiêu chí -> khuyến nghị.",
      "Template E: mini case study -> bài học -> tự kiểm tra."
    ]
  },
  topic: {
    strategyPrompt: "You are a content strategist for an agriculture knowledge and ecommerce website.",
    requiredIntents: ["informational", "commercial investigation", "transactional support", "troubleshooting", "seasonal planning"],
    requiredFormats: ["step-by-step guide", "mistakes list", "FAQ", "comparison table", "case-study", "action framework"],
    topicsPerRun: 5
  },
  seo: {
    systemPrompt: "Bạn là chuyên gia SEO cho website bán đất hữu cơ.",
    metadataInstruction: "Tối ưu metadata SEO và trả về bằng tiếng Việt.",
    jsonSchemaLines: [
      "{",
      "  \"seoTitle\": \"string\",",
      "  \"metaDescription\": \"string\",",
      "  \"tags\": [\"string\"],",
      "  \"summary\": \"string\"",
      "}"
    ],
    rules: [
      "seoTitle tối đa 60 ký tự.",
      "metaDescription 140-160 ký tự.",
      "tags từ 5 đến 8 thẻ.",
      "summary ngắn gọn, đúng trọng tâm."
    ]
  },
  image: {
    plannerPromptAddon: "Ưu tiên ảnh sát ngữ cảnh nông nghiệp Việt Nam.",
    defaultFallbackQuery: "organic farming soil",
    minInlineImages: 1,
    maxInlineImages: 3,
    providerOrder: ["pexels", "fallback"],
    keywordRules: [
      { pattern: "(tuoi nuoc dung cach|tuoi nuoc|tuoi tieu|he thong tuoi|tuoi nho giot|tuoi phun|irrigation)", keyword: "irrigation system" },
      { pattern: "(loai cay trong|giong cay|cay trong theo loai|type of plant|plants?)", keyword: "type of plants" },
      { pattern: "(dat huu co|dat trong|soil)", keyword: "organic soil" },
      { pattern: "(phan bon huu co|phan bon|compost|fertilizer)", keyword: "organic fertilizer" },
      { pattern: "(sau benh|sau hai|pest|disease)", keyword: "pest control" },
      { pattern: "(vuon nha|vuon|garden)", keyword: "home garden" },
      { pattern: "(nong nghiep huu co|canh tac huu co|organic farming)", keyword: "organic farming" },
      { pattern: "(mua mua|thoat nuoc|drainage)", keyword: "garden drainage" },
      { pattern: "(hat giong|gieo hat|seedling|seed)", keyword: "plant seedlings" },
      { pattern: "(u phan|u compost|lam compost|composting)", keyword: "composting organic waste" },
      { pattern: "(che phu dat|phu rom|mulch|mulching)", keyword: "mulching garden soil" },
      { pattern: "(luan canh|xen canh|crop rotation|intercropping)", keyword: "crop rotation farming" },
      { pattern: "(nha luoi|nha mang|greenhouse|net house)", keyword: "greenhouse vegetable farming" },
      { pattern: "(thuy canh|hydroponic|hydroponics)", keyword: "hydroponic vegetable system" },
      { pattern: "(gia the|xo dua|coir|substrate)", keyword: "coco coir growing media" },
      { pattern: "(phan trun que|vermicompost|earthworm compost)", keyword: "vermicompost organic fertilizer" },
      { pattern: "(vi sinh|microbial|beneficial bacteria)", keyword: "beneficial soil microbes" },
      { pattern: "(nha trong cay|v\u01b0\u1eddn san thuong|vuon ban cong|urban farming)", keyword: "urban rooftop garden" },
      { pattern: "(rau an la|x\u00e0 lach|cai xanh|leafy greens)", keyword: "leafy greens cultivation" },
      { pattern: "(ca chua|dua leo|ot|tomato|cucumber|chili)", keyword: "vegetable trellis cultivation" },
      { pattern: "(co dai|lam co|weed control|weed)", keyword: "organic weed control" },
      { pattern: "(thu hoach|bao quan|sau thu hoach|post harvest)", keyword: "post harvest handling" },
      { pattern: "(phong benh|nam benh|fungus|blight|powdery mildew)", keyword: "plant disease prevention" },
      { pattern: "(phan huu co vi sinh|bio fertilizer|biofertilizer)", keyword: "biofertilizer application" }
    ],
    tokenTranslationMap: {
      tuoi: "irrigation",
      tieu: "irrigation",
      he: "system",
      thong: "system",
      nho: "drip",
      giot: "drip",
      phun: "sprinkler",
      loai: "type",
      giong: "variety",
      cay: "plants",
      trong: "planting",
      vuon: "garden",
      nha: "home",
      dat: "soil",
      huu: "organic",
      co: "organic",
      phan: "fertilizer",
      bon: "fertilizer",
      sau: "pest",
      benh: "disease",
      nong: "agriculture",
      nghiep: "agriculture",
      mua: "rain",
      thoat: "drainage",
      nuoc: "water",
      hat: "seed",
      gieo: "sowing",
      mam: "seedling",
      gia: "substrate",
      the: "substrate",
      xo: "coir",
      dua: "coir",
      u: "composting",
      rom: "straw",
      che: "mulch",
      phu: "mulch",
      luan: "rotation",
      xen: "intercrop",
      canh: "cultivation",
      luoi: "net",
      mang: "greenhouse",
      thuy: "hydroponic",
      rau: "vegetable",
      la: "leafy",
      quay: "bed",
      luong: "bed",
      thu: "harvest",
      hoach: "harvest",
      bao: "storage",
      quan: "storage",
      vi: "microbial",
      sinh: "microbial",
      trun: "worm",
      que: "worm",
      nam: "fungus",
      co_dai: "weed",
      lam: "control"
    },
    pexels: {
      endpoint: "https://api.pexels.com/v1/search",
      perPage: 12,
      orientation: "landscape",
      size: "large",
      timeoutMs: 9000
    }
  }
};

let inMemoryConfig: AgentContextConfig | null = null;

const sanitizeString = (value: unknown, fallback: string): string => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
};

const sanitizeStringArray = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return cleaned.length > 0 ? cleaned : fallback;
};

const sanitizeProviderOrder = (value: unknown, fallback: Array<"pexels" | "fallback">): Array<"pexels" | "fallback"> => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value
    .filter((item) => item === "pexels" || item === "fallback") as Array<"pexels" | "fallback">;

  return cleaned.length > 0 ? [...new Set(cleaned)] : fallback;
};

const sanitizeKeywordRules = (value: unknown, fallback: Array<{ pattern: string; keyword: string }>): Array<{ pattern: string; keyword: string }> => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value
    .map((item) => ({
      pattern: typeof item?.pattern === "string" ? item.pattern.trim() : "",
      keyword: typeof item?.keyword === "string" ? item.keyword.trim() : ""
    }))
    .filter((item) => item.pattern.length > 0 && item.keyword.length > 0);

  return cleaned.length > 0 ? cleaned : fallback;
};

const sanitizeTokenMap = (value: unknown, fallback: Record<string, string>): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  const entries = Object.entries(value)
    .map(([key, val]) => [String(key).trim(), typeof val === "string" ? val.trim() : ""] as const)
    .filter(([key, val]) => key.length > 0 && val.length > 0);

  if (entries.length === 0) {
    return fallback;
  }

  return Object.fromEntries(entries);
};

const sanitizeTemperature = (value: unknown, fallback: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.max(0, Math.min(2, num));
};

const sanitizeInteger = (value: unknown, min: number, max: number, fallback: number): number => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(num)));
};

const normalizeConfig = (raw: PartialAgentContextConfig | null | undefined): AgentContextConfig => {
  const topicsPerRun = sanitizeInteger(raw?.topic?.topicsPerRun, 1, 10, DEFAULT_CONFIG.topic.topicsPerRun);
  const minInlineImages = sanitizeInteger(raw?.image?.minInlineImages, 0, 8, DEFAULT_CONFIG.image.minInlineImages);
  const maxInlineImages = sanitizeInteger(raw?.image?.maxInlineImages, minInlineImages, 12, DEFAULT_CONFIG.image.maxInlineImages);

  const perPage = sanitizeInteger(raw?.image?.pexels?.perPage, 1, 40, DEFAULT_CONFIG.image.pexels.perPage);
  const timeoutMs = sanitizeInteger(raw?.image?.pexels?.timeoutMs, 1000, 30000, DEFAULT_CONFIG.image.pexels.timeoutMs);
  const orientation = raw?.image?.pexels?.orientation;
  const size = raw?.image?.pexels?.size;

  return {
    llm: {
      contentModel: sanitizeString(raw?.llm?.contentModel, DEFAULT_CONFIG.llm.contentModel),
      contentTemperature: sanitizeTemperature(raw?.llm?.contentTemperature, DEFAULT_CONFIG.llm.contentTemperature),
      topicModel: sanitizeString(raw?.llm?.topicModel, DEFAULT_CONFIG.llm.topicModel),
      topicTemperature: sanitizeTemperature(raw?.llm?.topicTemperature, DEFAULT_CONFIG.llm.topicTemperature),
      seoModel: sanitizeString(raw?.llm?.seoModel, DEFAULT_CONFIG.llm.seoModel),
      seoTemperature: sanitizeTemperature(raw?.llm?.seoTemperature, DEFAULT_CONFIG.llm.seoTemperature),
      imagePlannerModel: sanitizeString(raw?.llm?.imagePlannerModel, DEFAULT_CONFIG.llm.imagePlannerModel),
      imagePlannerTemperature: sanitizeTemperature(raw?.llm?.imagePlannerTemperature, DEFAULT_CONFIG.llm.imagePlannerTemperature)
    },
    content: {
      systemRolePrompt: sanitizeString(raw?.content?.systemRolePrompt, DEFAULT_CONFIG.content.systemRolePrompt),
      mandatoryRequirements: sanitizeStringArray(raw?.content?.mandatoryRequirements, DEFAULT_CONFIG.content.mandatoryRequirements),
      styleProfiles: sanitizeStringArray(raw?.content?.styleProfiles, DEFAULT_CONFIG.content.styleProfiles)
    },
    workflow: {
      styleBlueprints: sanitizeStringArray(raw?.workflow?.styleBlueprints, DEFAULT_CONFIG.workflow.styleBlueprints),
      templateVariations: sanitizeStringArray(raw?.workflow?.templateVariations, DEFAULT_CONFIG.workflow.templateVariations)
    },
    topic: {
      strategyPrompt: sanitizeString(raw?.topic?.strategyPrompt, DEFAULT_CONFIG.topic.strategyPrompt),
      requiredIntents: sanitizeStringArray(raw?.topic?.requiredIntents, DEFAULT_CONFIG.topic.requiredIntents),
      requiredFormats: sanitizeStringArray(raw?.topic?.requiredFormats, DEFAULT_CONFIG.topic.requiredFormats),
      topicsPerRun
    },
    seo: {
      systemPrompt: sanitizeString(raw?.seo?.systemPrompt, DEFAULT_CONFIG.seo.systemPrompt),
      metadataInstruction: sanitizeString(raw?.seo?.metadataInstruction, DEFAULT_CONFIG.seo.metadataInstruction),
      jsonSchemaLines: sanitizeStringArray(raw?.seo?.jsonSchemaLines, DEFAULT_CONFIG.seo.jsonSchemaLines),
      rules: sanitizeStringArray(raw?.seo?.rules, DEFAULT_CONFIG.seo.rules)
    },
    image: {
      plannerPromptAddon: sanitizeString(raw?.image?.plannerPromptAddon, DEFAULT_CONFIG.image.plannerPromptAddon),
      defaultFallbackQuery: sanitizeString(raw?.image?.defaultFallbackQuery, DEFAULT_CONFIG.image.defaultFallbackQuery),
      minInlineImages,
      maxInlineImages,
      providerOrder: sanitizeProviderOrder(raw?.image?.providerOrder, DEFAULT_CONFIG.image.providerOrder),
      keywordRules: sanitizeKeywordRules(raw?.image?.keywordRules, DEFAULT_CONFIG.image.keywordRules),
      tokenTranslationMap: sanitizeTokenMap(raw?.image?.tokenTranslationMap, DEFAULT_CONFIG.image.tokenTranslationMap),
      pexels: {
        endpoint: sanitizeString(raw?.image?.pexels?.endpoint, DEFAULT_CONFIG.image.pexels.endpoint),
        perPage,
        orientation: orientation === "landscape" || orientation === "portrait" || orientation === "square"
          ? orientation
          : DEFAULT_CONFIG.image.pexels.orientation,
        size: size === "small" || size === "medium" || size === "large"
          ? size
          : DEFAULT_CONFIG.image.pexels.size,
        timeoutMs
      }
    }
  };
};

const ensureConfigDir = (): void => {
  const dirPath = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const readConfigFromDisk = (): AgentContextConfig => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return DEFAULT_CONFIG;
    }

    const rawText = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(rawText) as PartialAgentContextConfig;
    return normalizeConfig(parsed);
  } catch (error) {
    console.warn("[agent-context-config] Failed to read config file. Using defaults.", error);
    return DEFAULT_CONFIG;
  }
};

const writeConfigToDisk = (config: AgentContextConfig): void => {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
};

export const getDefaultAgentContextConfig = (): AgentContextConfig => {
  return normalizeConfig(DEFAULT_CONFIG);
};

export const getAgentContextConfig = (): AgentContextConfig => {
  if (inMemoryConfig) {
    return inMemoryConfig;
  }

  inMemoryConfig = readConfigFromDisk();
  return inMemoryConfig;
};

export const saveAgentContextConfig = (nextConfig: PartialAgentContextConfig): AgentContextConfig => {
  const current = getAgentContextConfig();
  const merged: PartialAgentContextConfig = {
    llm: { ...current.llm, ...(nextConfig.llm ?? {}) },
    content: { ...current.content, ...(nextConfig.content ?? {}) },
    workflow: { ...current.workflow, ...(nextConfig.workflow ?? {}) },
    topic: { ...current.topic, ...(nextConfig.topic ?? {}) },
    seo: { ...current.seo, ...(nextConfig.seo ?? {}) },
    image: {
      ...current.image,
      ...(nextConfig.image ?? {}),
      pexels: {
        ...current.image.pexels,
        ...(nextConfig.image?.pexels ?? {})
      }
    }
  };

  const normalized = normalizeConfig(merged);
  writeConfigToDisk(normalized);
  inMemoryConfig = normalized;
  return normalized;
};

export const resetAgentContextConfig = (): AgentContextConfig => {
  const defaults = getDefaultAgentContextConfig();
  writeConfigToDisk(defaults);
  inMemoryConfig = defaults;
  return defaults;
};
