import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMODITIES,
  type CommodityId,
  type LiveCommodityQuote,
  type LiveElectricityQuote,
  type LiveOilQuote,
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
  oilLive: LiveOilQuote | null;
  electricityLive: LiveElectricityQuote | null;
  waterLive: LiveWaterQuote | null;
  oilFetching: boolean;
  electricityFetching: boolean;
  waterFetching: boolean;
  isLive: boolean;
  streaming: boolean;
  refresh: () => void;
  fetchOil: () => Promise<void>;
  fetchElectricity: () => Promise<void>;
  fetchWater: () => Promise<void>;
  toggleLive: () => void;
}

export function useLiveMarket(): UseLiveMarketReturn {
  const [prices, setPrices] = useState<Record<CommodityId, number>>(getDefaultPrices);
  const [deltas, setDeltas] = useState<Record<CommodityId, number>>({ oil: 0, electricity: 0, water: 0 });
  const [jitter, setJitter] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [liveQuotes, setLiveQuotes] = useState<Partial<Record<CommodityId, LiveCommodityQuote | null>>>({});
  const [fetching, setFetching] = useState<Partial<Record<CommodityId, boolean>>>({});
  const [isLive, setIsLive] = useState(true);
  const [streaming, setStreaming] = useState(true);
  const tickRef = useRef<number | null>(null);
  const prevPricesRef = useRef<Record<CommodityId, number>>(getDefaultPrices());

  const setFetchingStatus = useCallback((commodity: CommodityId, value: boolean) => {
    setFetching((prev) => ({ ...prev, [commodity]: value }));
  }, []);

  const setLiveQuote = useCallback((commodity: CommodityId, quote: LiveCommodityQuote | null) => {
    setLiveQuotes((prev) => ({ ...prev, [commodity]: quote }));
  }, []);

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
      const computeDelta = (newPrice: number, prevPrice: number) => 
        prevPrice === 0 ? 0 : (newPrice - prevPrice) / prevPrice;

      setDeltas({
        oil: computeDelta(newPrices.oil, prevPricesRef.current.oil),
        electricity: computeDelta(newPrices.electricity, prevPricesRef.current.electricity),
        water: computeDelta(newPrices.water, prevPricesRef.current.water),
      });
      prevPricesRef.current = newPrices;
      setPrices(newPrices);
      const quotes: Partial<Record<CommodityId, LiveCommodityQuote>> = {};
      for (const c of COMMODITIES) {
        const d = data[c.id];
        quotes[c.id] = {
          price: d.price,
          asOf: new Date(data.asOf).toLocaleTimeString("en-GB", { hour12: false }),
          source: d.source || data.dataSource,
          range: d.isLive ? "Live feed" : "Static benchmark",
        };
      }
      setLiveQuotes(quotes);
      setIsLive(data.isLive);
      setLastUpdated(new Date(data.asOf));
    } catch {
      setPrices(getDefaultPrices());
      setIsLive(false);
    }
  }, []);

  const refresh = useCallback(() => {
    void fetchPrices(true);
  }, [fetchPrices]);

  const fetchCommodityLive = useCallback(async (commodity: CommodityId) => {
    setFetchingStatus(commodity, true);
    try {
      await fetchPrices(true);
    } catch {
      setLiveQuote(commodity, null);
    } finally {
      setFetchingStatus(commodity, false);
    }
  }, [fetchPrices, setFetchingStatus, setLiveQuote]);

  const fetchWater = useCallback(() => fetchCommodityLive("water"), [fetchCommodityLive]);
  const fetchOil = useCallback(() => fetchCommodityLive("oil"), [fetchCommodityLive]);
  const fetchElectricity = useCallback(() => fetchCommodityLive("electricity"), [fetchCommodityLive]);

  const toggleLive = useCallback(() => {
    setIsLive((prev) => !prev);
  }, []);

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

  useEffect(() => {
    void fetchPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const oilLive = liveQuotes.oil as LiveOilQuote | null;
  const electricityLive = liveQuotes.electricity as LiveElectricityQuote | null;
  const waterLive = liveQuotes.water as LiveWaterQuote | null;
  const oilFetching = fetching.oil ?? false;
  const electricityFetching = fetching.electricity ?? false;
  const waterFetching = fetching.water ?? false;

  return {
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
    fetchOil,
    fetchElectricity,
    fetchWater,
    toggleLive,
  };
}
