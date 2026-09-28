"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import MarketIndexStrip, { type AnalyticsSnapshot } from "@/components/MarketIndexStrip";
import ForecastTool from "@/components/ForecastTool";
import SolutionsSection from "@/components/SolutionsSection";
import FactorsSection from "@/components/FactorsSection";
import RegionalEvaluation from "@/components/RegionalEvaluation";
import AboutSection from "@/components/AboutSection";
import Footer from "@/components/Footer";
import { useLiveMarket } from "@/hook/useLiveMarket";
import { isLiveCuration, type PayloadMeta } from "@/lib/aiStatus";
import {
  EVAL_REGIONS,
  generateForecast,
  REGIONAL_FACTORS,
  type Factor,
  type RegionId,
  type Solution,
} from "@/lib/model";

const ANALYTICS_POLL_MS = 60_000;
const FACTORS_POLL_MS = 120_000;
const SOLUTIONS_POLL_MS = 120_000;
const HEALTH_POLL_MS = 5 * 60_000;
/**
 * Delay before warming the region the user is most likely to open next.
 *
 * It is deliberately larger than the ~15s warm cost of a single curation
 * pipeline, so the prefetch can never overlap the request the user is actually
 * waiting on — the whole point of the previous 8s stagger was lost to that
 * overlap. Prefetching is also at most once per region per session.
 */
const REGION_PREFETCH_DELAY_MS = 16_000;

type HealthStatus = "Initializing AI" | "Online Model Connected" | "Offline Model";

/** The honesty fields of a factors/solutions response body. */
type FactorsMeta = PayloadMeta;

/** Extracts the honesty fields, keeping them even when `factors` is unusable. */
function readMeta(data: unknown): FactorsMeta | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return {
    aiCurated: d.aiCurated === true,
    degraded: d.degraded === true,
    ...(typeof d.reason === "string" ? { reason: d.reason } : {}),
    ...(d.servedFrom === "cache" || d.servedFrom === "curated" || d.servedFrom === "fallback"
      ? { servedFrom: d.servedFrom }
      : {}),
    ...(typeof d.updatedAt === "string" ? { updatedAt: d.updatedAt } : {}),
    ...(typeof d.error === "string" ? { error: d.error } : {}),
    ...(typeof d.aiCount === "number" ? { aiCount: d.aiCount } : {}),
  };
}

/**
 * Identity of a reason set for one scope: the reasons themselves, sorted.
 *
 * Deliberately excludes `updatedAt`. The server re-stamps `updatedAt` on every
 * successful curation, so a timestamp-based signature changed on *every* poll
 * even when the model returned the very same 8 reasons — which fired a
 * `force=true` solutions pipeline (a full evidence + inference run) on a timer.
 * `id` is inherited by name across re-curations (see `mergeRollingWindow`), and
 * `importanceScore` is the substance the solutions are written against, so
 * these three fields change exactly when the reason set genuinely changed.
 */
function reasonSignature(scope: RegionId, factors: Factor[]): string {
  const parts = factors
    .map((f) => `${f.id}\u00b7${f.name}\u00b7${f.importanceScore}`)
    .sort();
  return `${scope}#${parts.join("~")}`;
}

