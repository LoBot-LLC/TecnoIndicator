import type { LocaleMessages } from "../types";

/** Correlation matrix strings. */
export const messages: LocaleMessages = {
  en: {},
  es: {
    "Factor–price correlation": "Correlación factor–precio",
    "Correlation matrix": "Matriz de correlación",
    "Pearson correlation between each top factor's contribution series and the forecasted price path, for {horizon}-year horizon in {region}. Select a factor to see per-region detail.":
      "Correlación de Pearson entre la serie de contribución de cada factor principal y la trayectoria de precio prevista, para un horizonte de {horizon} años en {region}. Selecciona un factor para ver el detalle por región.",
    "Increase the horizon to at least 2 years to compute correlations.":
      "Aumenta el horizonte a al menos 2 años para calcular las correlaciones.",
    "No factors available for correlation right now.":
      "No hay factores disponibles para la correlación en este momento.",
    "Factor price correlation matrix": "Matriz de correlación de precios de factores",
    Factor: "Factor",
    Oil: "Petróleo",
    Electricity: "Electricidad",
    Water: "Agua",
    "n/a": "n/d",
    "{factor} vs {commodity}: {r}": "{factor} vs {commodity}: {r}",
    "{factor} — per-region correlation": "{factor} — correlación por región",
    "vs {commodity}": "vs {commodity}",
    "Open {region} in regions (correlation {r})":
      "Abrir {region} en regiones (correlación {r})",
    Global: "Global",
    Americas: "América",
    Europe: "Europa",
    Asia: "Asia",
    Africa: "África",
    Oceania: "Oceanía",
  },
  vi: {
    "Factor–price correlation": "Tương quan yếu tố–giá",
    "Correlation matrix": "Ma trận tương quan",
    "Pearson correlation between each top factor's contribution series and the forecasted price path, for {horizon}-year horizon in {region}. Select a factor to see per-region detail.":
      "Tương quan Pearson giữa chuỗi đóng góp của từng yếu tố hàng đầu và đường giá dự báo, trong khoảng thời gian {horizon} năm tại {region}. Chọn một yếu tố để xem chi tiết theo khu vực.",
    "Increase the horizon to at least 2 years to compute correlations.":
      "Tăng khoảng thời gian lên ít nhất 2 năm để tính tương quan.",
    "No factors available for correlation right now.":
      "Hiện không có yếu tố nào để tính tương quan.",
    "Factor price correlation matrix": "Ma trận tương quan giá theo yếu tố",
    Factor: "Yếu tố",
    Oil: "Dầu",
    Electricity: "Điện",
    Water: "Nước",
    "n/a": "không áp dụng",
    "{factor} vs {commodity}: {r}": "{factor} so với {commodity}: {r}",
    "{factor} — per-region correlation": "{factor} — tương quan theo khu vực",
    "vs {commodity}": "so với {commodity}",
    "Open {region} in regions (correlation {r})":
      "Mở {region} trong khu vực (tương quan {r})",
    Global: "Toàn cầu",
    Americas: "Châu Mỹ",
    Europe: "Châu Âu",
    Asia: "Châu Á",
    Africa: "Châu Phi",
    Oceania: "Châu Đại Dương",
  },
};
