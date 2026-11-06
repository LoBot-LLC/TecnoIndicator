export interface FontOption {
  key: string;
  name: string;
  family: string;
  googleFamily: string;
}
export const FONTS: FontOption[] = [
  { key: "inter", name: "Inter", family: "'Inter', ui-sans-serif, system-ui, sans-serif", googleFamily: "Inter:wght@400;500;600;700" },
  { key: "space-grotesk", name: "Space Grotesk", family: "'Space Grotesk', 'Inter', ui-sans-serif, sans-serif", googleFamily: "Space+Grotesk:wght@500;600;700" },
  { key: "roboto", name: "Roboto", family: "'Roboto', ui-sans-serif, system-ui, sans-serif", googleFamily: "Roboto:wght@400;500;700" },
  { key: "open-sans", name: "Open Sans", family: "'Open Sans', ui-sans-serif, system-ui, sans-serif", googleFamily: "Open+Sans:wght@400;600;700" },
  { key: "lato", name: "Lato", family: "'Lato', ui-sans-serif, system-ui, sans-serif", googleFamily: "Lato:wght@400;700;900" },
  { key: "montserrat", name: "Montserrat", family: "'Montserrat', ui-sans-serif, system-ui, sans-serif", googleFamily: "Montserrat:wght@500;600;700" },
  { key: "poppins", name: "Poppins", family: "'Poppins', ui-sans-serif, system-ui, sans-serif", googleFamily: "Poppins:wght@400;500;600;700" },
  { key: "raleway", name: "Raleway", family: "'Raleway', ui-sans-serif, system-ui, sans-serif", googleFamily: "Raleway:wght@400;500;700" },
  { key: "oswald", name: "Oswald", family: "'Oswald', ui-sans-serif, system-ui, sans-serif", googleFamily: "Oswald:wght@400;500;600;700" },
  { key: "merriweather", name: "Merriweather", family: "'Merriweather', ui-serif, Georgia, serif", googleFamily: "Merriweather:wght@400;700" },
  { key: "playfair-display", name: "Playfair Display", family: "'Playfair Display', ui-serif, Georgia, serif", googleFamily: "Playfair+Display:wght@500;700" },
  { key: "source-sans-3", name: "Source Sans 3", family: "'Source Sans 3', ui-sans-serif, system-ui, sans-serif", googleFamily: "Source+Sans+3:wght@400;600;700" },
  { key: "pt-sans", name: "PT Sans", family: "'PT Sans', ui-sans-serif, system-ui, sans-serif", googleFamily: "PT+Sans:wght@400;700" },
  { key: "noto-sans", name: "Noto Sans", family: "'Noto Sans', ui-sans-serif, system-ui, sans-serif", googleFamily: "Noto+Sans:wght@400;600;700" },
];
export const DEFAULT_FONT_KEY = "inter";
export function getFont(key: string): FontOption {
  return FONTS.find((f) => f.key === key) ?? FONTS[0];
}
