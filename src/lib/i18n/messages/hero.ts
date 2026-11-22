import type { LocaleMessages } from "../types";

/**
 * Hero, market index strip and ticker strings.
 *
 * Keys are the exact English source strings rendered by
 * `src/components/Hero.tsx`, `src/components/MarketIndexStrip.tsx` and
 * `src/components/Ticker.tsx`. `en` stays empty because a missing entry falls
 * back to the key itself.
 */
export const messages: LocaleMessages = {
  en: {},
  es: {
    // Hero badge and intro
    "Live · Global commodity intelligence": "En vivo · Inteligencia global de materias primas",
    "Real-time 10-year forecasts for global":
      "Pronósticos en tiempo real a 10 años de los precios globales de",
    oil: "petróleo",
    electricity: "electricidad",
    "&": "y",
    water: "agua",
    "prices — with scenario bands, five-region evaluation, driver analysis and exportable analytics.":
      "— con bandas de escenarios, evaluación de cinco regiones, análisis de impulsores y analítica exportable.",
    "All figures in {currency} · 5 regions": "Todas las cifras en {currency} · 5 regiones",

    // Hero CTAs
    "Start Forecast": "Iniciar pronóstico",
    "Evaluate Regions": "Evaluar regiones",
    "Explore Drivers": "Explorar impulsores",

    // Hero stats
    Commodities: "Materias primas",
    "World regions": "Regiones del mundo",
    "Year horizon": "Horizonte en años",
    "Key drivers": "Impulsores clave",

    // Hero dashboard preview
    "Market snapshot": "Resumen del mercado",
    "Live global feed": "Flujo global en vivo",
    Live: "En vivo",
    "{horizon}-year trajectory": "Trayectoria de {horizon} años",
    Electricity: "Electricidad",
    Water: "Agua",
    "Model runs 100% in-browser · Americas → Oceania":
      "El modelo se ejecuta 100 % en el navegador · América → Oceanía",

    // Market index strip
    "Market index": "Índice de mercado",
    "Fuel levy": "Impuesto al combustible",
    "retail fuel vs baseline": "combustible minorista vs referencia",
    "Power tariff": "Tarifa eléctrica",
    "grid-adjusted electricity": "electricidad ajustada a la red",
    "Water scarcity": "Escasez de agua",
    "scarcity-adjusted water": "agua ajustada por escasez",
    "Loading analytics…": "Cargando analítica…",

    // Ticker
    "BRENT CRUDE": "PETRÓLEO BRENT",
    "GLOBAL POWER": "ENERGÍA GLOBAL",
    "GLOBAL WATER": "AGUA GLOBAL",
  },
  vi: {
    // Hero badge and intro
    "Live · Global commodity intelligence": "Trực tiếp · Trí tuệ hàng hóa toàn cầu",
    "Real-time 10-year forecasts for global":
      "Dự báo thời gian thực 10 năm cho giá toàn cầu của",
    oil: "dầu",
    electricity: "điện",
    "&": "và",
    water: "nước",
    "prices — with scenario bands, five-region evaluation, driver analysis and exportable analytics.":
      "— với các dải kịch bản, đánh giá năm khu vực, phân tích yếu tố thúc đẩy và phân tích có thể xuất.",
    "All figures in {currency} · 5 regions": "Tất cả số liệu tính bằng {currency} · 5 khu vực",

    // Hero CTAs
    "Start Forecast": "Bắt đầu dự báo",
    "Evaluate Regions": "Đánh giá khu vực",
    "Explore Drivers": "Khám phá yếu tố thúc đẩy",

    // Hero stats
    Commodities: "Hàng hóa",
    "World regions": "Khu vực thế giới",
    "Year horizon": "Tầm nhìn theo năm",
    "Key drivers": "Yếu tố thúc đẩy chính",

    // Hero dashboard preview
    "Market snapshot": "Tổng quan thị trường",
    "Live global feed": "Nguồn dữ liệu toàn cầu trực tiếp",
    Live: "Trực tiếp",
    "{horizon}-year trajectory": "Quỹ đạo {horizon} năm",
    Electricity: "Điện",
    Water: "Nước",
    "Model runs 100% in-browser · Americas → Oceania":
      "Mô hình chạy 100% trên trình duyệt · Châu Mỹ → Châu Đại Dương",

    // Market index strip
    "Market index": "Chỉ số thị trường",
    "Fuel levy": "Phụ thu nhiên liệu",
    "retail fuel vs baseline": "nhiên liệu bán lẻ so với mức cơ sở",
    "Power tariff": "Giá điện",
    "grid-adjusted electricity": "điện điều chỉnh theo lưới",
    "Water scarcity": "Khan hiếm nước",
    "scarcity-adjusted water": "nước điều chỉnh theo mức khan hiếm",
    "Loading analytics…": "Đang tải phân tích…",

    // Ticker
    "BRENT CRUDE": "DẦU BRENT",
    "GLOBAL POWER": "ĐIỆN TOÀN CẦU",
    "GLOBAL WATER": "NƯỚC TOÀN CẦU",
  },
};
