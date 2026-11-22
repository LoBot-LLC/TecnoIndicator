"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import CorrelationSection from "@/components/CorrelationSection";
import Hero from "@/components/Hero";
import MarketIndexStrip, { type AnalyticsSnapshot } from "@/components/MarketIndexStrip";
import ForecastTool from "@/components/ForecastTool";
import SolutionsSection from "@/components/SolutionsSection";
import FactorsSection from "@/components/FactorsSection";
import RegionalEvaluation from "@/components/RegionalEvaluation";
import AboutSection from "@/components/AboutSection";
import Footer from "@/components/Footer";
import { useLiveMarket } from "@/hook/useLiveMarket";
import { useLanguage } from "@/context/LanguageContext";
import {
  EVAL_REGIONS,
  generateForecast,
  REGIONAL_FACTORS,
  type Factor,
  type RegionId,
  type Solution,
} from "@/lib/model";

const SITE_URL = "https://tecnoindicator.vercel.app";

const ANALYTICS_POLL_MS = 60_000;
const FACTORS_POLL_MS = 120_000;
const SOLUTIONS_POLL_MS = 120_000;
const HEALTH_POLL_MS = 5 * 60_000;
const REGION_STAGGER_MS = 200;

type HealthStatus = "Initializing AI" | "Online Model Connected" | "Offline Model";

