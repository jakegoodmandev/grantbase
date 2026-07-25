"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

export async function saveGrant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const grantId = String(formData.get("grantId"));
  await supabase
    .from("saved_grants")
    .upsert(
      { owner_id: user.id, grant_id: grantId },
      { onConflict: "owner_id,grant_id" },
    );
  revalidatePath(`/grants/${grantId}`);
}

export async function applyToGrant(formData: FormData) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const grantId = String(formData.get("grantId"));
  const applicantId = String(formData.get("applicantId"));

  // Eligibility guard: an individual may not apply to an organization-only grant,
  // and vice versa. Grants marked 'both' accept either applicant type.
  const [{ data: applicant }, { data: grant }] = await Promise.all([
    supabase.from("applicants").select("type").eq("id", applicantId).single(),
    supabase.from("grants").select("eligibility").eq("id", grantId).single(),
  ]);
  if (!applicant) throw new Error("Applicant not found");
  if (!grant) throw new Error("Grant not found");
  if (grant.eligibility !== "both" && grant.eligibility !== applicant.type) {
    throw new Error(
      `This grant is open to ${grant.eligibility}s only; the selected applicant is an ${applicant.type}.`,
    );
  }

  await supabase.from("applications").upsert(
    {
      owner_id: user.id,
      applicant_id: applicantId,
      grant_id: grantId,
      status: "draft",
    },
    { onConflict: "applicant_id,grant_id" },
  );
  revalidatePath(`/grants/${grantId}`);
}
