import Link from "next/link";
import { GrantFilters } from "@/components/grant-filters";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";

const statusVariant = (s: string) =>
  s === "open" ? "default" : s === "closed" ? "secondary" : "outline";

function formatCurrency(value: number | null | undefined) {
  if (value == null) return null;
  return `$${Number(value).toLocaleString()}`;
}

function formatAwardRange(
  awardMin: number | null | undefined,
  awardMax: number | null | undefined,
) {
  const min = formatCurrency(awardMin);
  const max = formatCurrency(awardMax);
  if (min && max) return `${min}–${max}`;
  if (max) return `up to ${max}`;
  if (min) return `from ${min}`;
  return "Amount not specified";
}

function formatDeadline(date: string | null | undefined) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const sp = await searchParams;
  const supabase = await supabaseServer();

  let q = supabase
    .from("grants")
    .select(
      "id, title, eligibility, status, award_min, award_max, application_deadline, foundations(name)",
    )
    .order("application_deadline", { ascending: true, nullsFirst: false });

  // eligibility=individual also surfaces "both"
  if (sp.eligibility === "individual")
    q = q.in("eligibility", ["individual", "both"]);
  if (sp.eligibility === "organization")
    q = q.in("eligibility", ["organization", "both"]);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.minAmount) q = q.gte("award_max", Number(sp.minAmount)); // grant can pay at least X
  if (sp.byDeadline) q = q.lte("application_deadline", sp.byDeadline);

  const { data: grants } = await q;

  const hasFilters =
    sp.eligibility || sp.status || sp.minAmount || sp.byDeadline;

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Grants</h1>
      <GrantFilters />

      {grants?.length ? (
        <div className="space-y-3">
          {grants.map((g) => {
            const foundation = Array.isArray(g.foundations)
              ? g.foundations[0]
              : g.foundations;
            return (
              <Link key={g.id} href={`/grants/${g.id}`} className="block">
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {g.title}
                      <Badge variant={statusVariant(g.status)}>
                        {g.status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {foundation?.name} · {g.eligibility} ·{" "}
                    {formatAwardRange(g.award_min, g.award_max)}
                    {formatDeadline(g.application_deadline) && (
                      <> · due {formatDeadline(g.application_deadline)}</>
                    )}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? "No grants match the selected filters."
            : "No grants available yet."}
        </p>
      )}
    </main>
  );
}
