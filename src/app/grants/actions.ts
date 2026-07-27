"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export async function saveGrant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const grantId = String(formData.get("grantId"));
  const { error } = await supabase
    .from("saved_grants")
    .upsert(
      { owner_id: user.id, grant_id: grantId },
      { onConflict: "owner_id,grant_id" },
    );
  if (error) {
    redirect(`/grants/${grantId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/grants/${grantId}`);
  redirect(`/grants/${grantId}?saved=1`);
}

export async function applyToGrant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const grantId = String(formData.get("grantId"));
  const applicantId = String(formData.get("applicantId"));

  const [{ data: applicant }, { data: grant }] = await Promise.all([
    supabase.from("applicants").select("type").eq("id", applicantId).single(),
    supabase
      .from("grants")
      .select("eligibility, status")
      .eq("id", grantId)
      .single(),
  ]);
  if (!applicant) throw new Error("Applicant not found");
  if (!grant) throw new Error("Grant not found");
  if (grant.status !== "open") {
    redirect(
      `/grants/${grantId}?error=${encodeURIComponent("This grant is closed and can no longer be applied to.")}`,
    );
  }
  if (grant.eligibility !== "both" && grant.eligibility !== applicant.type) {
    redirect(
      `/grants/${grantId}?error=${encodeURIComponent(
        `This grant is open to ${grant.eligibility}s only; the selected applicant is an ${applicant.type}.`,
      )}`,
    );
  }

  const { error } = await supabase.from("applications").insert({
    owner_id: user.id,
    applicant_id: applicantId,
    grant_id: grantId,
    status: "draft",
  });
  if (error) {
    redirect(`/grants/${grantId}?error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath(`/grants/${grantId}`);
  redirect(`/grants/${grantId}?applied=1`);
}
