import { Droplets, Fuel, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { useCurrency } from "../context/CurrencyContext";
import { useUnit } from "../context/UnitContext";
import { convertEnergy, convertWater, energyLabel, waterLabel } from "../lib/units";
import { type CommodityId } from "../lib/model";

const META: Record<
  CommodityId,
  { name: string; icon: typeof Fuel; color: string }
> = {
  oil: { name: "BRENT CRUDE", icon: Fuel, color: "#f5b840" },
  electricity: { name: "GLOBAL POWER", icon: Zap, color: "#2dd4bf" },
  water: { name: "GLOBAL WATER", icon: Droplets, color: "#38bdf8" },
};

interface TickerProps {
  prices: Record<CommodityId, number>;
  deltas: Record<CommodityId, number>;
}

export default function Ticker({ prices, deltas }: TickerProps) {
  const { selectedCurrency, formatPrice } = useCurrency();
  const { lengthUnit, energyUnit } = useUnit();
  const items = (Object.keys(META) as CommodityId[]).map((id) => {
    const m = META[id];
    const delta = deltas[id] ?? 0;
    const up = delta >= 0;
    let displayValue = prices[id];
    let unit = "bbl";
    if (id === "electricity") {
      displayValue = convertEnergy(prices[id], energyUnit);
      unit = energyLabel(energyUnit);
    } else if (id === "water") {
      displayValue = convertWater(prices[id], lengthUnit);
      unit = waterLabel(lengthUnit);
    }
    return { id, ...m, displayValue, unit, delta, up };
  });

  const row = (keyPrefix: string) => (
    <div className="flex shrink-0 items-center gap-10 px-6" key={keyPrefix}>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div key={`${keyPrefix}-${it.id}`} className="flex items-center gap-3 whitespace-nowrap">
            <Icon className="h-3.5 w-3.5" style={{ color: it.color }} />
            <span className="text-[11px] font-semibold tracking-[0.18em] text-slate-700 dark:text-slate-100">
              {it.name}
            </span>
            <span className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              {formatPrice(it.displayValue, selectedCurrency)}
              <span className="ml-1 text-[11px] font-medium text-slate-700 dark:text-slate-100">/{it.unit}</span>
            </span>
            <span
              className={`inline-flex items-center gap-0.5 text-[11px] font-semibold ${
                it.up ? "text-rose-300" : "text-emerald-300"
              }`}
            >
              {it.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {it.up ? "+" : "−"}
              {Math.abs(it.delta * 100).toFixed(2)}%
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="marquee border-y border-line bg-panel/60 py-2.5" aria-hidden="true">
      <div className="marquee-track">
        {row("a")}
        {row("b")}
      </div>
    </div>
  );
}
