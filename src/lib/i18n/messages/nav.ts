import type { LocaleMessages } from "../types";

/**
 * Navigation, header, logo and footer strings.
 *
 * Keys are the exact English source strings rendered by
 * `src/components/Navbar.tsx`, `src/components/Logo.tsx` and
 * `src/components/Footer.tsx`. `en` stays empty because a missing entry falls
 * back to the key itself.
 */
export const messages: LocaleMessages = {
  en: {},
  es: {
    // Navigation
    Forecast: "Pronóstico",
    Regions: "Regiones",
    Factors: "Factores",
    About: "Acerca de",
    Primary: "Principal",
    Mobile: "Móvil",
    "Close menu": "Cerrar menú",
    "Open menu": "Abrir menú",

    // Export menu
    Export: "Exportar",
    "Chart as PNG": "Gráfico como PNG",
    "Data as CSV": "Datos como CSV",
    "Data as MD": "Datos como MD",
    "View source on GitHub": "Ver código fuente en GitHub",
    "Download chart as PNG": "Descargar gráfico como PNG",
    "Download data as CSV": "Descargar datos como CSV",
    "Download data as Markdown": "Descargar datos como Markdown",

    // Logo
    "LoBot LLC home": "Inicio de LoBot LLC",
    "LoBot TecnoIndicator home": "Inicio de LoBot TecnoIndicator",

    // Footer
    "LoBot LLC is a Vietnamese AI-native startup that creates business solutions enabling large enterprises to make future-ready strategic decisions.":
      "LoBot LLC es una startup vietnamita nativa de IA que crea soluciones empresariales que permiten a las grandes empresas tomar decisiones estratégicas preparadas para el futuro.",
    "LoBot LLC on GitHub": "LoBot LLC en GitHub",
    "LoBot LLC on LinkedIn": "LoBot LLC en LinkedIn",
    "Visit LoBot LLC company website": "Visitar el sitio web de LoBot LLC",
    Footer: "Pie de página",
    Navigate: "Navegar",
    Resources: "Recursos",
    "Download chart (PNG)": "Descargar gráfico (PNG)",
    "Download data (CSV)": "Descargar datos (CSV)",
    "Regional evaluation": "Evaluación regional",
    "Live water price": "Precio del agua en vivo",
    "LoBot, LLC - All rights reserved": "LoBot, LLC - Todos los derechos reservados",
    "Last updated:": "Última actualización:",
    "· Model uses publicly available drivers.":
      "· El modelo utiliza variables disponibles públicamente.",
  },
  vi: {
    // Navigation
    Forecast: "Dự báo",
    Regions: "Khu vực",
    Factors: "Yếu tố",
    About: "Giới thiệu",
    Primary: "Chính",
    Mobile: "Di động",
    "Close menu": "Đóng menu",
    "Open menu": "Mở menu",

    // Export menu
    Export: "Xuất",
    "Chart as PNG": "Biểu đồ dạng PNG",
    "Data as CSV": "Dữ liệu dạng CSV",
    "Data as MD": "Dữ liệu dạng MD",
    "View source on GitHub": "Xem mã nguồn trên GitHub",
    "Download chart as PNG": "Tải biểu đồ dạng PNG",
    "Download data as CSV": "Tải dữ liệu dạng CSV",
    "Download data as Markdown": "Tải dữ liệu dạng Markdown",

    // Logo
    "LoBot LLC home": "Trang chủ LoBot LLC",
    "LoBot TecnoIndicator home": "Trang chủ LoBot TecnoIndicator",

    // Footer
    "LoBot LLC is a Vietnamese AI-native startup that creates business solutions enabling large enterprises to make future-ready strategic decisions.":
      "LoBot LLC là một startup Việt Nam thuần AI, chuyên tạo ra các giải pháp kinh doanh giúp các doanh nghiệp lớn đưa ra những quyết định chiến lược sẵn sàng cho tương lai.",
    "LoBot LLC on GitHub": "LoBot LLC trên GitHub",
    "LoBot LLC on LinkedIn": "LoBot LLC trên LinkedIn",
    "Visit LoBot LLC company website": "Truy cập trang web công ty LoBot LLC",
    Footer: "Chân trang",
    Navigate: "Điều hướng",
    Resources: "Tài nguyên",
    "Download chart (PNG)": "Tải biểu đồ (PNG)",
    "Download data (CSV)": "Tải dữ liệu (CSV)",
    "Regional evaluation": "Đánh giá khu vực",
    "Live water price": "Giá nước trực tiếp",
    "LoBot, LLC - All rights reserved": "LoBot, LLC - Bảo lưu mọi quyền",
    "Last updated:": "Cập nhật lần cuối:",
    "· Model uses publicly available drivers.":
      "· Mô hình sử dụng các yếu tố đầu vào được công bố công khai.",
  },
};
