/**
 * TecnoIndicator — Markdown export builders.
 *
 * Output targets GitHub Flavored Markdown (GFM): readable as plain text by
 * humans, renderable by any Markdown viewer, and stable enough for tools to
 * parse. Conventions applied here:
 *
 * - Downloaded as `.md` with the IANA-registered `text/markdown;charset=utf-8`
 *   media type (RFC 7763).
 * - YAML front matter carries the structured metadata machines care about,
 *   while headings, lists and tables keep the body readable on its own.
 * - GFM pipe tables always emit a delimiter row that matches the header, and
 *   cell content escapes backslashes first, then pipes, and collapses line
 *   breaks so a stray `|` or newline can never break the grid.
 * - A fenced `json` block carries the lossless series for downstream tooling.
 *
 * Prices are quoted in USD, matching the CSV exports. The in-app currency
 * selector only changes display formatting, not the exported figures.
 */

import {
  COMMODITIES,
  regionById,
  round,
  type CommodityId,
  type Factor,
  type ForecastPoint,
  type RegionEvaluation,
  type RegionId,
} from "./model";

const GENERATOR = "TecnoIndicator";
const CURRENCY = "USD";
const FORECAST_SCHEMA = "tecnoindicator.forecast.v1";
const REGION_SCHEMA = "tecnoindicator.region.v1";

export type TableAlign = "left" | "center" | "right";

export interface MarkdownExportOptions {
  /** Override the export timestamp — useful for deterministic tests. */
  generatedAt?: Date;
}

