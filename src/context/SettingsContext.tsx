"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY_FONT = "tecno.font";
const STORAGE_KEY_LENGTH = "tecno.lengthUnit";
const STORAGE_KEY_ENERGY = "tecno.energyUnit";

export type LengthUnit = "meter" | "feet";
export type EnergyUnit = "MWh" | "kWh" | "joule";

export interface FontOption {
  value: string;
  label: string;
}

export interface SettingsContextValue {
  fontFamily: string;
  setFontFamily: (family: string) => void;
  lengthUnit: LengthUnit;
  setLengthUnit: (unit: LengthUnit) => void;
  energyUnit: EnergyUnit;
  setEnergyUnit: (unit: EnergyUnit) => void;
  /** Convert a price expressed per cubic meter into the selected length/volume unit. */
  convertLengthVolume: (valuePerCubicMeter: number) => number;
  /** Convert a price expressed per MWh into the selected energy unit. */
  convertEnergy: (valuePerMWh: number) => number;
  energyUnitLabel: () => string;
  lengthUnitLabel: () => string;
}

/** Curated font families (sourced from GlobalFonts.pro / Google Fonts). */
export const FONT_OPTIONS: FontOption[] = [
  { value: "Inter", label: "Inter" },
  { value: "Space Grotesk", label: "Space Grotesk" },
  { value: "Roboto", label: "Roboto" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Lato", label: "Lato" },
  { value: "Montserrat", label: "Montserrat" },
  { value: "Poppins", label: "Poppins" },
  { value: "Oswald", label: "Oswald" },
  { value: "Raleway", label: "Raleway" },
  { value: "Source Sans Pro", label: "Source Sans Pro" },
  { value: "PT Sans", label: "PT Sans" },
  { value: "Ubuntu", label: "Ubuntu" },
  { value: "JetBrains Mono", label: "JetBrains Mono" },
  { value: "Fira Code", label: "Fira Code" },
];

export const DEFAULT_FONT = "Inter";

/** 1 cubic meter = 35.3147 cubic feet. */
const CUBIC_METER_TO_CUBIC_FOOT = 35.3147;
/** 1 MWh = 1,000 kWh = 3.6e9 joules. */
const MWH_TO_KWH = 1000;
const MWH_TO_JOULE = 3.6e9;

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [fontFamily, setFontFamilyState] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY_FONT);
      if (stored) return stored;
    }
    return DEFAULT_FONT;
  });

  const [lengthUnit, setLengthUnitState] = useState<LengthUnit>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY_LENGTH);
      if (stored === "meter" || stored === "feet") return stored;
    }
    return "meter";
  });

  const [energyUnit, setEnergyUnitState] = useState<EnergyUnit>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem(STORAGE_KEY_ENERGY);
      if (stored === "MWh" || stored === "kWh" || stored === "joule") return stored;
    }
    return "MWh";
  });

  // Apply the chosen font to the document and load it from Google Fonts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.setProperty("--font-body", fontFamily);
    document.body.style.fontFamily = fontFamily;
    loadGoogleFont(fontFamily);
    try {
      window.localStorage.setItem(STORAGE_KEY_FONT, fontFamily);
    } catch {
      /* ignore storage errors */
    }
  }, [fontFamily]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_LENGTH, lengthUnit);
    } catch {
      /* ignore */
    }
  }, [lengthUnit]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY_ENERGY, energyUnit);
    } catch {
      /* ignore */
    }
  }, [energyUnit]);

  const setFontFamily = useCallback((family: string) => setFontFamilyState(family), []);
  const setLengthUnit = useCallback((unit: LengthUnit) => setLengthUnitState(unit), []);
  const setEnergyUnit = useCallback((unit: EnergyUnit) => setEnergyUnitState(unit), []);

  const convertLengthVolume = useCallback(
    (valuePerCubicMeter: number) => {
      if (!Number.isFinite(valuePerCubicMeter)) return valuePerCubicMeter;
      if (lengthUnit === "feet") return valuePerCubicMeter / CUBIC_METER_TO_CUBIC_FOOT;
      return valuePerCubicMeter;
    },
    [lengthUnit],
  );

  const convertEnergy = useCallback(
    (valuePerMWh: number) => {
      if (!Number.isFinite(valuePerMWh)) return valuePerMWh;
      if (energyUnit === "kWh") return valuePerMWh / MWH_TO_KWH;
      if (energyUnit === "joule") return valuePerMWh / MWH_TO_JOULE;
      return valuePerMWh;
    },
    [energyUnit],
  );

  const energyUnitLabel = useCallback(() => {
    if (energyUnit === "kWh") return "kWh";
    if (energyUnit === "joule") return "J";
    return "MWh";
  }, [energyUnit]);

  const lengthUnitLabel = useCallback(() => {
    if (lengthUnit === "feet") return "ft³";
    return "m³";
  }, [lengthUnit]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      fontFamily,
      setFontFamily,
      lengthUnit,
      setLengthUnit,
      energyUnit,
      setEnergyUnit,
      convertLengthVolume,
      convertEnergy,
      energyUnitLabel,
      lengthUnitLabel,
    }),
    [
      fontFamily,
      setFontFamily,
      lengthUnit,
      setLengthUnit,
      energyUnit,
      setEnergyUnit,
      convertLengthVolume,
      convertEnergy,
      energyUnitLabel,
      lengthUnitLabel,
    ],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
}

/** Google Fonts loader — injects a stylesheet link per selected family (cached). */
let loadedFonts = new Set<string>();
function loadGoogleFont(family: string) {
  if (loadedFonts.has(family)) return;
  if (typeof window === "undefined") return;
  const encoded = encodeURIComponent(family);
  const href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`;
  if (document.querySelector(`link[href="${href}"]`)) {
    loadedFonts.add(family);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
  loadedFonts.add(family);
}
