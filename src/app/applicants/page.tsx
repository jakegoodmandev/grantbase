import Link from "next/link";
import { deleteApplicant } from "@/app/applicants/actions";
import { ApplicantForm } from "@/components/applicant-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";

export default async function ApplicantsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Applicants</h1>
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Sign in
          </Link>{" "}
          to manage applicants.
        </p>
      </main>
    );
  }

  const { data: applicants } = await supabase
    .from("applicants")
    .select("id, display_name, type, is_self, email, phone, bio")
    .eq("owner_id", user.id)
    .order("is_self", { ascending: false });

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Applicants</h1>

      <section>
        <h2 className="text-lg font-semibold mb-3">Add a client</h2>
        <ApplicantForm />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Your profiles</h2>
        {applicants?.length ? (
          <div className="space-y-3">
            {applicants.map((a) => (
              <Card key={a.id}>
                <CardContent className="pt-4 text-sm flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {a.display_name}
                      {a.is_self ? " (self)" : ""}
                    </p>
                    <p className="text-muted-foreground">
                      {a.type} · {a.email}
                      {a.phone && <> · {a.phone}</>}
                    </p>
                    {a.bio && (
                      <p className="text-muted-foreground mt-1">{a.bio}</p>
                    )}
                  </div>
                  {!a.is_self && (
                    <form action={deleteApplicant}>
                      <input type="hidden" name="id" value={a.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Delete
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No applicants yet. Your account will have a personal profile after
            sign-up.
          </p>
        )}
      </section>
    </main>
  );
}
