import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { supabaseServer } from "@/lib/supabase/server";

export async function SiteHeader() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="border-b">
      <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/grants" className="font-semibold">
            grantbase
          </Link>
          <Link
            href="/insights"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            Insights
          </Link>
        </div>
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/saved" className="hover:underline">
              Saved
            </Link>
            <Link href="/applications" className="hover:underline">
              Applications
            </Link>
            <Link href="/applicants" className="hover:underline">
              Applicants
            </Link>
            <span className="text-muted-foreground hidden sm:inline">
              {user.email}
            </span>
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
