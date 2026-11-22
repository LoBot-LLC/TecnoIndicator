export type Language = "en" | "es" | "vi";

export type TranslationKey = string;

const TRANSLATIONS: Record<Language, Record<TranslationKey, string>> = {
  en: {
    Settings: "Settings",
    "Close settings": "Close settings",
    "Fonts & themes": "Fonts & themes",
    "Color theme": "Color theme",
    Light: "Light",
    Dark: "Dark",
    System: "System",
    Font: "Font",
    "Preview: The quick brown fox — 012345": "Preview: The quick brown fox — 012345",
    "Unit conversion": "Unit conversion",
    Currency: "Currency",
    "Search currency…": "Search currency…",
    "Search currencies": "Search currencies",
    "Length / volume": "Length / volume",
    Energy: "Energy",
    Language: "Language",
    "Select language": "Select language",
    "Unit conversions update in real time. Currency selection reloads to apply across all data.":
      "Unit conversions update in real time. Currency selection reloads to apply across all data.",
    Export: "Export",
    "Chart as PNG": "Chart as PNG",
    "Data as CSV": "Data as CSV",
    "Data as MD": "Data as MD",
    "Settings (currency, theme, fonts, units)": "Settings (currency, theme, fonts, units)",
    "Settings Menu": "Settings Menu",
    "Language selector": "Language selector",
    "Select your preferred language from the dropdown below": "Select your preferred language from the dropdown below",
    "View source on GitHub": "View source on GitHub",
    "Close menu": "Close menu",
    "Open menu": "Open menu",
    Forecast: "Forecast",
    Regions: "Regions",
    Factors: "Factors",
    About: "About",
    "Download chart as PNG": "Download chart as PNG",
    "Download data as CSV": "Download data as CSV",
    "Download data as Markdown": "Download data as Markdown",
    // FactorsSection.tsx
    "Key factors & drivers": "Key factors & drivers",
    "AI-Curated Factors": "AI-Curated Factors",
    "Status: {healthStatus}": "Status: {healthStatus}",
    "Loading factors…": "Loading factors…",
    "No live price factors are available right now. Reasons are only shown when they can be traced to a fetched source URL.":
      "No live price factors are available right now. Reasons are only shown when they can be traced to a fetched source URL.",
    "Relevance automatically reweights as you change the horizon — short horizons emphasize policy and inventories; longer ones highlight structural transition and scarcity.":
      "Relevance automatically reweights as you change the horizon — short horizons emphasize policy and inventories; longer ones highlight structural transition and scarcity.",
    // MarketIndexStrip.tsx
    "Market index · {profile.flag} {profile.name}": "Market index · {profile.flag} {profile.name}",
    "Loading analytics…": "Loading analytics…",
    "Fuel levy": "Fuel levy",
    "Power tariff": "Power tariff",
    "Water scarcity": "Water scarcity",
    "retail fuel vs baseline": "retail fuel vs baseline",
    "grid-adjusted electricity": "grid-adjusted electricity",
    "scarcity-adjusted water": "scarcity-adjusted water",
    // CorrelationSection.tsx / RegionalEvaluation.tsx
    "Factor–price correlation": "Factor–price correlation",
    "Correlation matrix": "Correlation matrix",
    "Pearson correlation between each top factor's contribution series and the forecasted price path, for {horizon}-year horizon in {region}. Select a factor to see per-region detail.":
      "Pearson correlation between each top factor's contribution series and the forecasted price path, for {horizon}-year horizon in {region}. Select a factor to see per-region detail.",
    "No factors available for correlation right now.": "No factors available for correlation right now.",
    "Increase the horizon to at least 2 years to compute correlations.": "Increase the horizon to at least 2 years to compute correlations.",
    "Open {meta?.name ?? d.regionId} in regions (correlation {formatR(d.r)})":
      "Open {meta?.name ?? d.regionId} in regions (correlation {formatR(d.r)})",
    // Footer.tsx
    "Download chart (PNG)": "Download chart (PNG)",
    "Download data (CSV)": "Download data (CSV)",
    "Regional evaluation": "Regional evaluation",
    "Live water price": "Live water price",
    Navigate: "Navigate",
    Resources: "Resources",
    // AboutSection.tsx
    Transparency: "Transparency",
    "About the model": "About the model",
    "Public data & reasoning sources": "Public data & reasoning sources",
    "Base prices, growth rates, regional differentials and driver narratives are grounded in publicly available research.":
      "Base prices, growth rates, regional differentials and driver narratives are grounded in publicly available research.",
    "Want to run your own scenarios? Press {key} to jump to the horizon slider and watch the cards, chart, regions and factor grid respond in real time.":
      "Want to run your own scenarios? Press {key} to jump to the horizon slider and watch the cards, chart, regions and factor grid respond in real time.",
    // Ticker.tsx
    "BRENT CRUDE": "BRENT CRUDE",
    "GLOBAL POWER": "GLOBAL POWER",
    "GLOBAL WATER": "GLOBAL WATER",
    oil: "oil",
    electricity: "electricity",
    water: "water",
    name: "name",
    icon: "icon",
    color: "color",
    displayValue: "displayValue",
    unit: "unit",
    delta: "delta",
    up: "up",
  },
  es: {
    Settings: "Ajustes",
    "Close settings": "Cerrar ajustes",
    "Fonts & themes": "Fuentes y temas",
    "Color theme": "Tema de color",
    Light: "Claro",
    Dark: "Oscuro",
    System: "Sistema",
    Font: "Fuente",
    "Preview: The quick brown fox — 012345": "Vista previa: el rápido zorro marrón — 012345",
    "Unit conversion": "Conversión de unidades",
    Currency: "Moneda",
    "Search currency…": "Buscar moneda…",
    "Search currencies": "Buscar monedas",
    "Length / volume": "Longitud / volumen",
    Energy: "Energía",
    Language: "Idioma",
    "Select language": "Seleccionar idioma",
    "Unit conversions update in real time. Currency selection reloads to apply across all data.":
      "Las conversiones de unidades se actualizan en tiempo real. La selección de moneda recarga la página para aplicarse a todos los datos.",
    Export: "Exportar",
    "Chart as PNG": "Gráfico como PNG",
    "Data as CSV": "Datos como CSV",
    "Data as MD": "Datos como MD",
    "Settings (currency, theme, fonts, units)": "Ajustes (moneda, tema, fuentes, unidades)",
    "Settings Menu": "Menú de Ajustes",
    "Language selector": "Selector de idioma",
    "Select your preferred language from the dropdown below": "Selecciona tu idioma preferido desde el menú desplegable",
  },
  vi: {
    Settings: "Cài đặt",
    "Close settings": "Thoát cài đặt",
    "Fonts & themes": "Phông chữ & chủ đề",
    "Color theme": "Chủ đề màu sắc",
    Light: "Sáng",
    Dark: "Tối",
    System: "Hệ thống",
    Font: "Phông chữ",
    "Preview: The quick brown fox — 012345": "Xem trước: chú cáo nâu nhanh — 012345",
    "Unit conversion": "Chuyển đổi đơn vị",
    Currency: "Tiền tệ",
    "Search currency…": "Tìm kiếm tiền tệ…",
    "Search currencies": "Tìm kiếm tiền tệ",
    "Length / volume": "Chiều dài / thể tích",
    Energy: "Năng lượng",
    Language: "Ngôn ngữ",
    "Select language": "Chọn ngôn ngữ",
    "Unit conversions update in real time. Currency selection reloads to apply across all data.":
      "Chuyển đổi đơn vị cập nhật theo thời gian thực. Chọn tiền tệ sẽ tải lại để áp dụng cho toàn bộ dữ liệu.",
    Export: "Xuất",
    "Chart as PNG": "Biểu đồ dạng PNG",
    "Data as CSV": "Dữ liệu dạng CSV",
    "Data as MD": "Dữ liệu dạng MD",
    "Settings (currency, theme, fonts, units)": "Cài đặt (tiền tệ, chủ đề, phông chữ, đơn vị)",
    "Settings Menu": "Menu Cài đặt",
    "Language selector": "Chọn ngôn ngữ",
    "Select your preferred language from the dropdown below": "Chọn ngôn ngữ mong muốn từ thanh thả xuống dưới",
  },
};

export function getTranslation(key: TranslationKey, language: Language = "en"): string {
  const langTranslations = TRANSLATIONS[language] ?? TRANSLATIONS.en;
  return langTranslations[key] ?? TRANSLATIONS.en[key] ?? key;
}

export function getLanguageTranslations(language: Language): Record<string, string> {
  return TRANSLATIONS[language] ?? TRANSLATIONS.en;
}

/**
 * Name of the language in its own script, used when instructing the Kilo Gateway
 * to translate AI-generated (web-searched) content into the selected language.
 */
export function getLanguageName(language: Language): string {
  switch (language) {
    case "es":
      return "Spanish";
    case "vi":
      return "Vietnamese";
    default:
      return "English";
  }
}

export const LANGUAGE_OPTIONS: Array<{ code: Language; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "vi", label: "Tiếng Việt" },
];

export const DEFAULT_LANGUAGE: Language = "en";

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "es" || value === "vi";
}