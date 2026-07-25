import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="max-w-sm mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <form className="space-y-3">
        <Input
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
        <Input
          name="password"
          type="password"
          placeholder="Password (min 6 characters)"
          autoComplete="current-password"
          minLength={6}
          required
        />
        <Input
          name="displayName"
          type="text"
          placeholder="Display name (for sign up)"
          autoComplete="name"
        />
        <div className="flex gap-2">
          <Button type="submit" formAction={login}>
            Sign in
          </Button>
          <Button type="submit" formAction={signup} variant="outline">
            Sign up
          </Button>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        Local dev: sign-up creates an account instantly (no email confirmation)
        and a personal applicant profile so you can apply right away.
      </p>
    </main>
  );
}
