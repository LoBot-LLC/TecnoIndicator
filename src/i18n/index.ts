import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enAbout from "./locales/en/about.json";
import enCommon from "./locales/en/common.json";
import enCorrelation from "./locales/en/correlation.json";
import enFactors from "./locales/en/factors.json";
import enFooter from "./locales/en/footer.json";
import enForecast from "./locales/en/forecast.json";
import enHero from "./locales/en/hero.json";
import enMarket from "./locales/en/market.json";
import enNavbar from "./locales/en/navbar.json";
import enRegional from "./locales/en/regional.json";
import enSettings from "./locales/en/settings.json";
import enSolutions from "./locales/en/solutions.json";

import esAbout from "./locales/es/about.json";
import esCommon from "./locales/es/common.json";
import esCorrelation from "./locales/es/correlation.json";
import esFactors from "./locales/es/factors.json";
import esFooter from "./locales/es/footer.json";
import esForecast from "./locales/es/forecast.json";
import esHero from "./locales/es/hero.json";
import esMarket from "./locales/es/market.json";
import esNavbar from "./locales/es/navbar.json";
import esRegional from "./locales/es/regional.json";
import esSettings from "./locales/es/settings.json";
import esSolutions from "./locales/es/solutions.json";

import viAbout from "./locales/vi/about.json";
import viCommon from "./locales/vi/common.json";
import viCorrelation from "./locales/vi/correlation.json";
import viFactors from "./locales/vi/factors.json";
import viFooter from "./locales/vi/footer.json";
import viForecast from "./locales/vi/forecast.json";
import viHero from "./locales/vi/hero.json";
import viMarket from "./locales/vi/market.json";
import viNavbar from "./locales/vi/navbar.json";
import viRegional from "./locales/vi/regional.json";
import viSettings from "./locales/vi/settings.json";
import viSolutions from "./locales/vi/solutions.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "vi", label: "Tiếng Việt" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const DEFAULT_NAMESPACE = "common";

export const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    navbar: enNavbar,
    factors: enFactors,
    regional: enRegional,
    hero: enHero,
    forecast: enForecast,
    correlation: enCorrelation,
    solutions: enSolutions,
    about: enAbout,
    footer: enFooter,
    market: enMarket,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    navbar: esNavbar,
    factors: esFactors,
    regional: esRegional,
    hero: esHero,
    forecast: esForecast,
    correlation: esCorrelation,
    solutions: esSolutions,
    about: esAbout,
    footer: esFooter,
    market: esMarket,
  },
  vi: {
    common: viCommon,
    settings: viSettings,
    navbar: viNavbar,
    factors: viFactors,
    regional: viRegional,
    hero: viHero,
    forecast: viForecast,
    correlation: viCorrelation,
    solutions: viSolutions,
    about: viAbout,
    footer: viFooter,
    market: viMarket,
  },
} as const;

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    defaultNS: DEFAULT_NAMESPACE,
    interpolation: { escapeValue: false },
  });
}

export default i18n;
