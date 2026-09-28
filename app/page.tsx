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
const REGION_STAGGER_MS = 8_000;

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

  const points = useMemo(
    () => generateForecast(prices, horizon, jitter, region),
    [prices, horizon, jitter, region],
  );

  const handleFetchWater = useCallback(() => void fetchWater(), [fetchWater]);

  /** "global" is already a valid scope id for every /api route. */
  const scope: RegionId = region;

  /** Reasons currently driving the active scope — the input to the solutions. */
  const scopeFactors = useMemo(
    () => (scope === "global" ? globalFactors : (regionalFactors[scope] ?? [])),
    [scope, globalFactors, regionalFactors],
  );

  const scopeAnalytics = analytics[scope];

  /**
   * Identity of the reason set. Changes whenever a reason is added, dropped
   * or re-curated, which is what drives the real-time solution regeneration.
   */
  const factorSignature = useMemo(
    () => `${scope}:${scopeFactors.map((f) => `${f.id}@${f.updatedAt}`).join("|")}`,
    [scope, scopeFactors],
  );

  // Seed the hand-authored regional reference factors. They stay in place
  // until the API confirms a genuinely AI-curated window for that region.
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

  // Poll analytics (global + regional) — surfaced by the market index strip
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
      for (const r of EVAL_REGIONS) {
        try {
          const res = await fetch(`/api/regional-analytics?region=${r.id}`);
          if (res.ok) {
            const data = (await res.json()) as AnalyticsSnapshot;
            if (active) setAnalytics((prev) => ({ ...prev, [r.id]: data }));
          }
        } catch { /* ignore */ }
        await new Promise((resolve) => setTimeout(resolve, REGION_STAGGER_MS));
      }
    };
    pollAnalytics();
    const id = setInterval(pollAnalytics, ANALYTICS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Poll dynamic factors (global + regional)
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
      for (const r of EVAL_REGIONS) {
        try {
          const res = await fetch(`/api/regional-factors?region=${r.id}`);
          if (res.ok) {
            const data = await res.json();
            const meta = readMeta(data);
            if (!active) return;
            if (meta) {
              setRegionalFactorsMeta((prev) => ({ ...prev, [r.id]: meta }));
            }
            // Keep the hand-authored regional copy when the server is
            // degraded — static server text must not beat better local copy.
            const factors = (data as { factors?: Factor[] }).factors;
            if (meta && isLiveCuration(meta) && Array.isArray(factors) && factors.length > 0) {
              setRegionalFactors((prev) => ({ ...prev, [r.id]: factors }));
            }
          }
        } catch { /* ignore */ }
        await new Promise((resolve) => setTimeout(resolve, REGION_STAGGER_MS));
      }
    };
    pollFactors();
    const id = setInterval(pollFactors, FACTORS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  /**
   * Solutions fetch. A new request cancels the one still in flight so a burst
   * of factor updates can never stack up stale responses.
   */
  const solutionsAbortRef = useRef<AbortController | null>(null);

  const fetchSolutions = useCallback(
    async (force: boolean) => {
      solutionsAbortRef.current?.abort();
      const controller = new AbortController();
      solutionsAbortRef.current = controller;
      try {
        const qs = force ? "?force=true" : "";
        const res = await fetch(`/api/solutions?region=${scope}${qs}`, {
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
    },
    [scope],
  );

  // Backstop poll for solutions (also covers the very first paint)
  useEffect(() => {
    void fetchSolutions(false);
    const id = setInterval(() => void fetchSolutions(false), SOLUTIONS_POLL_MS);
    return () => {
      clearInterval(id);
      solutionsAbortRef.current?.abort();
      solutionsAbortRef.current = null;
    };
  }, [fetchSolutions]);

  /**
   * Real-time regeneration: whenever the reason set for the active scope
   * changes identity, immediately re-ask the API for solutions that match the
   * new reasons (force=true bypasses the server cache). The ref holds the last
   * signature so repeated renders — and the factor polls that re-deliver the
   * same reasons — never trigger another regeneration.
   */
  const lastFactorSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (scopeFactors.length === 0) return;
    if (lastFactorSignatureRef.current === factorSignature) return;
    lastFactorSignatureRef.current = factorSignature;
    void fetchSolutions(true);
  }, [factorSignature, scopeFactors.length, fetchSolutions]);

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
        />
        <AboutSection />
      </main>
      <Footer lastUpdated={lastUpdated} />
    </div>
  );
}
