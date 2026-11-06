export type LengthUnit = "m" | "ft";
export type EnergyUnit = "mwh" | "kwh" | "joule";

export const M3_TO_FT3 = 35.31466672;
export const MWH_TO_KWH = 1000;
export const MWH_TO_J = 3.6e9;

export const LENGTH_UNITS: Array<{ id: LengthUnit; label: string }> = [
  { id: "m", label: "Meter (m³)" },
  { id: "ft", label: "Foot (ft³)" },
];
export const ENERGY_UNITS: Array<{ id: EnergyUnit; label: string }> = [
  { id: "mwh", label: "MWh" },
  { id: "kwh", label: "kWh" },
  { id: "joule", label: "Joule (J)" },
];

export function convertWater(valueUsdPerM3: number, lengthUnit: LengthUnit): number {
  if (!Number.isFinite(valueUsdPerM3)) return valueUsdPerM3;
  return lengthUnit === "ft" ? valueUsdPerM3 / M3_TO_FT3 : valueUsdPerM3;
}
export function waterLabel(lengthUnit: LengthUnit): string {
  return lengthUnit === "ft" ? "ft³" : "m³";
}

export function convertEnergy(valueUsdPerMWh: number, energyUnit: EnergyUnit): number {
  if (!Number.isFinite(valueUsdPerMWh)) return valueUsdPerMWh;
  switch (energyUnit) {
    case "kwh":
      return valueUsdPerMWh / MWH_TO_KWH;
    case "joule":
      return valueUsdPerMWh / MWH_TO_J;
    default:
      return valueUsdPerMWh;
  }
}
export function energyLabel(energyUnit: EnergyUnit): string {
  switch (energyUnit) {
    case "kwh":
      return "kWh";
    case "joule":
      return "J";
    default:
      return "MWh";
  }
}

export function lengthLabel(lengthUnit: LengthUnit): string {
  return lengthUnit === "ft" ? "ft" : "m";
}
export function convertLength(meters: number, lengthUnit: LengthUnit): number {
  if (!Number.isFinite(meters)) return meters;
  return lengthUnit === "ft" ? meters * 3.280839895 : meters;
}
