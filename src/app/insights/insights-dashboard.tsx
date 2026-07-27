"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  formatChartCompactCurrency,
  formatChartCurrency,
  generateAmountChartData,
  generateTopFundersChartData,
  generateTopProgramsChartData,
  generateTopRecipientsChartData,
  generateYearlyChartData,
} from "@/lib/insights/buckets";
import type {
  AwardInsights,
  InsightAmountBucket,
  InsightFunder,
  InsightProgram,
  InsightRecipient,
  InsightYearly,
} from "@/lib/insights/data";
import {
  formatCurrency,
  formatDateRange,
  formatNumber,
} from "@/lib/insights/format";

function StatCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {helper && (
          <div className="text-xs text-muted-foreground mt-1">{helper}</div>
        )}
      </CardContent>
    </Card>
  );
}

function AmountTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: { tooltip?: string; count?: number; percentage?: number };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{p.tooltip}</div>
      <div className="text-muted-foreground">
        {formatNumber(p.count)} grants ({p.percentage}%)
      </div>
    </div>
  );
}

function RankTooltipContent({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: { fullName?: string; value?: number };
    value?: number;
  }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  const value = payload[0]?.value;
  if (!p) return null;
  return (
    <div className="rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl max-w-xs">
      <div className="font-medium break-words">{p.fullName}</div>
      <div className="text-muted-foreground">
        {formatCurrency(Number(value ?? 0))}
      </div>
    </div>
  );
}

function AmountDistributionChart({
  buckets,
}: {
  buckets: InsightAmountBucket[];
}) {
  const data = generateAmountChartData(buckets);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Grants by amount</CardTitle>
        <CardDescription>
          Number of awards in each dollar range.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{ count: { label: "Grants" } }}
          className="h-72"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={60}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(value: number) =>
                  value >= 1_000
                    ? `${(value / 1_000).toFixed(0)}k`
                    : String(value)
                }
              />
              <Tooltip content={<AmountTooltipContent />} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry) => (
                  <Cell key={`amount-${entry.name}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function YearlyTrendChart({ yearly }: { yearly: InsightYearly[] }) {
  const data = generateYearlyChartData(yearly);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Grants over time</CardTitle>
        <CardDescription>
          Total dollars awarded and number of awards by year.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{
            amount: { label: "Amount awarded" },
            count: { label: "Grant count" },
          }}
          className="h-72"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 12 }} />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                tickFormatter={formatChartCompactCurrency}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={formatChartCurrency}
              />
              <Tooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const num = Number(value ?? 0);
                      if (name === "amount")
                        return [formatCurrency(num), "Amount awarded"];
                      return [formatNumber(num), "Grant count"];
                    }}
                  />
                }
              />
              <Bar
                yAxisId="left"
                dataKey="amount"
                fill="var(--chart-1)"
                radius={[4, 4, 0, 0]}
              />
              <Bar
                yAxisId="right"
                dataKey="count"
                fill="var(--chart-2)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function HorizontalBarChart({
  data,
  title,
  description,
}: {
  data: Array<{ name: string; fullName: string; value: number; fill: string }>;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer
          config={{ value: { label: "Amount awarded" } }}
          className="h-96"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11 }}
                tickFormatter={formatChartCompactCurrency}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11 }}
                width={220}
              />
              <Tooltip content={<RankTooltipContent />} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {data.map((entry) => (
                  <Cell key={`rank-${entry.fullName}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function TopFunders({ funders }: { funders: InsightFunder[] }) {
  const data = generateTopFundersChartData(funders);
  return (
    <HorizontalBarChart
      data={data}
      title="Top funders"
      description="Foundations by total dollars awarded."
    />
  );
}

function TopPrograms({ programs }: { programs: InsightProgram[] }) {
  const data = generateTopProgramsChartData(programs);
  return (
    <HorizontalBarChart
      data={data}
      title="Top programs"
      description="Programs by total dollars awarded."
    />
  );
}

function TopRecipients({ recipients }: { recipients: InsightRecipient[] }) {
  const data = generateTopRecipientsChartData(recipients);
  return (
    <HorizontalBarChart
      data={data}
      title="Top recipients"
      description="Recipients by total dollars awarded."
    />
  );
}

export function InsightsDashboard({
  data,
  startDate,
  endDate,
}: {
  data: AwardInsights;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const overall = data.overall;
  const average = overall.average_amount ?? 0;
  const median = overall.median_amount ?? 0;

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-8">
      <header className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              Award insights
            </h1>
            <p className="text-muted-foreground">
              A public snapshot of the historical grants catalog. Period
              covered:{" "}
              {formatDateRange(overall.earliest_date, overall.latest_date)}.
            </p>
          </div>
          <DateRangePicker startDate={startDate} endDate={endDate} />
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total awarded"
          value={formatCurrency(overall.total_amount)}
          helper={`${formatNumber(overall.total_grants)} grants`}
        />
        <StatCard
          label="Unique recipients"
          value={formatNumber(overall.unique_recipients)}
        />
        <StatCard label="Average grant" value={formatCurrency(average)} />
        <StatCard label="Median grant" value={formatCurrency(median)} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <AmountDistributionChart buckets={data.amount_buckets} />
        <YearlyTrendChart yearly={data.yearly} />
      </section>

      <section className="space-y-6">
        <TopFunders funders={data.funders} />
        <TopPrograms programs={data.programs} />
        <TopRecipients recipients={data.recipients} />
      </section>
    </main>
  );
}
