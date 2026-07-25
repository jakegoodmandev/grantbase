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
      <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
        <Link href="/grants" className="font-semibold">
          grantbase
        </Link>
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{user.email}</span>
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