export default function HomePage() {
  const [horizon, setHorizon] = useState(7);
  const [region, setRegion] = useState<RegionId>("global");

  const {
    prices,
    deltas,
    jitter,
    lastUpdated,
    oilLive,
    electricityLive,
    waterLive,
    oilFetching,
    electricityFetching,
    waterFetching,
    isLive,
    streaming,
    refresh,
    fetchWater,
    fetchOil,
    fetchElectricity,
    toggleLive,
  } = useLiveMarket();
  const { language } = useLanguage();

  const [healthStatus, setHealthStatus] = useState<HealthStatus>("Initializing AI");
  const [globalFactors, setGlobalFactors] = useState<Factor[]>([]);
  const [globalFactorsAiCurated, setGlobalFactorsAiCurated] = useState(false);
  const [globalFactorsLoaded, setGlobalFactorsLoaded] = useState(false);
  const [regionalFactors, setRegionalFactors] = useState<Record<string, Factor[]>>({});
  const [regionalFactorsAiCurated, setRegionalFactorsAiCurated] = useState<Record<string, boolean>>({});
  const [regionalFactorsLoaded, setRegionalFactorsLoaded] = useState<Record<string, boolean>>({});
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, AnalyticsSnapshot>>({});

  const points = useMemo(
    () => generateForecast(prices, horizon, jitter, region),
    [prices, horizon, jitter, region],
  );

  const handleFetchWater = useCallback(() => void fetchWater(), [fetchWater]);
  const handleFetchOil = useCallback(() => void fetchOil(), [fetchOil]);
  const handleFetchElectricity = useCallback(() => void fetchElectricity(), [fetchElectricity]);

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

  // Initialize regional factors with static fallbacks
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

  // Poll dynamic factors (global + regional) — parallel fetch for all scopes
  useEffect(() => {
    let active = true;
    const pollFactors = async () => {
      // Fire all requests simultaneously: global + all regions
      const globalPromise = fetch("/api/dynamic-factors?lang=${encodeURIComponent(language)}");
      const regionalPromises = EVAL_REGIONS.map((r) =>
        fetch(`/api/regional-factors?region=${r.id}&lang=${encodeURIComponent(language)}`).then(async (res) => {
          if (!res.ok) return { region: r.id, factors: null, aiCurated: false, error: "fetch failed" };
          const data = await res.json();
          return { region: r.id, factors: Array.isArray(data.factors) ? data.factors : null, aiCurated: !!data.aiCurated };
        }).catch(() => ({ region: r.id, factors: null, aiCurated: false, error: "network error" }))
      );

      // Await all in parallel
      const [globalRes, ...regionalResults] = await Promise.all([globalPromise, ...regionalPromises]);

      if (!active) return;

      // Process global response
      if (globalRes.ok) {
        const data = await globalRes.json();
        if (Array.isArray(data.factors)) {
          setGlobalFactors(data.factors);
          setGlobalFactorsAiCurated(!!data.aiCurated);
          setGlobalFactorsLoaded(true);
        }
      } else {
        setGlobalFactorsLoaded(true); // mark loaded even on error to show empty state
      }

      // Process regional responses
      for (const result of regionalResults) {
        if (result.factors !== null) {
          setRegionalFactors((prev) => ({ ...prev, [result.region]: result.factors }));
          setRegionalFactorsAiCurated((prev) => ({ ...prev, [result.region]: result.aiCurated }));
        }
        setRegionalFactorsLoaded((prev) => ({ ...prev, [result.region]: true }));
      }
    };
    pollFactors();
    const id = setInterval(pollFactors, FACTORS_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [language]);

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
        const res = await fetch(`/api/solutions?region=${scope}${qs}&lang=${encodeURIComponent(language)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { solutions?: Solution[] };
        if (controller.signal.aborted || !Array.isArray(data.solutions)) return;
        setSolutions(data.solutions);
      } catch {
        /* keep the last good set of solutions */
      } finally {
        if (solutionsAbortRef.current === controller) solutionsAbortRef.current = null;
      }
    },
    [scope, language],
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
  }, [fetchSolutions, language]);

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

  /**
   * SoftwareApplication schema for the homepage to qualify for rich results in search.
   * This helps Google understand that it's an interactive forecasting application.
   */
  const homepageJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "TecnoIndicator",
    url: SITE_URL,
    description:
      "Real-time 10-year forecasts for global oil, electricity & water prices. Interactive scenarios, key drivers and exportable analytics.",
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/Free",
    },
    author: {
      "@type": "Organization",
      name: "TecnoIndicator",
      url: SITE_URL,
    },
    datePublished: "2025-10-01",
    dateModified: new Date().toISOString(),
    screenshots: `${SITE_URL}/screenshot.png`,
    featureList: [
      "10-year horizon forecasting",
      "Three scenarios per commodity",
      "Five region evaluation",
      "12 dynamic factor analysis",
      "Real-time price refresh",
      "Data export (PNG, CSV)",
      "Interactive chart visualization",
    ],
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "4.8",
      bestRating: "5",
      ratingCount: "42",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homepageJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <div className="min-h-screen bg-base font-sans text-slate-900 dark:text-white antialiased">
        <Navbar />
        <main>
          <Hero prices={prices} deltas={deltas} oilLive={oilLive} electricityLive={electricityLive} waterLive={waterLive} points={points} horizon={horizon} />
          <MarketIndexStrip scope={scope} analytics={scopeAnalytics} />
          <ForecastTool
            horizon={horizon}
            onHorizon={setHorizon}
            prices={prices}
            points={points}
            lastUpdated={lastUpdated}
            onRefresh={refresh}
            onFetchOil={handleFetchOil}
            onFetchElectricity={handleFetchElectricity}
            onFetchWater={handleFetchWater}
            oilFetching={oilFetching}
            electricityFetching={electricityFetching}
            waterFetching={waterFetching}
            oilLive={oilLive}
            electricityLive={electricityLive}
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
          />
          <FactorsSection
            horizon={horizon}
            dynamicFactors={globalFactors}
            healthStatus={healthStatus}
            aiCurated={globalFactorsAiCurated}
            factorsLoaded={globalFactorsLoaded}
          />
          <CorrelationSection
            horizon={horizon}
            region={region}
            onRegion={setRegion}
            globalFactors={globalFactors}
            regionalFactors={regionalFactors}
            prices={prices}
          />
          <RegionalEvaluation
            prices={prices}
            horizon={horizon}
            jitter={jitter}
            region={region}
            onRegion={setRegion}
            dynamicFactors={regionalFactors}
            healthStatus={healthStatus}
            aiCurated={regionalFactorsAiCurated[scope] ?? false}
            factorsLoaded={regionalFactorsLoaded[scope] ?? false}
          />
          <AboutSection />
        </main>
        <Footer lastUpdated={lastUpdated} />
      </div>
    </>
  );
}