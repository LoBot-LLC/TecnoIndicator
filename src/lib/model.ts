/**
 * TecnoIndicator — client-side forecasting engine.
 *
 * Model:  avg(t) = base × (1 + CAGR)^t × cycle(t) × factorAdjust(t)
 *         min/max(t) = avg(t) × (1 ± σ·√(t/10))
 *
 * Everything runs in the browser — no backend required.
 */

export type CommodityId = "oil" | "electricity" | "water";

export type RegionId =
  | "global"
  | "americas"
  | "europe"
  | "asia"
  | "africa"
  | "oceania";

export interface Solution {
  id: string;
  title: string;
  summary: string;
  actions: string[];
  commodities: CommodityId[];
  regions?: RegionId[];
  scope: RegionId;
  relatedFactors: string[];
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface Commodity {
  id: CommodityId;
  name: string;
  short: string;
  unit: string;
  base: number;
  cagr: number;
  maxVol: number;
  cycleAmp: number;
  cyclePhase: number;
  color: string;
  floor: number;
  ceil: number;
  decimals: number;
}

export const START_YEAR = new Date().getFullYear();

export const COMMODITIES: Commodity[] = [
  {
    id: "oil",
    name: "Brent Crude Oil",
    short: "Oil",
    unit: "USD/bbl",
    base: 104.86,
    cagr: 0.038,
    maxVol: 0.34,
    cycleAmp: 0.035,
    cyclePhase: 0.6,
    color: "#f5b840",
    floor: 55,
    ceil: 190,
    decimals: 1,
  },
  {
    id: "electricity",
    name: "Global Electricity",
    short: "Electricity",
    unit: "USD/MWh",
    base: 166,
    cagr: 0.046,
    maxVol: 0.26,
    cycleAmp: 0.028,
    cyclePhase: 1.9,
    color: "#2dd4bf",
    floor: 90,
    ceil: 330,
    decimals: 0,
  },
  {
    id: "water",
    name: "Global Water",
    short: "Water",
    unit: "USD/m³",
    base: 2.5,
    cagr: 0.05,
    maxVol: 0.22,
    cycleAmp: 0.02,
    cyclePhase: 3.1,
    color: "#38bdf8",
    floor: 1.1,
    ceil: 7.5,
    decimals: 2,
  },
];

/* ------------------------------------------------------------------ */
/* Regional market profiles (research-backed benchmarks)              */
/* ------------------------------------------------------------------ */
/*
 * Oil (USD/bbl): regional crude markers relative to ICE Brent.
 *   Americas  → WTI Cushing / LLS (typically $3–6 under Brent)
 *   Europe    → Dated Brent / North Sea
 *   Asia      → Dubai / Oman (Asia-Pacific sour marker)
 *   Africa    → West African light sweet (Bonny/Forcados, Brent-linked)
 *   Oceania   → Import-parity crude (Brent + freight/quality)
 *
 * Electricity (USD/MWh): residential/commercial blended retail ≈ $/kWh × 1000
 *   Sources: GlobalPetrolPrices Q1 2026 regional averages
 *   Americas ~$0.15–0.21/kWh · Europe ~$0.26 · Asia ~$0.09
 *   Africa ~$0.14 · Oceania ~$0.26
 *
 * Water (USD/m³): municipal/industrial tariff blend
 *   Europe & Oceania highest cost-recovery tariffs; Asia & Africa lower
 *   administered tariffs; Americas mid-range (US low, LatAm rising).
 */

export interface RegionProfile {
  id: RegionId;
  name: string;
  short: string;
  flag: string;
  accent: string;
  blurb: string;
  /** Spot anchors for oil / electricity / water */
  bases: Record<CommodityId, number>;
  /** Structural CAGR modifiers vs global */
  cagrAdj: Record<CommodityId, number>;
  /** Volatility modifiers vs global */
  volAdj: Record<CommodityId, number>;
  /** Oil marker name shown in UI */
  oilMarker: string;
  drivers: string[];
}

export const REGIONS: RegionProfile[] = [
  {
    id: "global",
    name: "Global Average",
    short: "Global",
    flag: "🌐",
    accent: "#94a3b8",
    blurb: "Volume-weighted world composite across major hubs.",
    bases: { oil: 104.86, electricity: 166, water: 2.5 },
    cagrAdj: { oil: 0, electricity: 0, water: 0 },
    volAdj: { oil: 0, electricity: 0, water: 0 },
    oilMarker: "ICE Brent",
    drivers: ["OPEC+ policy", "Global demand", "Freight & inventories"],
  },
  {
    id: "americas",
    name: "Americas",
    short: "Americas",
    flag: "🌎",
    accent: "#60a5fa",
    blurb:
      "WTI-linked crude, abundant shale & hydro/gas power, mid-range water tariffs.",
    bases: { oil: 99.4, electricity: 158, water: 2.15 },
    cagrAdj: { oil: -0.004, electricity: 0.006, water: 0.008 },
    volAdj: { oil: 0.04, electricity: -0.02, water: 0.01 },
    oilMarker: "WTI Cushing",
    drivers: [
      "US shale productivity",
      "Henry Hub gas → power",
      "LatAm hydrology & drought",
      "Pipeline & export capacity",
    ],
  },
  {
    id: "europe",
    name: "Europe",
    short: "Europe",
    flag: "🇪🇺",
    accent: "#a78bfa",
    blurb:
      "Brent benchmark, highest retail power (carbon + network), top-tier water cost recovery.",
    bases: { oil: 104.86, electricity: 258, water: 3.85 },
    cagrAdj: { oil: 0.002, electricity: 0.012, water: 0.01 },
    volAdj: { oil: -0.02, electricity: 0.05, water: -0.02 },
    oilMarker: "Dated Brent",
    drivers: [
      "EU ETS carbon price",
      "Russian supply displacement",
      "Renewables curtailment risk",
      "Drought & Alpine hydro",
    ],
  },
  {
    id: "asia",
    name: "Asia",
    short: "Asia",
    flag: "🌏",
    accent: "#f472b6",
    blurb:
      "Dubai/Oman crude marker, lowest retail power (subsidies + coal/hydro), rising urban water tariffs.",
    bases: { oil: 102.8, electricity: 98, water: 1.65 },
    cagrAdj: { oil: 0.008, electricity: 0.018, water: 0.022 },
    volAdj: { oil: 0.03, electricity: 0.02, water: 0.04 },
    oilMarker: "Dubai / Oman",
    drivers: [
      "China & India demand",
      "Coal-to-gas switching",
      "Strait of Hormuz risk",
      "Urbanization & desalination",
    ],
  },
  {
    id: "africa",
    name: "Africa",
    short: "Africa",
    flag: "🌍",
    accent: "#fbbf24",
    blurb:
      "West African crude exports, mixed power tariffs with diesel backup premiums, scarce municipal water.",
    bases: { oil: 101.2, electricity: 142, water: 1.35 },
    cagrAdj: { oil: 0.005, electricity: 0.02, water: 0.028 },
    volAdj: { oil: 0.06, electricity: 0.08, water: 0.07 },
    oilMarker: "WAF Light Sweet",
    drivers: [
      "Nigeria / Angola output",
      "Grid reliability & diesel gensets",
      "Drought & Sahel scarcity",
      "Subsidy reform pressure",
    ],
  },
  {
    id: "oceania",
    name: "Oceania",
    short: "Oceania",
    flag: "🇦🇺",
    accent: "#34d399",
    blurb:
      "Import-parity oil, high retail power (AU/NZ), expensive urban water with drought pricing.",
    bases: { oil: 107.6, electricity: 252, water: 3.55 },
    cagrAdj: { oil: 0.003, electricity: 0.01, water: 0.014 },
    volAdj: { oil: 0.02, electricity: 0.04, water: 0.05 },
    oilMarker: "Import parity",
    drivers: [
      "LNG export linkage",
      "NEM / NZ wholesale spikes",
      "Millennium Drought legacy",
      "Remote island fuel premiums",
    ],
  },
];

export const EVAL_REGIONS = REGIONS.filter((r) => r.id !== "global");

export function regionById(id: RegionId): RegionProfile {
  return REGIONS.find((r) => r.id === id) ?? REGIONS[0];
}

/* ------------------------------------------------------------------ */
/* Key factors / drivers                                              */
/* ------------------------------------------------------------------ */

export type Direction = "up" | "down" | "mixed";
export type Magnitude = "High" | "Medium" | "Low";
export type HorizonBias = "short" | "mid" | "long" | "flat";

export interface Factor {
  id: string;
  name: string;
  category: string;
  commodities: CommodityId[];
  explanation: string;
  direction: Direction;
  magnitude: Magnitude;
  source: string;
  bias: HorizonBias;
  /** Cumulative adjustment contributed at the 10-year horizon, per commodity. */
  drift: Partial<Record<CommodityId, number>>;
  /** Regions where this factor is especially material */
  regions?: RegionId[];
  /** Scope the factor belongs to (global or named region) */
  scope: RegionId;
  /** Importance score 0-100 based on evidence quality and expected price impact */
  importanceScore: number;
  createdAt: string;
  updatedAt: string;
}

export const FACTORS: Factor[] = [
  {
    id: "opec",
    name: "OPEC+ Production Decisions",
    category: "Policy",
    commodities: ["oil"],
    explanation:
      "OPEC+ members control roughly 40% of global crude output. Quota cuts tighten supply and lift Brent prices, while output hikes or compliance cracks push prices lower.",
    direction: "up",
    magnitude: "High",
    source: "OPEC Monthly Oil Market Report; IEA",
    bias: "short",
    drift: { oil: 0.012 },
    regions: ["global", "asia", "europe", "africa"],
    scope: "global",
    importanceScore: 85,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "geopolitics",
    name: "Geopolitical Tensions & Supply Disruptions",
    category: "Geopolitics",
    commodities: ["oil"],
    explanation:
      "Conflicts in the Middle East, sanctions on major exporters, and chokepoint risks such as the Strait of Hormuz periodically remove barrels from the market, adding a persistent risk premium to oil.",
    direction: "up",
    magnitude: "High",
    source: "EIA Short-Term Energy Outlook",
    bias: "flat",
    drift: { oil: 0.018 },
    regions: ["global", "asia", "europe", "africa"],
    scope: "global",
    importanceScore: 88,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "asia-demand",
    name: "Demand Growth in China & India",
    category: "Demand",
    commodities: ["oil", "electricity"],
    explanation:
      "Asia's two giant economies account for most of the growth in global energy demand. Rising mobility, industrial output, and electrification support both oil and power prices.",
    direction: "up",
    magnitude: "High",
    source: "IEA World Energy Outlook",
    bias: "long",
    drift: { oil: 0.02, electricity: 0.014 },
    regions: ["asia", "global", "oceania"],
    scope: "global",
    importanceScore: 82,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "renewables",
    name: "Renewable Energy Buildout",
    category: "Transition",
    commodities: ["electricity", "oil"],
    explanation:
      "Solar, wind, and battery storage keep falling in cost and capture an ever-larger share of generation, suppressing wholesale power prices and eroding oil's long-run demand growth.",
    direction: "down",
    magnitude: "High",
    source: "IRENA; BloombergNEF",
    bias: "long",
    drift: { electricity: -0.025, oil: -0.01 },
    regions: ["europe", "americas", "oceania", "asia"],
    scope: "global",
    importanceScore: 90,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "weather",
    name: "Weather & Temperature Extremes",
    category: "Climate",
    commodities: ["electricity", "water"],
    explanation:
      "Heat waves and cold snaps spike cooling and heating load, while droughts drain reservoirs and cut hydropower at the same time. Extreme weather adds short-term volatility to power and water prices.",
    direction: "up",
    magnitude: "Medium",
    source: "Copernicus Climate Service; NOAA",
    bias: "short",
    drift: { electricity: 0.008, water: 0.006 },
    regions: ["americas", "europe", "africa", "oceania"],
    scope: "global",
    importanceScore: 72,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "scarcity",
    name: "Water Scarcity & Drought",
    category: "Resource",
    commodities: ["water"],
    explanation:
      "Over 2 billion people live in water-stressed countries. Over-extracted aquifers and shrinking glaciers reduce reliable supply, driving municipal and industrial water tariffs steadily upward.",
    direction: "up",
    magnitude: "High",
    source: "UN-Water; WRI Aqueduct",
    bias: "long",
    drift: { water: 0.03 },
    regions: ["africa", "asia", "oceania", "americas"],
    scope: "global",
    importanceScore: 78,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "desalination",
    name: "Desalination & Reuse Technology",
    category: "Technology",
    commodities: ["water"],
    explanation:
      "Reverse-osmosis desalination and wastewater reuse keep getting cheaper and more energy-efficient, expanding supply in coastal arid regions and capping the upper end of water price growth.",
    direction: "down",
    magnitude: "Medium",
    source: "International Desalination Association",
    bias: "long",
    drift: { water: -0.012 },
    regions: ["asia", "oceania", "africa", "americas"],
    scope: "global",
    importanceScore: 65,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "agriculture",
    name: "Agricultural & Food Demand",
    category: "Demand",
    commodities: ["water"],
    explanation:
      "Farming consumes about 70% of all freshwater withdrawals. Growing populations and richer diets raise irrigation demand, competing directly with municipal and industrial users.",
    direction: "up",
    magnitude: "Medium",
    source: "FAO AQUASTAT",
    bias: "flat",
    drift: { water: 0.01 },
    regions: ["asia", "africa", "americas"],
    scope: "global",
    importanceScore: 70,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "carbon",
    name: "Carbon & Climate Regulation",
    category: "Policy",
    commodities: ["electricity", "water"],
    explanation:
      "Carbon pricing, emissions trading, and pollution standards raise the cost of fossil generation and fund water infrastructure, pushing utility tariffs higher during the transition.",
    direction: "up",
    magnitude: "High",
    source: "World Bank Carbon Pricing Dashboard; IEA",
    bias: "long",
    drift: { electricity: 0.015, water: 0.008 },
    regions: ["europe", "oceania", "americas"],
    scope: "global",
    importanceScore: 76,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "storage",
    name: "Storage Levels & Inventories",
    category: "Market",
    commodities: ["oil", "water"],
    explanation:
      "High crude inventories and full strategic reserves cushion price spikes, while ample reservoir levels keep water tariffs stable. Low storage has the opposite effect across both markets.",
    direction: "down",
    magnitude: "Medium",
    source: "EIA Weekly Petroleum Status; IEA",
    bias: "short",
    drift: { oil: -0.01, water: -0.006 },
    regions: ["americas", "europe", "global"],
    scope: "global",
    importanceScore: 68,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "ev-adoption",
    name: "EV Adoption & Energy Transition",
    category: "Transition",
    commodities: ["oil"],
    explanation:
      "Electric vehicles already displace several million barrels per day of oil demand, and that figure is expected to triple by 2030 — structurally capping oil demand growth over the decade.",
    direction: "down",
    magnitude: "High",
    source: "IEA Global EV Outlook",
    bias: "long",
    drift: { oil: -0.02 },
    regions: ["europe", "americas", "asia", "oceania"],
    scope: "global",
    importanceScore: 84,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "infrastructure",
    name: "Grid & Water Infrastructure Investment",
    category: "Investment",
    commodities: ["electricity", "water"],
    explanation:
      "Aging grids need trillions in transmission and resilience spending, while leaky water networks lose 20–30% of supply — costs that regulators ultimately allow to flow into tariffs.",
    direction: "up",
    magnitude: "Medium",
    source: "IEA; World Bank",
    bias: "long",
    drift: { electricity: 0.012, water: 0.012 },
    regions: ["africa", "americas", "asia", "europe"],
    scope: "global",
    importanceScore: 80,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export type LivePricesResponse = {
  oil: { price: number; unit: string; source: string; isLive: boolean };
  electricity: { price: number; unit: string; source: string; isLive: boolean };
  water: { price: number; unit: string; source: string; isLive: boolean };
  asOf: string;
  dataSource: string;
  isLive: boolean;
};

/** The live water quote surfaced by the water card, derived from /api/prices. */
export interface LiveWaterQuote {
  price: number;
  asOf: string;
  source: string;
  range: string;
}

/* ------------------------------------------------------------------ */
/* Regional fallback factors (8 per region, 40 total)                 */
/* ------------------------------------------------------------------ */

export const REGIONAL_FACTORS: Record<string, Factor[]> = {
  asia: [
    {
      id: "asia-1",
      name: "China & India Energy Demand Growth",
      category: "Demand",
      commodities: ["oil", "electricity"],
      explanation: "Asia's two largest economies drive the majority of global energy demand growth. Rising industrial output, urbanization, and vehicle ownership in China and India support both crude oil and power prices across the region.",
      direction: "up",
      magnitude: "High",
      source: "IEA World Energy Outlook; China NBS; India PPAC",
      bias: "long",
      drift: { oil: 0.02, electricity: 0.014 },
      regions: ["asia", "global"],
      scope: "asia",
      importanceScore: 78,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-2",
      name: "ASEAN Grid Interconnection",
      category: "Infrastructure",
      commodities: ["electricity"],
      explanation: "The ASEAN Power Grid initiative is progressively interconnecting Southeast Asian transmission networks, enabling cross-border power trade, reducing reserve margins, and moderating wholesale price spikes in import-dependent markets.",
      direction: "down",
      magnitude: "Medium",
      source: "ASEAN Centre for Energy; ADB",
      bias: "mid",
      drift: { electricity: -0.015 },
      regions: ["asia"],
      scope: "asia",
      importanceScore: 62,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-3",
      name: "Coal-to-Gas Switching",
      category: "Transition",
      commodities: ["oil", "electricity"],
      explanation: "Several Asian economies are accelerating coal-to-gas conversion in power generation to meet emissions targets. This structural shift supports regional LNG demand and reduces the carbon intensity of electricity, while adding a gas-price link to power costs.",
      direction: "mixed",
      magnitude: "High",
      source: "IGU World LNG Report; IEA Gas 2025",
      bias: "mid",
      drift: { oil: 0.008, electricity: 0.01 },
      regions: ["asia"],
      scope: "asia",
      importanceScore: 70,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-4",
      name: "Strait of Hormuz Risk",
      category: "Geopolitics",
      commodities: ["oil"],
      explanation: "Over 20% of global oil supply transits the Strait of Hormuz. Any disruption — whether from regional conflict, sanctions enforcement, or shipping incidents — immediately lifts Asian crude import costs and adds a persistent risk premium to Dubai/Oman benchmarks.",
      direction: "up",
      magnitude: "High",
      source: "EIA; Vortexa; UNCTAD",
      bias: "short",
      drift: { oil: 0.025 },
      regions: ["asia", "global"],
      scope: "asia",
      importanceScore: 82,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-5",
      name: "Urbanization & Desalination",
      category: "Structural",
      commodities: ["water", "electricity"],
      explanation: "Rapid urban expansion across China, India, and Southeast Asia drives municipal water demand beyond sustainable groundwater supply. Large-scale desalination and wastewater reuse projects are expanding but remain energy-intensive, linking water tariffs to power prices.",
      direction: "up",
      magnitude: "Medium",
      source: "UN-Habitat; World Bank Water Global Practice",
      bias: "long",
      drift: { water: 0.025, electricity: 0.006 },
      regions: ["asia"],
      scope: "asia",
      importanceScore: 68,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-6",
      name: "Renewable Energy Buildout",
      category: "Transition",
      commodities: ["electricity", "oil"],
      explanation: "China leads global solar and wind installations, with India and Southeast Asia following. Falling renewable LCOEs suppress daytime wholesale power prices, while long-term oil demand growth is capped by electrification of transport and industry.",
      direction: "down",
      magnitude: "High",
      source: "IRENA; BNEF; China NEA",
      bias: "long",
      drift: { electricity: -0.02, oil: -0.012 },
      regions: ["asia", "global"],
      scope: "asia",
      importanceScore: 75,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-7",
      name: "Monsoon & Hydropower Variability",
      category: "Climate",
      commodities: ["electricity", "water"],
      explanation: "South and Southeast Asian power systems rely heavily on monsoon-fed hydropower. Weak or delayed monsoons reduce reservoir levels, forcing thermal generation dispatch and raising both power prices and water scarcity indices simultaneously.",
      direction: "up",
      magnitude: "Medium",
      source: "IMD; WMO; ADB",
      bias: "short",
      drift: { electricity: 0.012, water: 0.015 },
      regions: ["asia"],
      scope: "asia",
      importanceScore: 64,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "asia-8",
      name: "EV Adoption & Battery Storage",
      category: "Technology",
      commodities: ["oil", "electricity"],
      explanation: "China accounts for over 60% of global EV sales. Battery storage deployments are accelerating alongside solar, flattening daily load curves and reducing peak power prices while structurally eroding gasoline and diesel demand across the region.",
      direction: "down",
      magnitude: "High",
      source: "IEA Global EV Outlook; CAAM; CATL",
      bias: "long",
      drift: { oil: -0.018, electricity: -0.005 },
      regions: ["asia", "global"],
      scope: "asia",
      importanceScore: 72,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  europe: [
    {
      id: "europe-1",
      name: "EU ETS Carbon Price",
      category: "Policy",
      commodities: ["electricity", "water"],
      explanation: "The EU Emissions Trading System sets a rising carbon cost that flows directly into fossil generation margins and industrial water treatment. Higher EUA prices increase wholesale power costs and incentivize low-carbon generation and efficiency investments.",
      direction: "up",
      magnitude: "High",
      source: "European Commission; ICE; ICAP",
      bias: "long",
      drift: { electricity: 0.018, water: 0.006 },
      regions: ["europe", "global"],
      scope: "europe",
      importanceScore: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-2",
      name: "Russian Supply Displacement",
      category: "Geopolitics",
      commodities: ["oil", "electricity"],
      explanation: "Europe's structural shift away from Russian pipeline gas and crude has created a persistent import premium. LNG regasification capacity, alternative pipeline routes, and demand destruction have rebalanced but not eliminated the cost differential versus pre-2022 levels.",
      direction: "up",
      magnitude: "High",
      source: "IEA; Bruegel; ENTSOG",
      bias: "mid",
      drift: { oil: 0.015, electricity: 0.02 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 85,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-3",
      name: "Renewables Curtailment Risk",
      category: "Market",
      commodities: ["electricity"],
      explanation: "Rapid solar and wind additions in Germany, Spain, and the Nordics increasingly produce negative-price hours during high-generation/low-demand periods. Curtailment reduces renewable asset revenues and complicates investment signals for firm capacity.",
      direction: "down",
      magnitude: "Medium",
      source: "ENTSO-E; Fraunhofer ISE; BNetzA",
      bias: "mid",
      drift: { electricity: -0.01 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 58,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-4",
      name: "Drought & Alpine Hydro",
      category: "Climate",
      commodities: ["electricity", "water"],
      explanation: "Recurring summer droughts deplete Alpine reservoirs that supply both hydropower and downstream cooling water for thermal plants. This dual constraint lifts electricity prices and triggers water-use restrictions across Southern and Central Europe.",
      direction: "up",
      magnitude: "Medium",
      source: "Copernicus; EEA; ENTSO-E",
      bias: "short",
      drift: { electricity: 0.015, water: 0.02 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 72,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-5",
      name: "Nuclear & Gas Generation Mix",
      category: "Structural",
      commodities: ["electricity", "oil"],
      explanation: "France's nuclear fleet availability, German phase-out completion, and UK capacity market design create divergent baseload cost structures across Europe. Gas-fired marginal pricing still dominates in many hours, linking power to global LNG and Henry Hub dynamics.",
      direction: "mixed",
      magnitude: "High",
      source: "RTE; National Grid ESO; ENTSO-E",
      bias: "mid",
      drift: { electricity: 0.008, oil: 0.005 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 68,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-6",
      name: "Energy Efficiency Mandates",
      category: "Policy",
      commodities: ["electricity", "water"],
      explanation: "The EU Energy Efficiency Directive and national building renovation targets progressively reduce per-capita electricity and hot water demand. Structural demand destruction moderates long-term price growth but increases fixed-cost recovery pressure on tariffs.",
      direction: "down",
      magnitude: "Medium",
      source: "European Commission; ODYSSEE-MURE",
      bias: "long",
      drift: { electricity: -0.012, water: -0.008 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 60,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-7",
      name: "Offshore Wind Expansion",
      category: "Transition",
      commodities: ["electricity"],
      explanation: "North Sea and Baltic offshore wind targets (120+ GW by 2030) are reshaping the merit order. High-capacity-factor offshore wind depresses wholesale prices during windy periods but increases system balancing costs and grid investment needs.",
      direction: "down",
      magnitude: "High",
      source: "WindEurope; ENTSO-E; National TSOs",
      bias: "long",
      drift: { electricity: -0.018 },
      regions: ["europe"],
      scope: "europe",
      importanceScore: 74,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "europe-8",
      name: "Heat Pump Electrification",
      category: "Technology",
      commodities: ["electricity", "oil"],
      explanation: "Rapid heat pump deployment across Germany, France, and the Nordics shifts winter heating demand from gas and oil to electricity. This raises winter peak power demand while structurally reducing residential oil and gas consumption.",
      direction: "up",
      magnitude: "Medium",
      source: "EHPA; IEA; Eurostat",
      bias: "mid",
      drift: { electricity: 0.012, oil: -0.01 },
      regions: ["europe", "global"],
      scope: "europe",
      importanceScore: 66,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  africa: [
    {
      id: "africa-1",
      name: "Nigeria & Angola Production",
      category: "Supply",
      commodities: ["oil"],
      explanation: "West Africa's two largest producers face chronic underinvestment, theft, and regulatory uncertainty. Output volatility directly affects the West African light sweet crude benchmark and regional government revenues that fund fuel subsidies and power sector investment.",
      direction: "mixed",
      magnitude: "High",
      source: "OPEC MOMR; NNPC; Sonangol; IEA",
      bias: "short",
      drift: { oil: 0.02 },
      regions: ["africa", "global"],
      scope: "africa",
      importanceScore: 78,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-2",
      name: "Diesel Genset Dependence",
      category: "Structural",
      commodities: ["oil", "electricity"],
      explanation: "Grid unreliability across Sub-Saharan Africa sustains massive distributed diesel generation. Estimated 100+ GW of backup capacity ties commercial and industrial electricity costs directly to diesel pump prices, creating a floor for regional power tariffs.",
      direction: "up",
      magnitude: "High",
      source: "World Bank; AfDB; IEA Africa Energy Outlook",
      bias: "flat",
      drift: { oil: 0.015, electricity: 0.018 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 82,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-3",
      name: "Drought & Sahel Scarcity",
      category: "Climate",
      commodities: ["water", "electricity"],
      explanation: "Recurring Sahel droughts reduce surface water availability for municipal supply, irrigation, and hydropower (e.g., Kariba, Cahora Bassa). Water tariffs rise sharply during dry years while power rationing spreads across the Southern African Power Pool.",
      direction: "up",
      magnitude: "High",
      source: "WMO; UN-Water; SAPP; Zambezi River Authority",
      bias: "short",
      drift: { water: 0.03, electricity: 0.015 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-4",
      name: "Subsidy Reform Pressure",
      category: "Policy",
      commodities: ["oil", "electricity", "water"],
      explanation: "IMF programs and fiscal consolidation drives are forcing petroleum product and electricity subsidy reductions in Nigeria, Egypt, Angola, and others. Price liberalization causes immediate tariff spikes but improves utility creditworthiness and investment conditions over time.",
      direction: "up",
      magnitude: "High",
      source: "IMF Country Reports; World Bank Subsidy Tracker",
      bias: "short",
      drift: { oil: 0.02, electricity: 0.025, water: 0.015 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 76,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-5",
      name: "Hydroelectric Reliance",
      category: "Structural",
      commodities: ["electricity", "water"],
      explanation: "Hydropower provides >80% of electricity in several African countries (DRC, Ethiopia, Zambia, Mozambique). Climate-driven reservoir volatility creates systemic price and reliability risk that cascades into water allocation disputes and thermal backup costs.",
      direction: "mixed",
      magnitude: "High",
      source: "IAEA; AfDB; IHA",
      bias: "mid",
      drift: { electricity: 0.01, water: 0.008 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 70,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-6",
      name: "Solar Mini-Grid Deployment",
      category: "Technology",
      commodities: ["electricity"],
      explanation: "Falling solar PV and battery costs are enabling commercial mini-grid rollouts across rural and peri-urban Africa. Where grid extension is uneconomic, mini-grids provide first-time access at tariffs competitive with diesel, gradually reshaping the rural power cost curve.",
      direction: "down",
      magnitude: "Medium",
      source: "World Bank ESMAP; ARE; GOGLA",
      bias: "mid",
      drift: { electricity: -0.012 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 62,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-7",
      name: "Copper & Critical Minerals Demand",
      category: "Market",
      commodities: ["electricity", "water"],
      explanation: "The DRC and Zambia dominate global cobalt and copper supply. Green-energy-driven demand for these minerals generates export revenues that can fund power and water infrastructure, but also creates local resource competition and environmental externalities affecting water quality.",
      direction: "mixed",
      magnitude: "Medium",
      source: "USGS; ICMM; World Bank",
      bias: "long",
      drift: { electricity: 0.006, water: 0.008 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 58,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "africa-8",
      name: "Diesel Import Parity Pricing",
      category: "Market",
      commodities: ["oil", "electricity"],
      explanation: "Most African countries import refined products. Pump prices track international diesel benchmarks plus freight, insurance, and port costs. Currency depreciation against the USD amplifies import parity effects, transmitting global oil moves directly to local power and transport costs.",
      direction: "up",
      magnitude: "High",
      source: "GlobalPetrolPrices; UNCTAD; Afreximbank",
      bias: "short",
      drift: { oil: 0.018, electricity: 0.012 },
      regions: ["africa"],
      scope: "africa",
      importanceScore: 74,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  americas: [
    {
      id: "americas-1",
      name: "US Shale Productivity",
      category: "Supply",
      commodities: ["oil"],
      explanation: "Permian and Eagle Ford efficiency gains continue to lower breakeven prices and raise per-rig output. US production growth capacity acts as a global supply ceiling, limiting Brent upside and keeping WTI-Brent spreads structurally wide.",
      direction: "down",
      magnitude: "High",
      source: "EIA DPR; Rystad Energy; Dallas Fed Energy Survey",
      bias: "mid",
      drift: { oil: -0.015 },
      regions: ["americas", "global"],
      scope: "americas",
      importanceScore: 78,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-2",
      name: "Henry Hub Gas to Power",
      category: "Market",
      commodities: ["electricity", "oil"],
      explanation: "US gas-fired generation sets marginal power prices across ERCOT, PJM, and ISO-NE. Henry Hub volatility — driven by weather, LNG export demand, and storage levels — transmits directly to wholesale electricity and competes with oil in industrial heating.",
      direction: "mixed",
      magnitude: "High",
      source: "EIA NGW; CME Group; FERC",
      bias: "short",
      drift: { electricity: 0.012, oil: 0.005 },
      regions: ["americas"],
      scope: "americas",
      importanceScore: 76,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-3",
      name: "LatAm Hydrology & Drought",
      category: "Climate",
      commodities: ["electricity", "water"],
      explanation: "Brazil, Colombia, Chile, and Argentina rely on hydropower for 50–70% of generation. Multi-year drought cycles (e.g., 2020–2022 La Niña) deplete reservoirs, forcing expensive thermal dispatch, power rationing, and municipal water restrictions across the Southern Cone.",
      direction: "up",
      magnitude: "High",
      source: "ONS; XM; CAMMESA; WMO",
      bias: "mid",
      drift: { electricity: 0.02, water: 0.025 },
      regions: ["americas"],
      scope: "americas",
      importanceScore: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-4",
      name: "Pipeline & Export Capacity",
      category: "Infrastructure",
      commodities: ["oil", "electricity"],
      explanation: "Permian takeaway constraints, TMX completion in Canada, and US Gulf LNG export additions reshape North American crude and gas flows. Bottlenecks create regional price discounts; new capacity unlocks arbitrage and links local markets more tightly to global benchmarks.",
      direction: "mixed",
      magnitude: "Medium",
      source: "CER; EIA; Enbridge; TC Energy",
      bias: "mid",
      drift: { oil: 0.008, electricity: 0.006 },
      regions: ["americas"],
      scope: "americas",
      importanceScore: 64,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-5",
      name: "California Water Stress",
      category: "Resource",
      commodities: ["water", "electricity"],
      explanation: "Chronic overallocation of the Colorado River and Sierra Nevada snowpack decline drive escalating urban and agricultural water tariffs in California and the Southwest. Energy-intensive conveyance (SWP, CVP) links water costs directly to power prices.",
      direction: "up",
      magnitude: "High",
      source: "USBR; CA DWR; MWD; PAC Institute",
      bias: "long",
      drift: { water: 0.03, electricity: 0.008 },
      regions: ["americas"],
      scope: "americas",
      importanceScore: 78,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-6",
      name: "Grid Resilience Investment",
      category: "Investment",
      commodities: ["electricity"],
      explanation: "FERC Order 2222, IRA grid funding, and state-level hardening mandates are driving tens of billions in transmission, storage, and DER integration. Cost recovery through rates pushes retail tariffs up, while improved reliability reduces outage-related economic losses.",
      direction: "up",
      magnitude: "Medium",
      source: "FERC; DOE GDO; EEI; NERC",
      bias: "long",
      drift: { electricity: 0.01 },
      regions: ["americas"],
      scope: "americas",
      importanceScore: 62,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-7",
      name: "EV Adoption & Battery Storage",
      category: "Technology",
      commodities: ["oil", "electricity"],
      explanation: "US and Canada EV sales exceed 10% of new vehicles; California targets 100% ZEV by 2035. Utility-scale battery deployments (20+ GW in CAISO/ERCOT) flatten duck curves, reduce peak gas generation, and structurally cap gasoline demand growth.",
      direction: "down",
      magnitude: "High",
      source: "IEA; EIA; Argonne National Lab; CARB",
      bias: "long",
      drift: { oil: -0.02, electricity: -0.006 },
      regions: ["americas", "global"],
      scope: "americas",
      importanceScore: 72,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "americas-8",
      name: "LNG Export Growth",
      category: "Market",
      commodities: ["oil", "electricity"],
      explanation: "US LNG export capacity is doubling by 2028. Rising feedgas demand links Henry Hub more tightly to global JKM and TTF prices, raising domestic gas and power costs while supporting associated gas production that moderates WTI discounts to Brent.",
      direction: "up",
      magnitude: "Medium",
      source: "EIA; FERC; IGU; Cheniere; Sempra",
      bias: "mid",
      drift: { oil: 0.006, electricity: 0.01 },
      regions: ["americas", "global"],
      scope: "americas",
      importanceScore: 68,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  oceania: [
    {
      id: "oceania-1",
      name: "LNG Export Linkage",
      category: "Market",
      commodities: ["oil", "electricity"],
      explanation: "Australia is the world's largest LNG exporter. East coast domestic gas prices are set by netback to Asian spot LNG (JKM), creating a direct pass-through to gas-fired power generation and industrial users in NSW, QLD, and VIC.",
      direction: "up",
      magnitude: "High",
      source: "AEMO; ACCC; DISR; JKM assessments",
      bias: "mid",
      drift: { oil: 0.01, electricity: 0.018 },
      regions: ["oceania", "global"],
      scope: "oceania",
      importanceScore: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-2",
      name: "NEM & NZ Wholesale Spikes",
      category: "Market",
      commodities: ["electricity"],
      explanation: "Australia's National Electricity Market and New Zealand's wholesale market exhibit extreme price volatility during coal plant outages, low wind/solar, and high demand. The market cap (AUD 17,500/MWh) and administered price caps create tail-risk that lifts forward curves and contract premiums.",
      direction: "up",
      magnitude: "High",
      source: "AEMO; EA; ASX Energy; FMA",
      bias: "short",
      drift: { electricity: 0.025 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 78,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-3",
      name: "Millennium Drought Legacy",
      category: "Climate",
      commodities: ["water", "electricity"],
      explanation: "The 1997–2009 Millennium Drought reshaped Australian water policy: desalination plants, water trading, and urban demand management. Climate projections indicate recurring multi-year droughts, keeping water scarcity pricing and desalination energy demand structurally elevated.",
      direction: "up",
      magnitude: "High",
      source: "BOM; CSIRO; MDBA; Water Services Association",
      bias: "long",
      drift: { water: 0.025, electricity: 0.008 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 76,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-4",
      name: "Remote Island Fuel Premiums",
      category: "Structural",
      commodities: ["oil", "electricity"],
      explanation: "Pacific Island nations and remote Australian communities rely on shipped diesel for power generation. Freight, storage, and small-scale logistics add 50–100% premiums over Singapore benchmarks, making oil and electricity prices among the highest globally per kWh.",
      direction: "up",
      magnitude: "High",
      source: "SPC; PPA; ADB Pacific Energy Update",
      bias: "flat",
      drift: { oil: 0.02, electricity: 0.02 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 70,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-5",
      name: "Desalination & Reuse",
      category: "Technology",
      commodities: ["water", "electricity"],
      explanation: "Major Australian cities (Perth, Adelaide, Sydney, Melbourne, Gold Coast) operate large-scale desalination. Perth sources ~50% of supply from desal. Energy-intensive RO plants add baseload electricity demand and link water tariffs to NEM wholesale prices.",
      direction: "mixed",
      magnitude: "Medium",
      source: "Water Corporation; Sydney Water; SA Water; BOM",
      bias: "long",
      drift: { water: 0.01, electricity: 0.005 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 64,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-6",
      name: "Renewable Energy Zones",
      category: "Policy",
      commodities: ["electricity"],
      explanation: "NSW, QLD, and VIC Renewable Energy Zones coordinate transmission, generation, and storage investment. Streamlined approvals and shared network infrastructure reduce connection costs and accelerate coal retirement, pushing down long-run marginal cost of electricity.",
      direction: "down",
      magnitude: "High",
      source: "AEMO ISP; State energy departments; CEC",
      bias: "long",
      drift: { electricity: -0.02 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 72,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-7",
      name: "Coal Plant Retirements",
      category: "Transition",
      commodities: ["electricity", "oil"],
      explanation: "Liddell, Eraring, Yallourn, and Callide B closures remove ~6 GW of baseload coal by 2030. Replacement by firmed renewables and gas raises near-term price volatility but lowers long-run emissions intensity and marginal cost once storage is sufficient.",
      direction: "mixed",
      magnitude: "High",
      source: "AEMO; Origin; AGL; EnergyAustralia",
      bias: "mid",
      drift: { electricity: 0.01, oil: -0.005 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 68,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "oceania-8",
      name: "Urban Water Tariff Reform",
      category: "Policy",
      commodities: ["water"],
      explanation: "Australian utilities are shifting to cost-reflective, inclining-block tariffs with scarcity pricing triggers. Independent pricing regulators (IPART, ESC, QCA) approve periodic real increases to fund network renewal and climate adaptation, outpacing CPI in most jurisdictions.",
      direction: "up",
      magnitude: "Medium",
      source: "IPART; ESC; QCA; Productivity Commission",
      bias: "long",
      drift: { water: 0.018 },
      regions: ["oceania"],
      scope: "oceania",
      importanceScore: 62,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Forecast generation                                                */
/* ------------------------------------------------------------------ */

export interface PriceBand {
  avg: number;
  min: number;
  max: number;
}

export interface ForecastPoint {
  year: number;
  label: string;
  oil: PriceBand;
  electricity: PriceBand;
  water: PriceBand;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const round = (v: number, d: number) => {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
};

function commodityForRegion(c: Commodity, region: RegionProfile): Commodity {
  if (region.id === "global") return c;
  const base = region.bases[c.id];
  const cagr = c.cagr + region.cagrAdj[c.id];
  const maxVol = clamp(c.maxVol + region.volAdj[c.id], 0.12, 0.55);
  const floor = c.id === "electricity" ? Math.max(40, base * 0.45) : c.floor * (base / c.base);
  const ceil = c.id === "electricity" ? Math.max(c.ceil, base * 1.6) : c.ceil * (base / c.base) * 1.05;
  return {
    ...c,
    base,
    cagr,
    maxVol,
    floor: round(floor, c.decimals),
    ceil: round(ceil, c.decimals),
    name:
      c.id === "oil"
        ? `${region.oilMarker} Oil`
        : c.id === "electricity"
          ? `${region.short} Electricity`
          : `${region.short} Water`,
  };
}

export function generateForecast(
  prices: Record<CommodityId, number>,
  horizon: number,
  jitter = 0,
  regionId: RegionId = "global",
): ForecastPoint[] {
  const region = regionById(regionId);
  const points: ForecastPoint[] = [];

  for (let t = 0; t <= horizon; t++) {
    const entry = {
      year: START_YEAR + t,
      label: String(START_YEAR + t),
    } as ForecastPoint;

    for (const raw of COMMODITIES) {
      const c = commodityForRegion(raw, region);
      const basePrice = prices[c.id] ?? c.base;
      // Scale live global spot into regional marker using the static ratio
      const regionalSpot =
        region.id === "global"
          ? basePrice
          : basePrice * (region.bases[c.id] / (COMMODITIES.find((x) => x.id === c.id)?.base ?? basePrice));

      const trend = regionalSpot * Math.pow(1 + c.cagr, t);
      const cycle = 1 + c.cycleAmp * Math.sin(t * 0.9 + c.cyclePhase + jitter * 0.15);
      const driftSum = FACTORS.reduce((acc, f) => {
        if (f.regions && region.id !== "global" && !f.regions.includes(region.id) && !f.regions.includes("global")) {
          return acc + (f.drift[c.id] ?? 0) * (t / 10) * 0.35;
        }
        return acc + (f.drift[c.id] ?? 0) * (t / 10);
      }, 0);
      const factorAdjust = clamp(1 + driftSum, 0.85, 1.18);
      const avg = clamp(trend * cycle * factorAdjust, c.floor, c.ceil);
      const vol = c.maxVol * Math.sqrt(t / 10 || 0.02);

      entry[c.id] = {
        avg: round(avg, c.decimals),
        min: round(avg * (1 - vol), c.decimals),
        max: round(avg * (1 + vol), c.decimals),
      };
    }

    points.push(entry);
  }

  return points;
}

/** Live spot prices for every evaluation region, derived from the global feed. */
export function regionalSpotPrices(
  globalPrices: Record<CommodityId, number>,
): Record<RegionId, Record<CommodityId, number>> {
  const out = {} as Record<RegionId, Record<CommodityId, number>>;
  for (const region of REGIONS) {
    const row = {} as Record<CommodityId, number>;
    for (const c of COMMODITIES) {
      if (region.id === "global") {
        row[c.id] = globalPrices[c.id];
      } else {
        const scaled = globalPrices[c.id] * (region.bases[c.id] / c.base);
        row[c.id] = round(scaled, c.decimals === 0 ? 1 : c.decimals);
      }
    }
    out[region.id] = row;
  }
  return out;
}

export interface RegionEvaluation {
  region: RegionProfile;
  spots: Record<CommodityId, number>;
  horizon: Record<CommodityId, PriceBand>;
  /** % change spot → horizon avg */
  deltaPct: Record<CommodityId, number>;
  /** vs global horizon avg, % */
  vsGlobalPct: Record<CommodityId, number>;
  /** composite score 0–100 (affordability-oriented for power/water, stability for oil) */
  score: number;
  outlook: "bullish" | "neutral" | "bearish";
}

export function evaluateRegions(
  globalPrices: Record<CommodityId, number>,
  horizon: number,
  jitter = 0,
): RegionEvaluation[] {
  const globalPts = generateForecast(globalPrices, horizon, jitter, "global");
  const globalHorizon = globalPts[globalPts.length - 1];
  const spots = regionalSpotPrices(globalPrices);

  return EVAL_REGIONS.map((region) => {
    const pts = generateForecast(globalPrices, horizon, jitter, region.id);
    const today = pts[0];
    const end = pts[pts.length - 1];
    const deltaPct = {} as Record<CommodityId, number>;
    const vsGlobalPct = {} as Record<CommodityId, number>;
    const horizonBand = {} as Record<CommodityId, PriceBand>;

    for (const c of COMMODITIES) {
      horizonBand[c.id] = end[c.id];
      deltaPct[c.id] = ((end[c.id].avg - today[c.id].avg) / today[c.id].avg) * 100;
      vsGlobalPct[c.id] =
        ((end[c.id].avg - globalHorizon[c.id].avg) / globalHorizon[c.id].avg) * 100;
    }

    // Affordability score: lower power+water vs global = higher score; oil stability bonus
    const powerGap = -vsGlobalPct.electricity;
    const waterGap = -vsGlobalPct.water;
    const oilStability = 100 - Math.min(40, Math.abs(deltaPct.oil));
    const score = clamp(
      round(50 + powerGap * 0.35 + waterGap * 0.25 + (oilStability - 70) * 0.4, 0),
      5,
      98,
    );

    const avgDelta = (deltaPct.oil + deltaPct.electricity + deltaPct.water) / 3;
    const outlook: RegionEvaluation["outlook"] =
      avgDelta > 12 ? "bullish" : avgDelta < 4 ? "bearish" : "neutral";

    return {
      region,
      spots: spots[region.id],
      horizon: horizonBand,
      deltaPct,
      vsGlobalPct,
      score,
      outlook,
    };
  }).sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/* Factor relevance over the horizon                                  */
/* ------------------------------------------------------------------ */

export function factorRelevance(bias: HorizonBias, horizon: number): number {
  const h = clamp(horizon, 1, 10) / 10;
  switch (bias) {
    case "short":
      return 1.7 - 0.9 * h;
    case "long":
      return 0.85 + 0.95 * h;
    case "mid":
      return 1.65 - Math.abs(h - 0.55) * 1.35;
    default:
      return 1.3;
  }
}

export type RelevanceTrend = "rising" | "fading" | "steady";

export function relevanceTrend(bias: HorizonBias, horizon: number): RelevanceTrend {
  const delta = factorRelevance(bias, horizon) - factorRelevance(bias, 5);
  if (delta > 0.12) return "rising";
  if (delta < -0.12) return "fading";
  return "steady";
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

export const fmtUsd = (v: number, d = 2) =>
  "$" +
  v.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

export const fmtFullDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-GB", { hour12: false });

export const hexToRgba = (hex: string, alpha: number) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function buildCSV(points: ForecastPoint[], regionId: RegionId = "global"): string {
  const region = regionById(regionId);
  const header = [
    "Year",
    "Region",
    "Oil Avg (USD/bbl)",
    "Oil Min",
    "Oil Max",
    "Electricity Avg (USD/MWh)",
    "Electricity Min",
    "Electricity Max",
    "Water Avg (USD/m3)",
    "Water Min",
    "Water Max",
  ];
  const rows = points.map((p) => [
    p.year,
    region.name,
    p.oil.avg,
    p.oil.min,
    p.oil.max,
    p.electricity.avg,
    p.electricity.min,
    p.electricity.max,
    p.water.avg,
    p.water.min,
    p.water.max,
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\n");
}

export function buildRegionalCSV(evals: RegionEvaluation[], horizonYear: number): string {
  const header = [
    "Region",
    "Oil Marker",
    "Oil Spot",
    `Oil ${horizonYear} Avg`,
    "Oil Δ%",
    "Oil vs Global %",
    "Power Spot (USD/MWh)",
    `Power ${horizonYear} Avg`,
    "Power Δ%",
    "Power vs Global %",
    "Water Spot (USD/m3)",
    `Water ${horizonYear} Avg`,
    "Water Δ%",
    "Water vs Global %",
    "Score",
    "Outlook",
  ];
  const rows = evals.map((e) => [
    e.region.name,
    e.region.oilMarker,
    e.spots.oil,
    e.horizon.oil.avg,
    round(e.deltaPct.oil, 1),
    round(e.vsGlobalPct.oil, 1),
    e.spots.electricity,
    e.horizon.electricity.avg,
    round(e.deltaPct.electricity, 1),
    round(e.vsGlobalPct.electricity, 1),
    e.spots.water,
    e.horizon.water.avg,
    round(e.deltaPct.water, 1),
    round(e.vsGlobalPct.water, 1),
    e.score,
    e.outlook,
  ]);
  return [header, ...rows].map((r) => r.join(",")).join("\n");
}

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 400);
}

export const commodityById = (id: CommodityId): Commodity =>
  COMMODITIES.find((c) => c.id === id) ?? COMMODITIES[0];
