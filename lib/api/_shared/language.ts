export type ApiLanguage = "en" | "es" | "vi";

export const API_LANGUAGES: readonly ApiLanguage[] = ["en", "es", "vi"];

export const DEFAULT_API_LANGUAGE: ApiLanguage = "en";

export const LANGUAGE_NAMES: Record<ApiLanguage, string> = {
  en: "English",
  es: "Spanish",
  vi: "Vietnamese",
};

export function parseLanguage(value: unknown): ApiLanguage {
  if (typeof value !== "string") return DEFAULT_API_LANGUAGE;
  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];
  return (API_LANGUAGES as readonly string[]).includes(normalized)
    ? (normalized as ApiLanguage)
    : DEFAULT_API_LANGUAGE;
}

export function languageInstruction(lang: ApiLanguage): string {
  if (lang === "en") return "";
  const target = LANGUAGE_NAMES[lang];
  return `Write all output text in ${target}. The source material you are analyzing may be written in English; translate its key insights into ${target} while preserving meaning. Keep numbers, units, currency codes, percentages, dates, tickers, symbols, URLs, emails, and proper nouns (organization names such as IEA, OPEC, EIA) unchanged.`;
}

export function languageFromRequest(req: Request, body?: unknown): ApiLanguage {
  const url = new URL(req.url, "http://localhost");
  const fromQuery = url.searchParams.get("lang");
  if (fromQuery !== null) return parseLanguage(fromQuery);
  if (body && typeof body === "object" && "lang" in body) {
    return parseLanguage((body as { lang?: unknown }).lang);
  }
  return DEFAULT_API_LANGUAGE;
}
