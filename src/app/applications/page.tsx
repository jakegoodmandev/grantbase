import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";

const statusVariant = (s: string) =>
  s === "open" ? "default" : s === "closed" ? "secondary" : "outline";

export default async function ApplicationsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">My applications</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Sign in
          </Link>{" "}
          to see your applications.
        </p>
      </main>
    );
  }

  const { data: applications } = await supabase
    .from("applications")
    .select(
      "id, status, submitted_at, created_at, applicant_id, grants(id, title, status, eligibility, foundations(name)), applicants(id, display_name, is_self)",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">My applications</h1>

      {applications?.length ? (
        <div className="space-y-3">
          {applications.map((app) => {
            const grant = Array.isArray(app.grants)
              ? app.grants[0]
              : app.grants;
            const applicant = Array.isArray(app.applicants)
              ? app.applicants[0]
              : app.applicants;
            const foundation = Array.isArray(grant?.foundations)
              ? grant.foundations[0]
              : grant?.foundations;
            if (!grant) return null;
            return (
              <Link key={app.id} href={`/grants/${grant.id}`} className="block">
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
                    <div>
                      Applicant: {applicant?.display_name}
                      {applicant?.is_self ? " (self)" : ""}
                    </div>
                    <div>
                      Application status: {app.status}
                      {app.submitted_at && (
                        <>
                          {" "}
                          · Submitted{" "}
                          {new Date(app.submitted_at).toLocaleDateString(
                            "en-CA",
                          )}
                        </>
                      )}
                    </div>
                    {foundation?.name && <div>Funder: {foundation.name}</div>}
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You have not applied to any grants yet. Browse{" "}
          <Link href="/grants" className="underline">
            grants
          </Link>
          .
        </p>
      )}
    </main>
  );
}
