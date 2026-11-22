import type { Language } from "./dictionaries";

/** Appends `lang=<language>` to an API URL so server-generated content is returned in that language. */
export function withLang(url: string, language: Language): string {
  const [path, hash] = url.split("#", 2);
  const sep = path.includes("?") ? "&" : "?";
  const out = `${path}${sep}lang=${encodeURIComponent(language)}`;
  return hash === undefined ? out : `${out}#${hash}`;
}
