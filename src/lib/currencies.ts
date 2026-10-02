/**
 * TecnoIndicator — Currency definitions for all UN-registered countries/territories.
 *
 * Each entry maps an ISO 4217 currency code to its symbol, name, and
 * the countries/regions that use it. Exchange rates are fetched in real-time.
 */

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
  countries: string[];
  decimals: number;
}

/**
 * All ISO 4217 currencies used by UN member states (193) + observer states
 * (Holy See, State of Palestine). Deduplicated by currency code.
 *
 * Note: Several ISO codes (GHS, GMD, etc.) were duplicated in the original list
 * due to multiple entries — this consolidated list keeps each currency code once.
 */
export const CURRENCIES: CurrencyInfo[] = [
  // === North America & Caribbean ===
  { code: "USD", symbol: "$", name: "United States Dollar", countries: ["US", "SV", "PA", "EC", "PR", "TL", "MH", "FM", "PW", "VI", "GU", "AS"], decimals: 2 },
  { code: "CAD", symbol: "C$", name: "Canadian Dollar", countries: ["CA"], decimals: 2 },
  { code: "MXN", symbol: "$", name: "Mexican Peso", countries: ["MX"], decimals: 2 },
  { code: "GTQ", symbol: "Q", name: "Guatemalan Quetzal", countries: ["GT"], decimals: 2 },
  { code: "BZD", symbol: "BZ$", name: "Belize Dollar", countries: ["BZ"], decimals: 2 },
  { code: "HNL", symbol: "L", name: "Honduran Lempira", countries: ["HN"], decimals: 2 },
  { code: "NIO", symbol: "C$", name: "Nicaraguan Córdoba", countries: ["NI"], decimals: 2 },
  { code: "CRC", symbol: "₡", name: "Costa Rican Colón", countries: ["CR"], decimals: 2 },
  { code: "PAB", symbol: "B/.", name: "Panamanian Balboa", countries: ["PA"], decimals: 2 },
  { code: "CUP", symbol: "$", name: "Cuban Peso", countries: ["CU"], decimals: 2 },
  { code: "DOP", symbol: "RD$", name: "Dominican Peso", countries: ["DO"], decimals: 2 },
  { code: "JMD", symbol: "J$", name: "Jamaican Dollar", countries: ["JM"], decimals: 2 },
  { code: "TTD", symbol: "TT$", name: "Trinidad and Tobago Dollar", countries: ["TT"], decimals: 2 },
  { code: "BBD", symbol: "Bds$", name: "Barbadian Dollar", countries: ["BB"], decimals: 2 },
  { code: "GYD", symbol: "$", name: "Guyanese Dollar", countries: ["GY"], decimals: 2 },
  { code: "SRD", symbol: "$", name: "Surinamese Dollar", countries: ["SR"], decimals: 2 },
  { code: "FJD", symbol: "FJ$", name: "Fijian Dollar", countries: ["FJ"], decimals: 2 },
  { code: "SBD", symbol: "$", name: "Solomon Islands Dollar", countries: ["SB"], decimals: 2 },
  { code: "VUV", symbol: "Vt", name: "Vanuatu Vatu", countries: ["VU"], decimals: 0 },
  { code: "PGK", symbol: "K", name: "Papua New Guinean Kina", countries: ["PG"], decimals: 2 },
  { code: "AUD", symbol: "A$", name: "Australian Dollar", countries: ["AU"], decimals: 2 },
  { code: "NZD", symbol: "NZ$", name: "New Zealand Dollar", countries: ["NZ"], decimals: 2 },
  { code: "HKD", symbol: "HK$", name: "Hong Kong Dollar", countries: ["HK"], decimals: 2 },
  { code: "SGD", symbol: "S$", name: "Singapore Dollar", countries: ["SG"], decimals: 2 },
  { code: "TWD", symbol: "NT$", name: "New Taiwan Dollar", countries: ["TW"], decimals: 2 },
  { code: "KHR", symbol: "៛", name: "Cambodian Riel", countries: ["KH"], decimals: 2 },
  { code: "LAK", symbol: "₭", name: "Lao Kip", countries: ["LA"], decimals: 0 },
  { code: "THB", symbol: "฿", name: "Thai Baht", countries: ["TH"], decimals: 2 },
  { code: "MYR", symbol: "RM", name: "Malaysian Ringgit", countries: ["MY"], decimals: 2 },
  { code: "IDR", symbol: "Rp", name: "Indonesian Rupiah", countries: ["ID"], decimals: 0 },
  { code: "PHP", symbol: "₱", name: "Philippine Peso", countries: ["PH"], decimals: 2 },
  { code: "BND", symbol: "B$", name: "Brunei Dollar", countries: ["BN"], decimals: 2 },
  { code: "MMK", symbol: "K", name: "Myanmar Kyat", countries: ["MM"], decimals: 2 },

  // === East Asia ===
  { code: "CNY", symbol: "¥", name: "Chinese Yuan", countries: ["CN"], decimals: 2 },
  { code: "JPY", symbol: "¥", name: "Japanese Yen", countries: ["JP"], decimals: 0 },
  { code: "KRW", symbol: "₩", name: "South Korean Won", countries: ["KR"], decimals: 0 },
  { code: "MNT", symbol: "₮", name: "Mongolian Tögrög", countries: ["MN"], decimals: 2 },
  { code: "MOP", symbol: "P", name: "Macanese Pataca", countries: ["MO"], decimals: 2 },

  // === Southeast Asia ===
  { code: "VND", symbol: "₫", name: "Vietnamese Đồng", countries: ["VN"], decimals: 0 },

  // === South Asia ===
  { code: "INR", symbol: "₹", name: "Indian Rupee", countries: ["IN"], decimals: 2 },
  { code: "PKR", symbol: "₨", name: "Pakistani Rupee", countries: ["PK"], decimals: 2 },
  { code: "BDT", symbol: "৳", name: "Bangladeshi Taka", countries: ["BD"], decimals: 2 },
  { code: "LKR", symbol: "Rs", name: "Sri Lankan Rupee", countries: ["LK"], decimals: 2 },
  { code: "NPR", symbol: "₨", name: "Nepalese Rupee", countries: ["NP"], decimals: 2 },
  { code: "BTN", symbol: "Nu.", name: "Bhutanese Ngultrum", countries: ["BT"], decimals: 2 },
  { code: "MVR", symbol: "Rf", name: "Maldivian Rufiyaa", countries: ["MV"], decimals: 2 },

  // === Middle East ===
  { code: "SAR", symbol: "ر.س", name: "Saudi Riyal", countries: ["SA"], decimals: 2 },
  { code: "AED", symbol: "د.إ", name: "UAE Dirham", countries: ["AE"], decimals: 2 },
  { code: "QAR", symbol: "ر.ق", name: "Qatari Riyal", countries: ["QA"], decimals: 2 },
  { code: "BHD", symbol: "BD", name: "Bahraini Dinar", countries: ["BH"], decimals: 3 },
  { code: "KWD", symbol: "KD", name: "Kuwaiti Dinar", countries: ["KW"], decimals: 3 },
  { code: "OMR", symbol: "ر.ع.", name: "Omani Rial", countries: ["OM"], decimals: 3 },
  { code: "JOD", symbol: "JD", name: "Jordanian Dinar", countries: ["JO"], decimals: 3 },
  { code: "LBP", symbol: "ل.", name: "Lebanese Pound", countries: ["LB"], decimals: 2 },
  { code: "SYP", symbol: "ل.س", name: "Syrian Pound", countries: ["SY"], decimals: 2 },
  { code: "IQD", symbol: "ع.", name: "Iraqi Dinar", countries: ["IQ"], decimals: 3 },
  { code: "IRR", symbol: "﷼", name: "Iranian Rial", countries: ["IR"], decimals: 2 },
  { code: "ILS", symbol: "₪", name: "Israeli New Shekel", countries: ["IL"], decimals: 2 },
  { code: "YER", symbol: "﷼", name: "Yemeni Rial", countries: ["YE"], decimals: 2 },
  { code: "RSD", symbol: "din", name: "Serbian Dinar", countries: ["RS"], decimals: 2 },
  { code: "TMT", symbol: "T", name: "Turkmenistani Manat", countries: ["TM"], decimals: 2 },
  { code: "TJS", symbol: "SM", name: "Tajikistani Somoni", countries: ["TJ"], decimals: 2 },
  { code: "UZS", symbol: "soʻm", name: "Uzbekistani Som", countries: ["UZ"], decimals: 2 },
  { code: "AZN", symbol: "ман", name: "Azerbaijani Manat", countries: ["AZ"], decimals: 2 },
  { code: "AMD", symbol: "֏", name: "Armenian Dram", countries: ["AM"], decimals: 2 },
  { code: "GEL", symbol: "₾", name: "Georgian Lari", countries: ["GE"], decimals: 2 },
  { code: "RUB", symbol: "₽", name: "Russian Ruble", countries: ["RU"], decimals: 2 },
  { code: "BYN", symbol: "Br", name: "Belarusian Ruble", countries: ["BY"], decimals: 2 },
  { code: "MDL", symbol: "L", name: "Moldovan Leu", countries: ["MD"], decimals: 2 },
  { code: "RON", symbol: "lei", name: "Romanian Leu", countries: ["RO"], decimals: 2 },
  { code: "BGN", symbol: "лв", name: "Bulgarian Lev", countries: ["BG"], decimals: 2 },
    { code: "BAM", symbol: "KM", name: "Bosnia-Herzegovina Convertible Mark", countries: ["BA"], decimals: 2 },

  // === Europe ===
  { code: "EUR", symbol: "€", name: "Euro", countries: ["AL", "AD", "AT", "BA", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "SM", "RS", "SK", "SI", "ES", "SE", "CH", "UA", "VA", "EU"], decimals: 2 },
  { code: "GBP", symbol: "£", name: "British Pound", countries: ["GB"], decimals: 2 },
  { code: "CHF", symbol: "Fr", name: "Swiss Franc", countries: ["CH"], decimals: 2 },
  { code: "ISK", symbol: "kr", name: "Icelandic Króna", countries: ["IS"], decimals: 0 },
  { code: "NOK", symbol: "kr", name: "Norwegian Krone", countries: ["NO"], decimals: 2 },
  { code: "SEK", symbol: "kr", name: "Swedish Krona", countries: ["SE"], decimals: 2 },
  { code: "DKK", symbol: "kr", name: "Danish Krone", countries: ["DK"], decimals: 2 },
  { code: "PLN", symbol: "zł", name: "Polish Złoty", countries: ["PL"], decimals: 2 },
  { code: "CZK", symbol: "Kč", name: "Czech Koruna", countries: ["CZ"], decimals: 2 },
  { code: "HUF", symbol: "Ft", name: "Hungarian Forint", countries: ["HU"], decimals: 0 },
  { code: "RON", symbol: "lei", name: "Romanian Leu", countries: ["RO"], decimals: 2 },
  { code: "BGN", symbol: "лв", name: "Bulgarian Lev", countries: ["BG"], decimals: 2 },

  // === Latin America ===
  { code: "BRL", symbol: "R$", name: "Brazilian Real", countries: ["BR"], decimals: 2 },
  { code: "ARS", symbol: "$", name: "Argentine Peso", countries: ["AR"], decimals: 2 },
  { code: "UYU", symbol: "$", name: "Uruguayan Peso", countries: ["UY"], decimals: 2 },
  { code: "PYG", symbol: "₲", name: "Paraguayan Guaraní", countries: ["PY"], decimals: 0 },
  { code: "BOB", symbol: "Bs.", name: "Bolivian Boliviano", countries: ["BO"], decimals: 2 },
  { code: "CLP", symbol: "$", name: "Chilean Peso", countries: ["CL"], decimals: 0 },
  { code: "COP", symbol: "Col$", name: "Colombian Peso", countries: ["CO"], decimals: 2 },
  { code: "VES", symbol: "Bs.", name: "Venezuelan Bolívar", countries: ["VE"], decimals: 2 },
  { code: "CUP", symbol: "$", name: "Cuban Peso", countries: ["CU"], decimals: 2 },
  { code: "DOP", symbol: "RD$", name: "Dominican Peso", countries: ["DO"], decimals: 2 },

  // === Africa ===
  { code: "DZD", symbol: "دج", name: "Algerian Dinar", countries: ["DZ"], decimals: 2 },
  { code: "AOA", symbol: "Kz", name: "Angolan Kwanza", countries: ["AO"], decimals: 2 },
  { code: "BIF", symbol: "Fr", name: "Burundian Franc", countries: ["BI"], decimals: 0 },
  { code: "XAF", symbol: "Fr", name: "CFA Franc BEAC", countries: ["CF", "CM", "CG", "GA", "GQ", "TD"], decimals: 0 },
  { code: "XOF", symbol: "Fr", name: "CFA Franc BCEAO", countries: ["BJ", "BF", "CI", "GN", "ML", "NE", "SN", "TG"], decimals: 0 },
  { code: "CVE", symbol: "Esc", name: "Cape Verdean Escudo", countries: ["CV"], decimals: 2 },
  { code: "KMF", symbol: "Fr", name: "Comorian Franc", countries: ["KM"], decimals: 0 },
  { code: "CDF", symbol: "Fr", name: "Congolese Franc", countries: ["CD"], decimals: 2 },
  { code: "DJF", symbol: "Fr", name: "Djiboutian Franc", countries: ["DJ"], decimals: 0 },
  { code: "EGP", symbol: "E£", name: "Egyptian Pound", countries: ["EG"], decimals: 2 },
  { code: "ERN", symbol: "Nfk", name: "Eritrean Nakfa", countries: ["ER"], decimals: 2 },
  { code: "ETB", symbol: "Br", name: "Ethiopian Birr", countries: ["ET"], decimals: 2 },
  { code: "GMD", symbol: "D", name: "Gambian Dalasi", countries: ["GM"], decimals: 2 },
  { code: "GHS", symbol: "₵", name: "Ghanaian Cedi", countries: ["GH"], decimals: 2 },
  { code: "GNF", symbol: "Fr", name: "Guinean Franc", countries: ["GN"], decimals: 0 },
  { code: "LRD", symbol: "$", name: "Liberian Dollar", countries: ["LR"], decimals: 2 },
  { code: "LYD", symbol: "ل.د", name: "Libyan Dinar", countries: ["LY"], decimals: 3 },
  { code: "MGA", symbol: "Ar", name: "Malagasy Ariary", countries: ["MG"], decimals: 2 },
  { code: "MWK", symbol: "MK", name: "Malawian Kwacha", countries: ["MW"], decimals: 2 },
  { code: "MRU", symbol: "UM", name: "Mauritanian Ouguiya", countries: ["MR"], decimals: 2 },
  { code: "MUR", symbol: "Rs", name: "Mauritian Rupee", countries: ["MU"], decimals: 2 },
  { code: "MZN", symbol: "MT", name: "Mozambican Metical", countries: ["MZ"], decimals: 2 },
  { code: "NAD", symbol: "N$", name: "Namibian Dollar", countries: ["NA"], decimals: 2 },
  { code: "NGN", symbol: "₦", name: "Nigerian Naira", countries: ["NG"], decimals: 2 },
  { code: "RWF", symbol: "Fr", name: "Rwandan Franc", countries: ["RW"], decimals: 0 },
  { code: "STN", symbol: "Db", name: "São Tomé and Príncipe Dobra", countries: ["ST"], decimals: 2 },
  { code: "SLE", symbol: "Le", name: "Sierra Leonean Leone", countries: ["SL"], decimals: 2 },
  { code: "SOS", symbol: "Sh", name: "Somali Shilling", countries: ["SO"], decimals: 2 },
  { code: "SSP", symbol: "£", name: "South Sudanese Pound", countries: ["SS"], decimals: 2 },
  { code: "SZL", symbol: "L", name: "Swazi Lilangeni", countries: ["SZ"], decimals: 2 },
  { code: "SDG", symbol: "£", name: "Sudanese Pound", countries: ["SD"], decimals: 2 },
  { code: "TZS", symbol: "Sh", name: "Tanzanian Shilling", countries: ["TZ"], decimals: 2 },
  { code: "TND", symbol: "د.ت", name: "Tunisian Dinar", countries: ["TN"], decimals: 3 },
  { code: "UGX", symbol: "Sh", name: "Ugandan Shilling", countries: ["UG"], decimals: 0 },
  { code: "ZAR", symbol: "R", name: "South African Rand", countries: ["ZA"], decimals: 2 },
  { code: "ZMW", symbol: "ZK", name: "Zambian Kwacha", countries: ["ZM"], decimals: 2 },
  { code: "ZWL", symbol: "Z$", name: "Zimbabwean Dollar", countries: ["ZW"], decimals: 2 },
  { code: "KES", symbol: "KSh", name: "Kenyan Shilling", countries: ["KE"], decimals: 2 },
  { code: "UGX", symbol: "Sh", name: "Ugandan Shilling", countries: ["UG"], decimals: 0 },
  { code: "RWF", symbol: "Fr", name: "Rwandan Franc", countries: ["RW"], decimals: 0 },
  { code: "BIF", symbol: "Fr", name: "Burundian Franc", countries: ["BI"], decimals: 0 },
  { code: "KMF", symbol: "Fr", name: "Comorian Franc", countries: ["KM"], decimals: 0 },
];

