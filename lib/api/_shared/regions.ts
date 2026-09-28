export const REGIONS = ["asia", "europe", "africa", "americas", "oceania"] as const;
export type Region = typeof REGIONS[number];

export const REGION_LABELS: Record<Region, string> = {
  asia: "Asia",
  europe: "Europe",
  africa: "Africa",
  americas: "the Americas",
  oceania: "Oceania",
};

export const REGION_NAMES: Record<Region, string> = {
  asia: "Asia",
  europe: "Europe",
  africa: "Africa",
  americas: "Americas",
  oceania: "Oceania",
};

export function isRegion(value: string | null | undefined): value is Region {
  return (REGIONS as readonly string[]).includes(value ?? "");
}

export function isCommodity(value: unknown): value is "oil" | "electricity" | "water" {
  return value === "oil" || value === "electricity" || value === "water";
}