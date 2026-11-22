import type { LocaleMessages } from "../types";

/**
 * Settings panel strings.
 *
 * Keys are the exact English source strings rendered by
 * `src/components/SettingsMenu.tsx`. `en` stays empty because a missing entry
 * falls back to the key itself.
 */
export const messages: LocaleMessages = {
  en: {},
  es: {
    Settings: "Ajustes",
    "Close settings": "Cerrar ajustes",
    "Fonts & themes": "Fuentes y temas",
    "Color theme": "Tema de color",
    Light: "Claro",
    Dark: "Oscuro",
    System: "Sistema",
    Font: "Fuente",
    "Preview: The quick brown fox — 012345": "Vista previa: El veloz murciélago — 012345",
    "Unit conversion": "Conversión de unidades",
    Currency: "Moneda",
    "Search currency…": "Buscar moneda…",
    "Search currencies": "Buscar monedas",
    "Length / volume": "Longitud / volumen",
    Energy: "Energía",
    "Unit conversions update in real time. Currency selection reloads to apply across all data.":
      "Las conversiones de unidades se actualizan en tiempo real. Al elegir una moneda, la página se recarga para aplicar el cambio a todos los datos.",
    Language: "Idioma",
    "Interface language": "Idioma de la interfaz",
    "Choose the language used across the interface. AI-curated content is translated automatically.":
      "Elige el idioma de toda la interfaz. El contenido curado por IA se traduce automáticamente.",
  },
  vi: {
    Settings: "Cài đặt",
    "Close settings": "Đóng cài đặt",
    "Fonts & themes": "Phông chữ và giao diện",
    "Color theme": "Chủ đề màu",
    Light: "Sáng",
    Dark: "Tối",
    System: "Hệ thống",
    Font: "Phông chữ",
    "Preview: The quick brown fox — 012345": "Xem trước: Con cáo nâu nhanh nhẹn — 012345",
    "Unit conversion": "Chuyển đổi đơn vị",
    Currency: "Tiền tệ",
    "Search currency…": "Tìm kiếm tiền tệ…",
    "Search currencies": "Tìm kiếm các loại tiền tệ",
    "Length / volume": "Chiều dài / thể tích",
    Energy: "Năng lượng",
    "Unit conversions update in real time. Currency selection reloads to apply across all data.":
      "Chuyển đổi đơn vị được cập nhật theo thời gian thực. Khi chọn tiền tệ, trang sẽ tải lại để áp dụng cho toàn bộ dữ liệu.",
    Language: "Ngôn ngữ",
    "Interface language": "Ngôn ngữ giao diện",
    "Choose the language used across the interface. AI-curated content is translated automatically.":
      "Chọn ngôn ngữ dùng cho toàn bộ giao diện. Nội dung do AI tuyển chọn sẽ được dịch tự động.",
  },
};
