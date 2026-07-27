"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export async function createApplicant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const displayName = String(formData.get("displayName") || "").trim();
  const type = String(formData.get("type") || "individual") as
    | "individual"
    | "organization";
  const email = String(formData.get("email") || "").trim() || null;

  if (!displayName) throw new Error("Display name is required");

  const { error } = await supabase.from("applicants").insert({
    owner_id: user.id,
    display_name: displayName,
    type,
    email,
    is_self: false,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/applicants");
  redirect("/applicants");
}

export async function deleteApplicant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const id = String(formData.get("id"));
  const { error } = await supabase
    .from("applicants")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) throw new Error(error.message);

  revalidatePath("/applicants");
  redirect("/applicants");
}
