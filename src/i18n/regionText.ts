import type { RegionProfile } from "../lib/model";
import { DEFAULT_LANGUAGE, dictionaries, type Language, type TranslationKey } from "./dictionaries";

/**
 * Returns a copy of a region profile with its English display strings
 * (name, blurb, oilMarker, drivers) replaced by the dictionary translation for
 * `lang`. Missing keys fall back to the English values on the profile.
 */
export function localizeRegion(region: RegionProfile, lang: Language): RegionProfile {
  const dict: Record<string, string> = dictionaries[lang] ?? dictionaries[DEFAULT_LANGUAGE];
  const get = (suffix: string, fallback: string) =>
    dict[`region.${region.id}.${suffix}` as TranslationKey] ?? fallback;
  return {
    ...region,
    name: get("name", region.name),
    blurb: get("blurb", region.blurb),
    oilMarker: get("oilMarker", region.oilMarker),
    drivers: region.drivers.map((d, i) => get(`driver.${i}`, d)),
  };
}
