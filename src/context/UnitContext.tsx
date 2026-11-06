"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { EnergyUnit, LengthUnit } from "../lib/units";

const STORAGE_KEY = "tecno.units";

export interface UnitContextValue {
  lengthUnit: LengthUnit;
  setLengthUnit: (u: LengthUnit) => void;
  energyUnit: EnergyUnit;
  setEnergyUnit: (u: EnergyUnit) => void;
}
const UnitContext = createContext<UnitContextValue | undefined>(undefined);

export function UnitProvider({ children }: { children: React.ReactNode }) {
  const [lengthUnit, setLengthUnitState] = useState<LengthUnit>("m");
  const [energyUnit, setEnergyUnitState] = useState<EnergyUnit>("mwh");

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { lengthUnit?: string; energyUnit?: string };
        if (parsed.lengthUnit === "m" || parsed.lengthUnit === "ft") setLengthUnitState(parsed.lengthUnit);
        if (parsed.energyUnit === "mwh" || parsed.energyUnit === "kwh" || parsed.energyUnit === "joule")
          setEnergyUnitState(parsed.energyUnit);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lengthUnit, energyUnit }));
    } catch {
      /* ignore */
    }
  }, [lengthUnit, energyUnit]);

  const setLengthUnit = useCallback((u: LengthUnit) => setLengthUnitState(u), []);
  const setEnergyUnit = useCallback((u: EnergyUnit) => setEnergyUnitState(u), []);

  const value = useMemo<UnitContextValue>(
    () => ({ lengthUnit, setLengthUnit, energyUnit, setEnergyUnit }),
    [lengthUnit, setLengthUnit, energyUnit, setEnergyUnit],
  );
  return <UnitContext.Provider value={value}>{children}</UnitContext.Provider>;
}

export function useUnit(): UnitContextValue {
  const ctx = useContext(UnitContext);
  if (!ctx) throw new Error("useUnit must be used within a UnitProvider");
  return ctx;
}