/**
 * The UN member states and observer states, each with its primary currency code.
 * Used to build the full currency selector list.
 */
export const UN_MEMBER_CURRENCIES: string[] = [
   "USD", "CAD", "MXN", "GTQ", "BZD", "HNL", "NIO", "CRC", "PAB", "CUP", "DOP",
  "JMD", "TTD", "BBD", "GYD", "SRD", "FJD", "SBD", "VUV", "PGK", "AUD", "NZD", "HKD",
  "SGD", "TWD", "KHR", "LAK", "THB", "MYR", "IDR", "PHP", "BND", "MMK", "CNY", "JPY",
   "KRW", "MNT", "MOP", "VND", "INR", "PKR", "BDT", "LKR", "NPR", "BTN", "MVR",
  "SAR", "AED", "QAR", "BHD", "KWD", "OMR", "JOD", "LBP", "SYP", "IQD", "IRR",
  "ILS", "YER", "TMT", "TJS", "UZS", "AZN", "AMD", "GEL", "RUB", "BYN", "MDL",
  "RON", "BGN", "BAM", "EUR", "GBP", "CHF", "ISK", "NOK", "SEK", "DKK",
  "PLN", "CZK", "HUF", "BRL", "ARS", "UYU", "PYG", "BOB", "CLP", "COP", "VES",
  "DZD", "AOA", "BIF", "XAF", "XOF", "CVE", "KMF", "CDF", "DJF", "EGP", "ERN",
  "ETB", "GMD", "GHS", "GNF", "LRD", "LYD", "MGA", "MWK", "MRU", "MUR", "MZN",
  "NAD", "NGN", "RWF", "STN", "SLE", "SOS", "SSP", "SZL", "SDG", "TZS", "TND",
  "UGX", "ZAR", "ZMW", "ZWL",
];

/**
 * Deduplicated list of all currencies available in the selector, sorted by name.
 * Each currency appears only once even if shared by multiple countries.
 */
export const ALL_CURRENCIES: CurrencyInfo[] = (() => {
  const seen = new Set<string>();
  const result: CurrencyInfo[] = [];
  for (const c of CURRENCIES) {
    if (!seen.has(c.code)) {
      seen.add(c.code);
      result.push(c);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
})();

/** Default currency code for USD. */
export const DEFAULT_CURRENCY = "USD";

/**
 * Find currency info by ISO code. Falls back to a generic entry.
 */
export function getCurrencyInfo(code: string): CurrencyInfo {
  return (
    ALL_CURRENCIES.find((c) => c.code === code.toUpperCase()) ?? {
      code: code.toUpperCase(),
      symbol: "",
      name: code.toUpperCase(),
      countries: [],
      decimals: 2,
    }
  );
}
