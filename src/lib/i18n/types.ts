/**
 * Core i18n types shared by the message modules, the translator and the
 * `LanguageProvider`.
 *
 * Translation keys ARE the English source strings (e.g. `"Forecast"`), so a
 * missing entry always degrades gracefully to readable English.
 */

export const SUPPORTED_LOCALES = ["en", "es", "vi"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export interface LocaleMeta {
  /** BCP-47 language code used for storage and `<html lang>`. */
  code: Locale;
  /** Name of the language in that language, for the language picker. */
  label: string;
  /** English name of the language, useful for logs and accessibility. */
  englishLabel: string;
}

export const LOCALE_META: LocaleMeta[] = [
  { code: "en", label: "English", englishLabel: "English" },
  { code: "es", label: "Español", englishLabel: "Spanish" },
  { code: "vi", label: "Tiếng Việt", englishLabel: "Vietnamese" },
];

/** A flat key → translation map. Keys are the English source strings. */
export type MessageTable = Record<string, string>;

/** Per-locale message tables for one UI domain. */
export interface LocaleMessages {
  en: MessageTable;
  es: MessageTable;
  vi: MessageTable;
}

/** Type guard for values read from storage or user input. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
