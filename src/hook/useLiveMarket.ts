import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMODITIES,
  type CommodityId,
  type LivePricesResponse,
  type LiveWaterQuote,
} from "../lib/model";

function getDefaultPrices(): Record<CommodityId, number> {
  return Object.fromEntries(COMMODITIES.map((c) => [c.id, c.base])) as Record<CommodityId, number>;
}

export interface UseLiveMarketReturn {
  prices: Record<CommodityId, number>;
  deltas: Record<CommodityId, number>;
  jitter: number;
  lastUpdated: Date;
  waterLive: LiveWaterQuote | null;
  waterFetching: boolean;
  isLive: boolean;
  streaming: boolean;
  refresh: () => void;
  fetchWater: () => Promise<void>;
  toggleLive: () => void;
}

export function useLiveMarket(): UseLiveMarketReturn {
  const [prices, setPrices] = useState<Record<CommodityId, number>>(getDefaultPrices);
  const [deltas, setDeltas] = useState<Record<CommodityId, number>>({ oil: 0, electricity: 0, water: 0 });
  const [jitter, setJitter] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [waterLive, setWaterLive] = useState<LiveWaterQuote | null>(null);
  const [waterFetching, setWaterFetching] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const tickRef = useRef<number | null>(null);
  const prevPricesRef = useRef<Record<CommodityId, number>>(getDefaultPrices());

  // Fetch prices from API
  const fetchPrices = useCallback(async (force = false) => {
    try {
      const url = force ? "/api/prices?force=true" : "/api/prices";
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LivePricesResponse;
      const newPrices = {
        oil: data.oil.price,
        electricity: data.electricity.price,
        water: data.water.price,
      };
      // Compute real deltas from previous prices
      setDeltas({
        oil: (newPrices.oil - prevPricesRef.current.oil) / prevPricesRef.current.oil,
        electricity: (newPrices.electricity - prevPricesRef.current.electricity) / prevPricesRef.current.electricity,
        water: (newPrices.water - prevPricesRef.current.water) / prevPricesRef.current.water,
      });
      prevPricesRef.current = newPrices;
      setPrices(newPrices);
      setIsLive(data.isLive);
      setLastUpdated(new Date(data.asOf));
    } catch {
      setPrices(getDefaultPrices());
      setIsLive(false);
    }
  }, []);

  // Manual refresh - fetches with force=true
  const refresh = useCallback(() => {
    void fetchPrices(true);
  }, [fetchPrices]);

  // Fetch live water price from the API with force=true
  const fetchWater = useCallback(async () => {
    setWaterFetching(true);
    try {
      const res = await fetch("/api/prices?force=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as LivePricesResponse;
      const newPrices = {
        oil: data.oil.price,
        electricity: data.electricity.price,
        water: data.water.price,
      };
      // Compute real deltas from previous prices
      setDeltas({
        oil: (newPrices.oil - prevPricesRef.current.oil) / prevPricesRef.current.oil,
        electricity: (newPrices.electricity - prevPricesRef.current.electricity) / prevPricesRef.current.electricity,
        water: (newPrices.water - prevPricesRef.current.water) / prevPricesRef.current.water,
      });
      prevPricesRef.current = newPrices;
      setPrices(newPrices);
      setWaterLive({
        price: data.water.price,
        asOf: new Date(data.asOf).toLocaleTimeString("en-GB", { hour12: false }),
        source: data.water.source || data.dataSource,
        range: data.water.isLive ? "Live feed" : "Static benchmark",
      });
      setIsLive(data.isLive);
      setLastUpdated(new Date(data.asOf));
    } catch {
      setWaterLive(null);
    } finally {
      setWaterFetching(false);
    }
  }, []);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => !prev);
  }, []);

  // Poll /api/prices every 60s when isLive is true
  useEffect(() => {
    const clear = () => {
      if (tickRef.current !== null) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };

    const start = () => {
      clear();
      if (!isLive || document.hidden) {
        setStreaming(false);
        return;
      }
      setStreaming(true);
      tickRef.current = window.setInterval(() => {
        void fetchPrices();
        // Keep jitter for forecast model compatibility
        setJitter((j) => j + 0.01);
      }, 60_000);
    };

    start();

    const onVisibility = () => {
      if (document.hidden) {
        clear();
        setStreaming(false);
      } else if (isLive) {
        start();
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isLive, fetchPrices]);

  // Initial fetch
  useEffect(() => {
    void fetchPrices();
    // Initial water fetch for backward compatibility
    void fetchWater();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
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
  };
}