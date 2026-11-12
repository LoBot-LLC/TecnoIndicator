import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMODITIES,
  type CommodityId,
  type FetchingByCommodity,
  type LivePricesResponse,
  type LiveQuotes,
} from "../lib/model";

function getDefaultPrices(): Record<CommodityId, number> {
  return Object.fromEntries(COMMODITIES.map((c) => [c.id, c.base])) as Record<CommodityId, number>;
}

function defaultLiveQuotes(): LiveQuotes {
  return Object.fromEntries(COMMODITIES.map((c) => [c.id, null])) as unknown as LiveQuotes;
}

function defaultFetching(): FetchingByCommodity {
  return Object.fromEntries(COMMODITIES.map((c) => [c.id, false])) as unknown as FetchingByCommodity;
}

export interface UseLiveMarketReturn {
  prices: Record<CommodityId, number>;
  deltas: Record<CommodityId, number>;
  jitter: number;
  lastUpdated: Date;
  liveQuotes: LiveQuotes;
  fetchingByCommodity: FetchingByCommodity;
  isLive: boolean;
  streaming: boolean;
  refresh: () => void;
  fetchCommodity: (commodity: CommodityId) => Promise<void>;
  toggleLive: () => void;
}

export function useLiveMarket(): UseLiveMarketReturn {
  const [prices, setPrices] = useState<Record<CommodityId, number>>(getDefaultPrices);
  const [deltas, setDeltas] = useState<Record<CommodityId, number>>({ oil: 0, electricity: 0, water: 0 });
  const [jitter, setJitter] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [liveQuotes, setLiveQuotes] = useState<LiveQuotes>(defaultLiveQuotes);
  const [fetchingByCommodity, setFetchingByCommodity] =
    useState<FetchingByCommodity>(defaultFetching);
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
        electricity:
          (newPrices.electricity - prevPricesRef.current.electricity) /
          prevPricesRef.current.electricity,
        water: (newPrices.water - prevPricesRef.current.water) /
          prevPricesRef.current.water,
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

  // Fetch live prices with force=true and surface a per-commodity quote.
  // Fetches the full payload so every displayed number reflects the latest
  // information; only the requested commodity's quote badge is updated.
  const fetchCommodity = useCallback(
    async (commodity: CommodityId) => {
      setFetchingByCommodity((prev) => ({ ...prev, [commodity]: true }));
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
          electricity:
            (newPrices.electricity - prevPricesRef.current.electricity) /
            prevPricesRef.current.electricity,
          water: (newPrices.water - prevPricesRef.current.water) /
            prevPricesRef.current.water,
        });
        prevPricesRef.current = newPrices;
        setPrices(newPrices);
        const commodityData = data[commodity];
        setLiveQuotes((prev) => ({
          ...prev,
          [commodity]: {
            price: commodityData.price,
            asOf: new Date(data.asOf).toLocaleTimeString("en-GB", { hour12: false }),
            source: commodityData.source || data.dataSource,
            range: commodityData.isLive ? "Live feed" : "Static benchmark",
          },
        }));
        setIsLive(data.isLive);
        setLastUpdated(new Date(data.asOf));
      } catch {
        setLiveQuotes((prev) => ({ ...prev, [commodity]: null }));
      } finally {
        setFetchingByCommodity((prev) => ({ ...prev, [commodity]: false }));
      }
    },
    [],
  );

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
    // Initial live quotes for backward compatibility
    void Promise.all(COMMODITIES.map((c) => fetchCommodity(c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    prices,
    deltas,
    jitter,
    lastUpdated,
    liveQuotes,
    fetchingByCommodity,
    isLive,
    streaming,
    refresh,
    fetchCommodity,
    toggleLive,
  };
}