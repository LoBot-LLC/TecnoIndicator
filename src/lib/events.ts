/**
 * Tiny global event bus used to decouple the navbar Export
 * actions from the forecast chart / table that owns the data.
 *
 * The bus is `window` itself, so nothing here may touch the DOM at module
 * scope: this module is imported from client components that Next.js still
 * evaluates on the server during the initial render pass.
 */
export const EVENTS = {
  EXPORT_PNG: "tecnoindicator:export-png",
  EXPORT_CSV: "tecnoindicator:export-csv",
} as const;

export function emit(name: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name));
}
