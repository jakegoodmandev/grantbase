import type { InsightAmountBucket } from "@/lib/insights/data";
import { formatCompactCurrency, formatNumber } from "@/lib/insights/format";

export function generateAmountChartData(buckets: InsightAmountBucket[]) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  return buckets.map((b, index) => ({
    name: b.label,
    tooltip: b.tooltip,
    count: b.count,
    percentage: total > 0 ? Number(((b.count / total) * 100).toFixed(1)) : 0,
    fill: `var(--chart-${(index % 5) + 1})`,
  }));
}

export function generateYearlyChartData(
  yearly: { year: number; total_amount: number | null; grant_count: number }[],
) {
  return yearly.map((y) => ({
    year: String(y.year),
    amount: Number(y.total_amount ?? 0),
    count: y.grant_count,
  }));
}

export function generateRankedChartData(
  items: { name: string; value: number }[],
  maxLabelLength = 48,
) {
  return items
    .map((item, index) => ({
      name:
        item.name.length > maxLabelLength
          ? `${item.name.slice(0, maxLabelLength).trim()}…`
          : item.name,
      fullName: item.name,
      value: item.value,
      fill: `var(--chart-${(index % 5) + 1})`,
    }))
    .reverse();
}

export function generateTopFundersChartData(
  funders: { name: string; total_amount: number }[],
) {
  return generateRankedChartData(
    funders.map((f) => ({ name: f.name, value: f.total_amount })),
  );
}

export function generateTopProgramsChartData(
  programs: { title: string; total_amount: number }[],
) {
  return generateRankedChartData(
    programs.map((p) => ({ name: p.title, value: p.total_amount })),
  );
}

export function generateTopRecipientsChartData(
  recipients: { name: string; total_amount: number }[],
) {
  return generateRankedChartData(
    recipients.map((r) => ({ name: r.name, value: r.total_amount })),
  );
}

export function formatChartCurrency(value: number | string): string {
  const num = typeof value === "string" ? Number(value) : value;
  return formatNumber(num);
}

export function formatChartCompactCurrency(value: number | string): string {
  const num = typeof value === "string" ? Number(value) : value;
  return formatCompactCurrency(num);
}