export default function HomePage() {
  const [horizon, setHorizon] = useState(7);
  const [region, setRegion] = useState<RegionId>("global");

  const {
    prices,
    deltas,
    jitter,
    lastUpdated,
    waterLive,
    waterFetching,
    isLive,
    streaming,
    refresh,
    fetchWater,
    toggleLive,
  } = useLiveMarket();

  const [healthStatus, setHealthStatus] = useState<HealthStatus>("Initializing AI");
  const [globalFactors, setGlobalFactors] = useState<Factor[]>([]);
  const [globalFactorsMeta, setGlobalFactorsMeta] = useState<FactorsMeta | null>(null);
  const [regionalFactors, setRegionalFactors] = useState<Record<string, Factor[]>>({});
  const [regionalFactorsMeta, setRegionalFactorsMeta] = useState<Record<string, FactorsMeta>>({});
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [solutionsMeta, setSolutionsMeta] = useState<PayloadMeta | null>(null);
  const [analytics, setAnalytics] = useState<Record<string, AnalyticsSnapshot>>({});

  /**
   * Regions whose factor window and analytics the client has been asked for.
   *
   * A visitor can only ever look at one region at a time, so curating all five
   * every cycle spent four full pipelines per 2 minutes on rows nobody reads —
   * and, with a stagger shorter than the server's warm cost, ran them on top
   * of each other. Only activated regions are polled; activation happens when
   * the user selects a region.
   */
  const [activeRegions, setActiveRegions] = useState<Record<string, boolean>>({});
  const activeRegionsRef = useRef<RegionId[]>([]);
  /** Regions with a factor/analytics request currently on the wire. */
  const inFlightRef = useRef<Record<string, boolean>>({});
  const [loadingRegions, setLoadingRegions] = useState<Record<string, boolean>>({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activeRegionsRef.current = Object.keys(activeRegions) as RegionId[];
  }, [activeRegions]);

  const points = useMemo(
    () => generateForecast(prices, horizon, jitter, region),
    [prices, horizon, jitter, region],
  );

  const handleFetchWater = useCallback(() => void fetchWater(), [fetchWater]);

  /** "global" is already a valid scope id for every /api route. */
  const scope: RegionId = region;
  const scopeRef = useRef<RegionId>(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  /** Reasons currently driving the active scope — the input to the solutions. */
  const scopeFactors = useMemo(
    () => (scope === "global" ? globalFactors : (regionalFactors[scope] ?? [])),
    [scope, globalFactors, regionalFactors],
  );

  const scopeMeta: FactorsMeta | undefined =
    scope === "global" ? (globalFactorsMeta ?? undefined) : regionalFactorsMeta[scope];
  const scopeAnalytics = analytics[scope];

  /**
   * True when the reasons on screen are the product of a successful AI run.
   * A degraded payload carries no new reasons, so it must not trigger a
   * forced solutions regeneration — that would burn a full pipeline reacting to
   * nothing.
   */
  const scopeLiveCurated = isLiveCuration(scopeMeta) && scopeFactors.length > 0;

  const factorSignature = useMemo(
    () => reasonSignature(scope, scopeFactors),
    [scope, scopeFactors],
  );

  // Seed the hand-authored regional reference factors. They stay in place
  // until the API confirms a genuinely AI-curated window for that region, so a
  // region is never blank while its live window is still being curated.
  useEffect(() => {
    const init: Record<string, Factor[]> = {};
    for (const r of EVAL_REGIONS) {
      init[r.id] = REGIONAL_FACTORS[r.id] ?? [];
    }
    setRegionalFactors(init);
  }, []);

  // Poll health endpoint
  useEffect(() => {
    let active = true;
    const pollHealth = async () => {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) throw new Error("Health check failed");
        const data = await res.json();
        if (active) {
          setHealthStatus(data.onlineModelConnected === true ? "Online Model Connected" : "Offline Model");
        }
      } catch {
        if (active) setHealthStatus("Offline Model");
      }
    };
    pollHealth();
    const id = setInterval(pollHealth, HEALTH_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  /* ------------------------------------------------------------------ */
  /* Regional loaders — on demand, then on the normal poll               */
  /* ------------------------------------------------------------------ */

  /**
   * Loads one region's curated factor window. A full curation pipeline per
   * region, so it runs at most one request per region at a time and only ever
   * for a region the user has opened (or is being warmed for).
   */
  const loadRegionFactors = useCallback(async (regionId: RegionId) => {
    if (inFlightRef.current[regionId]) return;
    inFlightRef.current[regionId] = true;
    if (mountedRef.current) {
      setLoadingRegions((prev) => ({ ...prev, [regionId]: true }));
    }
    try {
      const res = await fetch(`/api/regional-factors?region=${regionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const meta = readMeta(data);
      if (!mountedRef.current) return;
      if (meta) setRegionalFactorsMeta((prev) => ({ ...prev, [regionId]: meta }));
      // Keep the hand-authored regional copy when the server is degraded —
      // static server text must not beat better local copy.
      const factors = (data as { factors?: Factor[] }).factors;
      if (meta && isLiveCuration(meta) && Array.isArray(factors) && factors.length > 0) {
        setRegionalFactors((prev) => ({ ...prev, [regionId]: factors }));
      }
    } catch {
      /* keep the last good window for this region */
    } finally {
      delete inFlightRef.current[regionId];
      if (mountedRef.current) {
        setLoadingRegions((prev) => {
          const next = { ...prev };
          delete next[regionId];
          return next;
        });
      }
    }
  }, []);

  /** Loads the analytics snapshot behind the market index strip for one region. */
  const loadRegionAnalytics = useCallback(async (regionId: RegionId) => {
    if (inFlightRef.current[`analytics:${regionId}`]) return;
    inFlightRef.current[`analytics:${regionId}`] = true;
    try {
      const res = await fetch(`/api/regional-analytics?region=${regionId}`);
      if (!res.ok) return;
      const data = (await res.json()) as AnalyticsSnapshot;
      if (!mountedRef.current) return;
      setAnalytics((prev) => ({ ...prev, [regionId]: data }));
    } catch {
      /* keep the last good snapshot for this region */
    } finally {
      delete inFlightRef.current[`analytics:${regionId}`];
    }
  }, []);

  const prefetchedRef = useRef<Record<string, boolean>>({});

  /**
   * Region selection: activate the region (so the normal poll keeps it fresh),
   * fetch its factor window and analytics immediately, and — politely, after a
   * delay longer than one warm pipeline — warm the next region in the list so
   * one further click is instant.
   */
  useEffect(() => {
    if (scope === "global") return;
    setActiveRegions((prev) => (prev[scope] ? prev : { ...prev, [scope]: true }));

    if (!prefetchedRef.current[scope]) {
      prefetchedRef.current[scope] = true;
      void loadRegionFactors(scope);
    }
    void loadRegionAnalytics(scope);

    const idx = EVAL_REGIONS.findIndex((r) => r.id === scope);
    const next = idx >= 0 ? EVAL_REGIONS[(idx + 1) % EVAL_REGIONS.length] : null;
    if (!next || prefetchedRef.current[next.id]) return;
    const timer = window.setTimeout(() => {
      prefetchedRef.current[next.id] = true;
      void loadRegionFactors(next.id);
    }, REGION_PREFETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [scope, loadRegionFactors, loadRegionAnalytics]);

  // Poll analytics for the active scopes only (global + opened regions).
  useEffect(() => {
    let active = true;
    const pollAnalytics = async () => {
      try {
        const res = await fetch("/api/analytics");
        if (res.ok) {
          const data = (await res.json()) as AnalyticsSnapshot;
          if (active) setAnalytics((prev) => ({ ...prev, global: data }));
        }
      } catch { /* ignore */ }
      // Sequential, not staggered: only the regions the user actually opened,
      // and never two at once.
      for (const r of activeRegionsRef.current) {
        if (!active) return;
        await loadRegionAnalytics(r);
      }
    };
    pollAnalytics();
    const id = setInterval(pollAnalytics, ANALYTICS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [loadRegionAnalytics]);

  // Poll the global factor window on the normal cadence.
  useEffect(() => {
    let active = true;
    const pollFactors = async () => {
      try {
        const res = await fetch("/api/dynamic-factors");
        if (res.ok) {
          const data = await res.json();
          const meta = readMeta(data);
          if (!active) return;
          if (meta) setGlobalFactorsMeta(meta);
          // Server fallbacks are static reference text, not curation. They are
          // only accepted when the API confirms a successful AI run; otherwise
          // the hand-authored client FACTORS stay on screen.
          const factors = (data as { factors?: Factor[] }).factors;
          if (meta && isLiveCuration(meta) && Array.isArray(factors) && factors.length > 0) {
            setGlobalFactors(factors);
          }
        }
      } catch { /* ignore */ }
    };
    pollFactors();
    const id = setInterval(pollFactors, FACTORS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Poll the factor window of every region the user has opened — sequentially,
  // so the 15s pipelines never overlap each other or the global one.
  useEffect(() => {
    let active = true;
    const pollRegionalFactors = async () => {
      for (const r of activeRegionsRef.current) {
        if (!active) return;
        await loadRegionFactors(r);
      }
    };
    const id = setInterval(pollRegionalFactors, FACTORS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [loadRegionFactors]);

  /* ------------------------------------------------------------------ */
  /* Solutions — active scope only, forced only on a real reason change  */
  /* ------------------------------------------------------------------ */

  const solutionsAbortRef = useRef<AbortController | null>(null);

  const requestSolutions = useCallback(async (target: RegionId, force: boolean) => {
    solutionsAbortRef.current?.abort();
    const controller = new AbortController();
    solutionsAbortRef.current = controller;
    try {
      const qs = force ? "?force=true" : "";
      const res = await fetch(`/api/solutions?region=${target}${qs}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { solutions?: Solution[] };
      if (controller.signal.aborted || !Array.isArray(data.solutions)) return;
      setSolutions(data.solutions);
      setSolutionsMeta(readMeta(data));
    } catch {
      /* keep the last good set of solutions */
    } finally {
      if (solutionsAbortRef.current === controller) solutionsAbortRef.current = null;
    }
  }, []);

  // Backstop poll for solutions (also covers the very first paint). It always
  // targets the active scope, so no request is ever made for a scope the user
  // is not looking at.
  useEffect(() => {
    void requestSolutions(scope, false);
    const id = setInterval(() => void requestSolutions(scopeRef.current, false), SOLUTIONS_POLL_MS);
    return () => {
      clearInterval(id);
      solutionsAbortRef.current?.abort();
      solutionsAbortRef.current = null;
    };
  }, [requestSolutions, scope]);

  /**
   * Reason signatures that already triggered a real-time regeneration. Keyed by
   * the full signature (scope included), so returning to a region the user has
   * already seen does not re-run a pipeline for reasons the displayed
   * solutions were already generated from.
   */
  const forcedSignaturesRef = useRef<Set<string>>(new Set());
  const forcedRunningRef = useRef(false);
  /** Signature that arrived while a forced run was still on the wire. */
  const queuedSignatureRef = useRef<string | null>(null);
  const runForcedRef = useRef<(signature: string) => void>(() => {});

  const runForcedRefresh = useCallback(
    (signature: string) => {
      forcedSignaturesRef.current.add(signature);
      // A forced run is a full pipeline the server keeps to completion even
      // when the client aborts it, so never start a second one while the first
      // is live: remember the newest reason set and run once, afterwards.
      if (forcedRunningRef.current) {
        queuedSignatureRef.current = signature;
        return;
      }
      forcedRunningRef.current = true;
      void requestSolutions(scopeRef.current, true).finally(() => {
        forcedRunningRef.current = false;
        const queued = queuedSignatureRef.current;
        queuedSignatureRef.current = null;
        if (queued) runForcedRef.current(queued);
      });
    },
    [requestSolutions],
  );

  useEffect(() => {
    runForcedRef.current = runForcedRefresh;
  }, [runForcedRefresh]);

  /**
   * Real-time regeneration: whenever the reason set for the active scope
   * genuinely changes, immediately re-ask the API for solutions that match the
   * new reasons (force=true bypasses the server cache). Runs only against a
   * live-curated window — a degraded payload has no new reasons to react to.
   */
  useEffect(() => {
    if (!scopeLiveCurated) return;
    if (forcedSignaturesRef.current.has(factorSignature)) return;
    runForcedRefresh(factorSignature);
  }, [factorSignature, scopeLiveCurated, runForcedRefresh]);

  return (
    <div className="min-h-screen bg-base font-sans text-slate-200 antialiased">
      <Navbar />
      <main>
        <Hero prices={prices} deltas={deltas} />
        <MarketIndexStrip scope={scope} analytics={scopeAnalytics} />
        <ForecastTool
          horizon={horizon}
          onHorizon={setHorizon}
          prices={prices}
          points={points}
          lastUpdated={lastUpdated}
          onRefresh={refresh}
          onFetchWater={handleFetchWater}
          waterFetching={waterFetching}
          waterLive={waterLive}
          isLive={isLive}
          streaming={streaming}
          onToggleLive={toggleLive}
          region={region}
          onRegion={setRegion}
        />
        <SolutionsSection
          fallbackFactors={scopeFactors}
          healthStatus={healthStatus}
          solutions={solutions}
          meta={solutionsMeta ?? undefined}
        />
        <FactorsSection
          horizon={horizon}
          dynamicFactors={globalFactors}
          healthStatus={healthStatus}
          meta={globalFactorsMeta ?? undefined}
        />
        <RegionalEvaluation
          prices={prices}
          horizon={horizon}
          jitter={jitter}
          region={region}
          onRegion={setRegion}
          dynamicFactors={regionalFactors}
          factorsMeta={regionalFactorsMeta}
          loadingRegion={loadingRegions[region] === true ? region : null}
        />
        <AboutSection />
      </main>
      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}
