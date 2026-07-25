import { ApplyForm } from "@/components/apply-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";
import { saveGrant } from "../actions";

const statusVariant = (s: string) =>
  s === "open" ? "default" : s === "closed" ? "secondary" : "outline";

export default async function GrantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: grant } = await supabase
    .from("grants")
    .select("*, foundations(name, website, contact_email)")
    .eq("id", id)
    .single();

  const { data: winners } = await supabase
    .from("past_awards")
    .select("winner_name, winner_type, award_date, award_amount, notes")
    .eq("grant_id", id)
    .order("award_date", { ascending: false });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: applicants } = user
    ? await supabase.from("applicants").select("id, display_name, type")
    : { data: [] };

  if (!grant) return <main className="p-6">Grant not found.</main>;

  const foundation = Array.isArray(grant.foundations)
    ? grant.foundations[0]
    : grant.foundations;

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
      <div className="text-sm text-muted-foreground">
        Award: ${Number(grant.award_min).toLocaleString()}–$
        {Number(grant.award_max).toLocaleString()} · Eligibility:{" "}
        {grant.eligibility}
        {grant.application_deadline && (
          <> · Deadline: {grant.application_deadline}</>
        )}
      </div>

      {user ? (
        <div className="flex flex-wrap items-center gap-4">
          <form action={saveGrant}>
            <input type="hidden" name="grantId" value={grant.id} />
            <Button variant="outline" type="submit">
              ☆ Save
            </Button>
          </form>
          <ApplyForm grantId={grant.id} applicants={applicants ?? []} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sign in to save or apply.
        </p>
      )}

      <section>
        <h2 className="text-lg font-semibold mb-2">Past winners</h2>
        {winners?.length ? (
          <div className="space-y-2">
            {winners.map((w) => (
              <Card key={`${w.winner_name}-${w.award_date}`}>
                <CardContent className="pt-4 text-sm">
                  <span className="font-medium">{w.winner_name}</span> (
                  {w.winner_type})
                  {w.award_amount && (
                    <> · ${Number(w.award_amount).toLocaleString()}</>
                  )}
                  {w.award_date && <> · {w.award_date}</>}
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
