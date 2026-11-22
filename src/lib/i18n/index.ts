/**
 * i18n entry point.
 *
 * Merges every domain message module into one flat table per locale and
 * exposes `translate()`, the function behind the `t()` helper returned by
 * `useLanguage()`.
 *
 * Later modules are merged last, so they win on duplicate keys.
 */

import type { Locale, LocaleMessages, MessageTable } from "./types";
import { messages as settingsMessages } from "./messages/settings";
import { messages as navMessages } from "./messages/nav";
import { messages as heroMessages } from "./messages/hero";
import { messages as forecastMessages } from "./messages/forecast";
import { messages as factorsMessages } from "./messages/factors";
import { messages as regionalMessages } from "./messages/regional";
import { messages as solutionsMessages } from "./messages/solutions";
import { messages as correlationMessages } from "./messages/correlation";
import { messages as aboutMessages } from "./messages/about";

const MESSAGE_MODULES: LocaleMessages[] = [
  settingsMessages,
  navMessages,
  heroMessages,
  forecastMessages,
  factorsMessages,
  regionalMessages,
  solutionsMessages,
  correlationMessages,
  aboutMessages,
];

function mergeTables(locale: keyof LocaleMessages): MessageTable {
  const merged: MessageTable = {};
  for (const module of MESSAGE_MODULES) {
    Object.assign(merged, module[locale]);
  }
  return merged;
}

/** All translations, flattened per locale. */
export const MESSAGES: LocaleMessages = {
  en: mergeTables("en"),
  es: mergeTables("es"),
  vi: mergeTables("vi"),
};

/**
 * Translate an English source string for `locale`.
 *
 * Keys are English strings, so an unknown key falls back to the key itself.
 * `{name}` placeholders are replaced from `vars`; placeholders without a
 * matching variable are left untouched.
 */
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const template = locale === "en" ? key : (MESSAGES[locale]?.[key] ?? key);
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export type { Locale, LocaleMessages, LocaleMeta, MessageTable } from "./types";
export { SUPPORTED_LOCALES, LOCALE_META, isLocale } from "./types";
