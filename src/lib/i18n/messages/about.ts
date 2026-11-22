import type { LocaleMessages } from "../types";

/** About / methodology strings. */
export const messages: LocaleMessages = {
  en: {},
  es: {
    Transparency: "Transparencia",
    "About the model": "Acerca del modelo",
    "LoBot LLC is a demonstration of modern front-end data visualization: every number is computed in your browser from publicly known drivers, with no backend and no API keys. The goal is an honest, explorable illustration of how forecasters think about uncertainty — not a crystal ball.":
      "LoBot LLC es una demostración de visualización de datos front-end moderna: cada cifra se calcula en tu navegador a partir de impulsores de conocimiento público, sin backend ni claves de API. El objetivo es una ilustración honesta y explorable de cómo los pronosticadores piensan sobre la incertidumbre, no una bola de cristal.",
    "Base trend": "Tendencia base",
    "Volatility bands": "Bandas de volatilidad",
    "Factor adjustments": "Ajustes por factores",
    "Five-region evaluation": "Evaluación de cinco regiones",
    "Each series starts from a realistic market price — Brent around {brent}/bbl, global power near {power}/MWh, and global water near {water}/m³ — then compounds at a structural CAGR of 3.8–5.0% depending on the commodity. Regional modes remap to WTI, Dubai/Oman, WAF and local retail tariffs.":
      "Cada serie parte de un precio de mercado realista —Brent alrededor de {brent}/bbl, la energía global cerca de {power}/MWh y el agua global cerca de {water}/m³— y luego se compone a una CAGR estructural del 3,8–5,0 % según la materia prima. Los modos regionales se reasignan a WTI, Dubái/Omán, WAF y tarifas minoristas locales.",
    "Low and high scenarios widen with the square root of time, reflecting how forecast uncertainty genuinely grows. At a 10-year horizon the bands span roughly ±22–34% around the average path, with Africa and Asia carrying higher regional vol adjustments.":
      "Los escenarios bajo y alto se amplían con la raíz cuadrada del tiempo, reflejando cómo crece realmente la incertidumbre del pronóstico. En un horizonte de 10 años, las bandas abarcan aproximadamente ±22–34 % alrededor de la trayectoria media, con África y Asia soportando ajustes de volatilidad regional más altos.",
    "Twelve researched drivers — from OPEC+ policy to water scarcity — each contribute a small drift that ramps up over the horizon, so the model stays explainable rather than being a black box.":
      "Doce impulsores investigados —desde la política de la OPEP+ hasta la escasez de agua— aportan cada uno una pequeña deriva que aumenta a lo largo del horizonte, de modo que el modelo sigue siendo explicable en lugar de ser una caja negra.",
    "Americas, Europe, Asia, Africa and Oceania are scored live using research-backed oil markers and 2026 retail electricity/water benchmarks (Europe & Oceania power ~{europePower}/kWh, Asia ~{asiaPower}/kWh, Americas mid-range).":
      "América, Europa, Asia, África y Oceanía se puntúan en vivo usando marcadores de petróleo respaldados por investigaciones y referencias de electricidad/agua minorista de 2026 (energía en Europa y Oceanía ~{europePower}/kWh, Asia ~{asiaPower}/kWh, América en el rango medio).",
    "Public data & reasoning sources": "Fuentes públicas de datos y razonamiento",
    "Base prices, growth rates, regional differentials and driver narratives are grounded in publicly available research.":
      "Los precios base, las tasas de crecimiento, los diferenciales regionales y las narrativas de impulsores se basan en investigaciones disponibles públicamente.",
    "Want to run your own scenarios? Press {key} to jump to the horizon slider and watch the cards, chart, regions and factor grid respond in real time.":
      "¿Quieres ejecutar tus propios escenarios? Pulsa {key} para ir al control de horizonte y ver cómo las tarjetas, el gráfico, las regiones y la cuadrícula de factores responden en tiempo real.",
  },
  vi: {
    Transparency: "Minh bạch",
    "About the model": "Giới thiệu về mô hình",
    "LoBot LLC is a demonstration of modern front-end data visualization: every number is computed in your browser from publicly known drivers, with no backend and no API keys. The goal is an honest, explorable illustration of how forecasters think about uncertainty — not a crystal ball.":
      "LoBot LLC là một bản trình diễn trực quan hóa dữ liệu front-end hiện đại: mọi con số đều được tính toán trong trình duyệt của bạn từ các yếu tố dẫn dắt được công khai, không có backend và không cần khóa API. Mục tiêu là một minh họa trung thực và có thể khám phá về cách các nhà dự báo suy nghĩ về sự không chắc chắn — không phải một quả cầu pha lê.",
    "Base trend": "Xu hướng cơ sở",
    "Volatility bands": "Dải biến động",
    "Factor adjustments": "Điều chỉnh theo yếu tố",
    "Five-region evaluation": "Đánh giá năm khu vực",
    "Each series starts from a realistic market price — Brent around {brent}/bbl, global power near {power}/MWh, and global water near {water}/m³ — then compounds at a structural CAGR of 3.8–5.0% depending on the commodity. Regional modes remap to WTI, Dubai/Oman, WAF and local retail tariffs.":
      "Mỗi chuỗi bắt đầu từ một mức giá thị trường thực tế — Brent khoảng {brent}/thùng, điện toàn cầu khoảng {power}/MWh và nước toàn cầu khoảng {water}/m³ — sau đó tăng trưởng kép với CAGR cấu trúc 3,8–5,0% tùy theo mặt hàng. Các chế độ khu vực sẽ ánh xạ lại sang WTI, Dubai/Oman, WAF và biểu giá bán lẻ địa phương.",
    "Low and high scenarios widen with the square root of time, reflecting how forecast uncertainty genuinely grows. At a 10-year horizon the bands span roughly ±22–34% around the average path, with Africa and Asia carrying higher regional vol adjustments.":
      "Các kịch bản thấp và cao mở rộng theo căn bậc hai của thời gian, phản ánh mức độ gia tăng thực sự của sự không chắc chắn trong dự báo. Ở khoảng thời gian 10 năm, các dải dao động khoảng ±22–34% quanh đường trung bình, với châu Phi và châu Á có điều chỉnh biến động khu vực cao hơn.",
    "Twelve researched drivers — from OPEC+ policy to water scarcity — each contribute a small drift that ramps up over the horizon, so the model stays explainable rather than being a black box.":
      "Mười hai yếu tố dẫn dắt đã được nghiên cứu — từ chính sách OPEC+ đến tình trạng thiếu nước — mỗi yếu tố đóng góp một độ lệch nhỏ tăng dần theo thời gian, giúp mô hình vẫn có thể giải thích được thay vì là một hộp đen.",
    "Americas, Europe, Asia, Africa and Oceania are scored live using research-backed oil markers and 2026 retail electricity/water benchmarks (Europe & Oceania power ~{europePower}/kWh, Asia ~{asiaPower}/kWh, Americas mid-range).":
      "Châu Mỹ, châu Âu, châu Á, châu Phi và châu Đại Dương được đánh giá trực tiếp bằng các mốc dầu có cơ sở nghiên cứu và chuẩn giá điện/nước bán lẻ năm 2026 (điện ở châu Âu và châu Đại Dương ~{europePower}/kWh, châu Á ~{asiaPower}/kWh, châu Mỹ ở mức trung bình).",
    "Public data & reasoning sources": "Nguồn dữ liệu và lập luận công khai",
    "Base prices, growth rates, regional differentials and driver narratives are grounded in publicly available research.":
      "Giá cơ sở, tốc độ tăng trưởng, chênh lệch khu vực và các diễn giải về yếu tố dẫn dắt đều dựa trên nghiên cứu được công bố công khai.",
    "Want to run your own scenarios? Press {key} to jump to the horizon slider and watch the cards, chart, regions and factor grid respond in real time.":
      "Muốn tự chạy các kịch bản của mình? Nhấn {key} để chuyển đến thanh trượt khoảng thời gian và xem các thẻ, biểu đồ, khu vực và lưới yếu tố phản hồi theo thời gian thực.",
  },
};
