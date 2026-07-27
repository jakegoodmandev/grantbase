import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";

const statusVariant = (s: string) =>
  s === "open" ? "default" : s === "closed" ? "secondary" : "outline";

function formatCurrency(value: number | null | undefined) {
  if (value == null) return null;
  return `$${Number(value).toLocaleString()}`;
}

export default async function SavedGrantsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Saved grants</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Sign in
          </Link>{" "}
          to see your saved grants.
        </p>
      </main>
    );
  }

  const { data: saved } = await supabase
    .from("saved_grants")
    .select(
      "id, created_at, grants(id, title, status, award_min, award_max, eligibility, application_deadline, foundations(name))",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Saved grants</h1>

      {saved?.length ? (
        <div className="space-y-3">
          {saved.map((row) => {
            const grant = Array.isArray(row.grants)
              ? row.grants[0]
              : row.grants;
            const foundation = Array.isArray(grant?.foundations)
              ? grant.foundations[0]
              : grant?.foundations;
            if (!grant) return null;
            return (
              <Link key={row.id} href={`/grants/${grant.id}`} className="block">
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {grant.title}
                      <Badge variant={statusVariant(grant.status)}>
                        {grant.status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {foundation?.name} · {grant.eligibility} ·{" "}
                    {formatCurrency(grant.award_min)}–
                    {formatCurrency(grant.award_max)}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have not saved any grants yet. Browse{" "}
          <Link href="/grants" className="underline">
            grants
          </Link>
          .
        </p>
      )}
    </main>
  );
}
