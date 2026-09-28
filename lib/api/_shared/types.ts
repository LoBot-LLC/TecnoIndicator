export const REGIONS = ["asia", "europe", "africa", "americas", "oceania"] as const;
export type Region = typeof REGIONS[number];
export type RegionId = Region | "global";

export const VALID_CATEGORIES = ["Market", "Policy", "Structural", "Infrastructure", "Environmental", "Geopolitical", "Technological"] as const;
export type Category = typeof VALID_CATEGORIES[number];

export type CommodityId = "oil" | "electricity" | "water";

export interface Factor {
  id: string;
  name: string;
  category: string;
  commodities: CommodityId[];
  explanation: string;
  direction: "up" | "down" | "mixed";
  magnitude: "High" | "Medium" | "Low";
  source: string;
  bias: "short" | "mid" | "long" | "flat";
  drift: Partial<Record<CommodityId, number>>;
  regions?: RegionId[];
  scope: "global" | Region;
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ForecastPoint {
  year: number;
  label: string;
  oil: {
    avg: number;
    min: number;
    max: number;
  };
  electricity: {
    avg: number;
    min: number;
    max: number;
  };
  water: {
    avg: number;
    min: number;
    max: number;
  };
}

export interface RegionalForecastPoint {
  region: Region;
  year: number;
  label: string;
  oil: {
    avg: number;
    min: number;
    max: number;
  };
  electricity: {
    avg: number;
    min: number;
    max: number;
  };
  water: {
    avg: number;
    min: number;
    max: number;
  };
}

export interface AnalyticsSnapshot {
  fuelLevy: number;
  electricityTariffAdjustmentIndex: number;
  waterScarcityAdjustedPriceIndex: number;
  dataSource: string;
  isLive: boolean;
  timestamp: string;
}

export interface RegionalAnalyticsSnapshot {
  region: Region;
  fuelLevy: number;
  electricityTariffAdjustmentIndex: number;
  waterScarcityAdjustedPriceIndex: number;
  dataSource: string;
  isLive: boolean;
  timestamp: string;
}

export interface KiloResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    logprobs: null;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface KiloStatus {
  available: boolean;
  zeroCostModels: string[];
  defaultModel: string;
  activeModel: string | null;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
  rateLimitedModels: string[];
  globalRateLimited: boolean;
  catalogLastRefresh: string | null;
  keyFormats: {
    jwt: number;
    opaque: number;
    unrecognized: number;
  };
}

export interface TinyFishStatus {
  available: boolean;
  configuredKeys: number;
  usableKeys: number;
  rateLimitedKeys: number[];
}

export interface Solution {
  id: string;
  title: string;
  summary: string;
  actions: string[];
  commodities: CommodityId[];
  regions?: RegionId[];
  scope: "global" | Region;
  relatedFactors: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface SolutionsResponse {
  solutions: Solution[];
  scope: "global" | Region;
  count: number;
  aiCurated: boolean;
  cacheKey: string;
  updatedAt: string;
}