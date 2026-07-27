export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `$${Number(value).toLocaleString("en-CA", { maximumFractionDigits: 0 })}`;
}

export function formatCompactCurrency(
  value: number | null | undefined,
): string {
  if (value == null || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `$${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `$${value.toFixed(0)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-CA", { maximumFractionDigits: 0 });
}

import { parseISO } from "date-fns";

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start && !end) return "—";
  const s = start ? parseISO(start).getFullYear() : "…";
  const e = end ? parseISO(end).getFullYear() : "…";
  return `${s}–${e}`;
}
