import Link from "next/link";
import { ApplyForm } from "@/components/apply-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";
import { saveGrant } from "../actions";

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

export default async function GrantDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await supabaseServer();

  const { data: grant } = await supabase
    .from("grants")
    .select(
      "*, foundations(id, name, description, website, contact_email, contact_phone)",
    )
    .eq("id", id)
    .single();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: applicants } = user
    ? await supabase
        .from("applicants")
        .select("id, display_name, type, is_self")
    : { data: [] };

  const { data: savedGrant } = user
    ? await supabase
        .from("saved_grants")
        .select("id")
        .eq("owner_id", user.id)
        .eq("grant_id", id)
        .maybeSingle()
    : { data: null };

  const { data: existingApplications } = user
    ? await supabase
        .from("applications")
        .select("id, status, applicant_id")
        .eq("owner_id", user.id)
        .eq("grant_id", id)
    : { data: [] };

  const { count: totalWinners } = await supabase
    .from("awards")
    .select("id", { count: "exact", head: true })
    .eq("grant_id", id);

  const { data: winners } = await supabase
    .from("awards")
    .select("id, winner_name, winner_type, award_date, award_amount, notes")
    .eq("grant_id", id)
    .order("award_date", { ascending: false })
    .limit(10);

  if (!grant) return <main className="p-6">Grant not found.</main>;

  const foundation = Array.isArray(grant.foundations)
    ? grant.foundations[0]
    : grant.foundations;

  const isOpen = grant.status === "open";
  const isSaved = !!savedGrant;
  const applications = existingApplications ?? [];
  const hasApplied = applications.length > 0;

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{grant.title}</h1>
          <Badge variant={statusVariant(grant.status)}>{grant.status}</Badge>
        </div>
        <p className="text-muted-foreground">{foundation?.name}</p>
      </header>

      <p>{grant.description}</p>

      <div className="text-sm text-muted-foreground space-y-1">
        <div>
          Award: {formatAwardRange(grant.award_min, grant.award_max)} ·
          Eligibility: {grant.eligibility}
        </div>
        {formatDeadline(grant.application_deadline) && (
          <div>Deadline: {formatDeadline(grant.application_deadline)}</div>
        )}
      </div>

      {foundation && (
        <section>
          <h2 className="text-lg font-semibold mb-2">Funder</h2>
          <Card>
            <CardContent className="pt-4 text-sm space-y-1">
              <p className="font-medium">{foundation.name}</p>
              {foundation.description && (
                <p className="text-muted-foreground">
                  {foundation.description}
                </p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
                {foundation.website && (
                  <a
                    href={foundation.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    Website
                  </a>
                )}
                {foundation.contact_email && (
                  <a
                    href={`mailto:${foundation.contact_email}`}
                    className="underline hover:text-foreground"
                  >
                    {foundation.contact_email}
                  </a>
                )}
                {foundation.contact_phone && (
                  <span>{foundation.contact_phone}</span>
                )}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {user ? (
        <div className="space-y-4">
          {sp.saved === "1" && (
            <p className="text-sm text-green-600">Grant saved.</p>
          )}
          {sp.applied === "1" && (
            <p className="text-sm text-green-600">Application created.</p>
          )}
          {sp.error && (
            <p className="text-sm text-destructive" role="alert">
              {sp.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <form action={saveGrant}>
              <input type="hidden" name="grantId" value={grant.id} />
              <Button variant="outline" type="submit" disabled={isSaved}>
                {isSaved ? "Saved" : "☆ Save"}
              </Button>
            </form>

            {isOpen ? (
              <ApplyForm
                grantId={grant.id}
                applicants={applicants ?? []}
                applications={applications}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                This grant is closed and can no longer be applied to.
              </p>
            )}
          </div>

          {hasApplied && (
            <div className="text-sm text-muted-foreground">
              You already applied to this grant.
              <Link href="/applications" className="underline ml-1">
                View your applications
              </Link>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Sign in
          </Link>{" "}
          to save or apply.
        </p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">
          Past winners
          {totalWinners != null && (
            <span className="text-sm font-normal text-muted-foreground ml-2">
              ({totalWinners.toLocaleString()} total)
            </span>
          )}
        </h2>
        {winners?.length ? (
          <div className="space-y-2">
            {winners.map((w) => (
              <Card key={w.id}>
                <CardContent className="pt-4 text-sm">
                  <span className="font-medium">{w.winner_name}</span> (
                  {w.winner_type})
                  {w.award_amount && <> · {formatCurrency(w.award_amount)}</>}
                  {w.award_date && <> · {formatDeadline(w.award_date)}</>}
                  {w.notes && (
                    <p className="mt-1 text-muted-foreground">{w.notes}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No recorded past awards.
          </p>
        )}
      </section>
    </main>
  );
}
