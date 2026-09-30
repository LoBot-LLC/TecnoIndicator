"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { CURRENCIES, type CurrencyInfo, getCurrencyInfo, DEFAULT_CURRENCY } from "./currencies";

interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  lastUpdated: Date;
}

interface CurrencyContextType {
  selectedCurrency: string;
  setSelectedCurrency: (code: string) => void;
  exchangeRates: ExchangeRates | null;
  isLoadingRates: boolean;
  error: string | null;
  convertPrice: (usdPrice: number, targetCurrency: string) => number;
  formatPrice: (usdPrice: number, targetCurrency: string) => string;
  getCurrencyInfo: (code: string) => CurrencyInfo;
  currencies: CurrencyInfo[];
}

// Fetch exchange rates from a free API (Frankfurter API)
async function fetchExchangeRates(base: string = "USD"): Promise<Record<string, number>> {
  try {
    // Frankfurter API provides free historical and current exchange rates
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${base}&to=EUR,GBP,JPY,CAD,AUD,CHF,CNY,INR,SAR,AED,SEK,NOK,DKK,NZD,PLN,MXN,BRL,ARS,COP,CLP,ZAR`
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data.rates || {};
  } catch (error) {
    console.error("Error fetching exchange rates:", error);
    // Return empty object on error
    return {};
  }
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

interface CurrencyProviderProps {
  children: React.ReactNode;
}

export function CurrencyProvider({ children }: CurrencyProviderProps) {
  const [selectedCurrency, setSelectedCurrency] = useState<string>(() => {
    // Load from localStorage if available
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("selectedCurrency");
      return stored || DEFAULT_CURRENCY;
    }
    return DEFAULT_CURRENCY;
  });

  const [exchangeRates, setExchangeRates] = useState<ExchangeRates | null>(null);
  const [isLoadingRates, setIsLoadingRates] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch exchange rates on mount and every hour
  useEffect(() => {
    const fetchRates = async () => {
      try {
        setIsLoadingRates(true);
        setError(null);
        const rates = await fetchExchangeRates(DEFAULT_CURRENCY);
        
        // Ensure all major currencies are present
        const targetCurrencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "SAR", "AED", "SEK", "NOK", "DKK", "NZD", "PLN", "MXN", "BRL", "ARS", "COP", "CLP", "ZAR"];
        const completeRates: Record<string, number> = {};
        
        // Set USD as base (always 1.0)
        completeRates.USD = 1.0;
        
        // Add fetched rates or default to 1.0 for major currencies
        for (const code of targetCurrencies) {
          if (code === "USD") continue;
          completeRates[code] = rates[code] || 1.0;
        }
        
        setExchangeRates({
          base: DEFAULT_CURRENCY,
          rates: completeRates,
          lastUpdated: new Date(),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch exchange rates");
      } finally {
        setIsLoadingRates(false);
      }
    };

    fetchRates();
    
    // Refresh rates every hour
    const interval = setInterval(fetchRates, 60 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, []);

  const convertPrice = (usdPrice: number, targetCurrency: string): number => {
    if (!exchangeRates || targetCurrency === DEFAULT_CURRENCY) {
      return usdPrice;
    }
    
    const rate = exchangeRates.rates[targetCurrency];
    if (!rate) {
      return usdPrice;
    }
    
    return usdPrice * rate;
  };

  const formatPrice = (usdPrice: number, targetCurrency: string): string => {
    const convertedPrice = convertPrice(usdPrice, targetCurrency);
    const currency = getCurrencyInfo(targetCurrency);
    const decimals = currency.decimals;
    
    return convertedPrice.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const getCurrencyInfoLocal = (code: string): CurrencyInfo => {
    return getCurrencyInfo(code);
  };

  const handleCurrencyChange = (code: string) => {
    setSelectedCurrency(code);
    if (typeof window !== "undefined") {
      localStorage.setItem("selectedCurrency", code);
    }
    
    // Reload page to apply currency changes globally
    // This is a simple approach - in a real app you might want to
    // use state management that updates all components without reload
    window.location.reload();
  };

  const value: CurrencyContextType = {
    selectedCurrency,
    setSelectedCurrency: handleCurrencyChange,
    exchangeRates,
    isLoadingRates,
    error,
    convertPrice,
    formatPrice,
    getCurrencyInfo: getCurrencyInfoLocal,
    currencies: CURRENCIES,
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}

export { CURRENCIES, DEFAULT_CURRENCY };