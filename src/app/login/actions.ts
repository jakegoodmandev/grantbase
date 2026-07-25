"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = await supabaseServer();
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/", "layout");
  redirect("/grants");
}

export async function signup(formData: FormData) {
  const supabase = await supabaseServer();
  const email = String(formData.get("email"));
  const password = String(formData.get("password"));
  const displayName =
    String(formData.get("displayName") || "").trim() || email.split("@")[0];

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Give the new account a personal ("self") applicant profile so it can apply
  // to grants immediately. Additional client applicants can be added later.
  if (data.user) {
    await supabase.from("applicants").insert({
      owner_id: data.user.id,
      type: "individual",
      display_name: displayName,
      is_self: true,
      email,
    });
  }

  revalidatePath("/", "layout");
  redirect("/grants");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/grants");
}