export interface RegionalMarkdownOptions extends MarkdownExportOptions {
  /** AI-curated factors for the selected region, embedded when available. */
  factors?: Factor[];
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Make a value safe for a GFM table cell.
 *
 * Backslashes are escaped before pipes (a cell ending in `a\|b` would
 * otherwise serialise to `a\\|b`, which GFM reads as a literal backslash
 * followed by a cell delimiter). Newlines are collapsed because block-level
 * content is not allowed inside a table cell.
 */
export function escapeMarkdownCell(value: string | number): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Render a GFM table with a delimiter row matching the header width. */
export function markdownTable(
  headers: string[],
  rows: Array<Array<string | number>>,
  aligns: TableAlign[] = [],
): string {
  const cell = (value: string | number) => escapeMarkdownCell(value);
  const delimiter = headers.map((_, i) => {
    switch (aligns[i]) {
      case "right":
        return "---:";
      case "center":
        return ":---:";
      default:
        return "---";
    }
  });

  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${delimiter.join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function frontMatter(entries: Array<[string, string | number | boolean]>): string {
  const lines = entries.map(([key, value]) => {
    if (typeof value === "number") return `${key}: ${Number.isFinite(value) ? value : 0}`;
    if (typeof value === "boolean") return `${key}: ${value}`;
    return `${key}: ${JSON.stringify(value)}`;
  });
  return ["---", ...lines, "---"].join("\n");
}

function num(value: number, decimals: number): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

function pct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function iso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Units per commodity, exactly as the CSV exports label them. */
const UNIT: Record<CommodityId, string> = {
  oil: "USD/bbl",
  electricity: "USD/MWh",
  water: "USD/m3",
};

const SHORT: Record<CommodityId, string> = {
  oil: "Oil",
  electricity: "Power",
  water: "Water",
};

function jsonBlock(payload: unknown): string {
  return ["```json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

/* ------------------------------------------------------------------ */
/* Forecast export (Export menu → Data as MD)                          */
/* ------------------------------------------------------------------ */

export function buildMarkdown(
  points: ForecastPoint[],
  regionId: RegionId = "global",
  options: MarkdownExportOptions = {},
): string {
  const region = regionById(regionId);
  const generatedAt = iso(options.generatedAt ?? new Date());
  const startYear = points[0]?.year ?? 0;
  const endYear = points[points.length - 1]?.year ?? startYear;
  const horizon = Math.max(0, endYear - startYear);

  const headers = ["Year"];
  const aligns: TableAlign[] = ["right"];
  for (const c of COMMODITIES) {
    // Forecast CSV headers say "Oil"/"Electricity"/"Water"; keep that naming
    // so both export formats describe the same series identically.
    headers.push(
      `${c.short} avg (${UNIT[c.id]})`,
      `${c.short} low`,
      `${c.short} high`,
    );
    aligns.push("right", "right", "right");
  }

  const rows = points.map((p) => [
    p.year,
    ...COMMODITIES.flatMap((c) => [
      num(p[c.id].avg, c.decimals),
      num(p[c.id].min, c.decimals),
      num(p[c.id].max, c.decimals),
    ]),
  ]);

  const payload = {
    schema: FORECAST_SCHEMA,
    generator: GENERATOR,
    generatedAt,
    region: { id: region.id, name: region.name, oilMarker: region.oilMarker },
    currency: CURRENCY,
    startYear,
    endYear,
    horizonYears: horizon,
    series: points.map((p) => ({
      year: p.year,
      oil: { ...p.oil },
      electricity: { ...p.electricity },
      water: { ...p.water },
    })),
  };

  return [
    frontMatter([
      ["title", `${GENERATOR} forecast — ${region.name}`],
      ["generator", GENERATOR],
      ["schema", FORECAST_SCHEMA],
      ["region", region.name],
      ["region_id", region.id],
      ["oil_marker", region.oilMarker],
      ["currency", CURRENCY],
      ["start_year", startYear],
      ["end_year", endYear],
      ["horizon_years", horizon],
      ["generated_at", generatedAt],
    ]),
    "",
    `# ${region.flag} ${region.name} commodity price forecast`,
    "",
    `> Generated by ${GENERATOR} on ${generatedAt} · **Region:** ${region.name} · **Oil marker:** ${region.oilMarker} · **Horizon:** ${horizon} ${horizon === 1 ? "year" : "years"} (${startYear}–${endYear}) · **Currency:** ${CURRENCY}`,
    "",
    "## Forecast",
    "",
    markdownTable(headers, rows, aligns),
    "",
    "## Methodology",
    "",
    "- Model: `avg(t) = base × (1 + CAGR)^t × cycle(t) × factorAdjust(t)`",
    "- Band: `min/max(t) = avg(t) × (1 ± σ·√(t/10))`",
    "- Regional spot anchors use research-backed crude markers, retail power and municipal water tariffs.",
    "- Figures are illustrative forecasts generated in the browser, not investment advice.",
    "",
    "## Machine-readable data",
    "",
    jsonBlock(payload),
    "",
    "---",
    "",
    `Generated by [${GENERATOR}](https://tecnoindicator.vercel.app/) · ${generatedAt}`,
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Regional export (Regional intelligence → Export region MD)          */
/* ------------------------------------------------------------------ */

function factorCommodities(factor: Factor): string {
  return factor.commodities
    .map((id) => COMMODITIES.find((c) => c.id === id)?.short ?? id)
    .join(", ");
}

function factorSection(factors: Factor[]): string[] {
  if (factors.length === 0) return [];

  const lines: string[] = ["## Regional factors", ""];
  factors.forEach((factor, index) => {
    const title = factor.name.replace(/\r?\n/g, " ").trim();
    lines.push(
      `### ${index + 1}. ${title}`,
      "",
      `- **Category:** ${factor.category}`,
      `- **Direction:** ${factor.direction} · **Magnitude:** ${factor.magnitude} · **Impact:** ${factor.importanceScore}/100`,
      `- **Commodities:** ${factorCommodities(factor)}`,
      `- **Source:** ${factor.source}`,
      "",
      factor.explanation.replace(/\r?\n/g, " ").trim(),
      "",
    );
  });
  return lines;
}

export function buildRegionalMarkdown(
  evals: RegionEvaluation[],
  horizonYear: number,
  regionId: RegionId,
  options: RegionalMarkdownOptions = {},
): string {
  const index = Math.max(
    0,
    evals.findIndex((e) => e.region.id === regionId),
  );
  const evaluation = evals[index] ?? evals[0];
  if (!evaluation) {
    throw new Error("buildRegionalMarkdown requires at least one region evaluation");
  }

  const { region } = evaluation;
  const generatedAt = iso(options.generatedAt ?? new Date());
  const factors = options.factors ?? [];
  const rank = index + 1;

  const priceHeaders = [
    "Commodity",
    "Spot",
    `${horizonYear} avg`,
    `${horizonYear} range (low–high)`,
    "Spot → avg",
    "vs global",
  ];
  const priceRows = COMMODITIES.map((c) => [
    `${SHORT[c.id]} (${UNIT[c.id]})`,
    num(evaluation.spots[c.id], c.decimals),
    num(evaluation.horizon[c.id].avg, c.decimals),
    `${num(evaluation.horizon[c.id].min, c.decimals)} – ${num(evaluation.horizon[c.id].max, c.decimals)}`,
    pct(evaluation.deltaPct[c.id]),
    pct(evaluation.vsGlobalPct[c.id]),
  ]);

  const payload = {
    schema: REGION_SCHEMA,
    generator: GENERATOR,
    generatedAt,
    region: {
      id: region.id,
      name: region.name,
      oilMarker: region.oilMarker,
      drivers: region.drivers,
    },
    score: evaluation.score,
    rank,
    regionCount: evals.length,
    outlook: evaluation.outlook,
    currency: CURRENCY,
    horizonYear,
    spots: { ...evaluation.spots },
    horizon: {
      oil: { ...evaluation.horizon.oil },
      electricity: { ...evaluation.horizon.electricity },
      water: { ...evaluation.horizon.water },
    },
    deltaPct: {
      oil: round(evaluation.deltaPct.oil, 2),
      electricity: round(evaluation.deltaPct.electricity, 2),
      water: round(evaluation.deltaPct.water, 2),
    },
    vsGlobalPct: {
      oil: round(evaluation.vsGlobalPct.oil, 2),
      electricity: round(evaluation.vsGlobalPct.electricity, 2),
      water: round(evaluation.vsGlobalPct.water, 2),
    },
    factors: factors.map((factor) => ({
      id: factor.id,
      name: factor.name,
      category: factor.category,
      direction: factor.direction,
      magnitude: factor.magnitude,
      importanceScore: factor.importanceScore,
      commodities: factor.commodities,
      explanation: factor.explanation,
      source: factor.source,
    })),
  };

  return [
    frontMatter([
      ["title", `${GENERATOR} regional intelligence — ${region.name}`],
      ["generator", GENERATOR],
      ["schema", REGION_SCHEMA],
      ["region", region.name],
      ["region_id", region.id],
      ["oil_marker", region.oilMarker],
      ["score", evaluation.score],
      ["score_rank", rank],
      ["region_count", evals.length],
      ["outlook", evaluation.outlook],
      ["currency", CURRENCY],
      ["horizon_year", horizonYear],
      ["generated_at", generatedAt],
    ]),
    "",
    `# ${region.flag} ${region.name} — regional intelligence`,
    "",
    `> Composite affordability score **${evaluation.score}/100** (rank **#${rank} of ${evals.length}**) · **${evaluation.outlook}** outlook · Generated by ${GENERATOR} on ${generatedAt}`,
    "",
    region.blurb,
    "",
    "## Market snapshot",
    "",
    markdownTable(
      ["Metric", "Value"],
      [
        ["Composite score", `${evaluation.score}/100`],
        ["Rank", `#${rank} of ${evals.length}`],
        ["Outlook", evaluation.outlook],
        ["Oil marker", region.oilMarker],
        ["Forecast horizon", `${horizonYear} average`],
        ["Currency", CURRENCY],
      ],
      ["left", "left"],
    ),
    "",
    "## Prices",
    "",
    markdownTable(priceHeaders, priceRows, [
      "left",
      "right",
      "right",
      "right",
      "right",
      "right",
    ]),
    "",
    "## Key regional drivers",
    "",
    ...region.drivers.map((driver, i) => `${i + 1}. ${driver}`),
    "",
    ...factorSection(factors),
    "## Machine-readable data",
    "",
    jsonBlock(payload),
    "",
    "---",
    "",
    `Generated by [${GENERATOR}](https://tecnoindicator.vercel.app/) · ${generatedAt}`,
    "",
  ].join("\n");
}
