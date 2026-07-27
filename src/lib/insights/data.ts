import { supabaseServer } from "@/lib/supabase/server";

export type InsightOverall = {
  total_grants: number;
  unique_recipients: number;
  total_amount: number | null;
  average_amount: number | null;
  median_amount: number | null;
  earliest_date: string | null;
  latest_date: string | null;
};

export type InsightYearly = {
  year: number;
  grant_count: number;
  total_amount: number | null;
};

export type InsightFunder = {
  id: string;
  name: string;
  total_amount: number;
};

export type InsightProgram = {
  id: string;
  title: string;
  total_amount: number;
};

export type InsightRecipient = {
  name: string;
  total_amount: number;
  grant_count: number;
};

export type InsightAmountBucket = {
  label: string;
  tooltip: string;
  count: number;
};

export type AwardInsights = {
  overall: InsightOverall;
  yearly: InsightYearly[];
  funders: InsightFunder[];
  programs: InsightProgram[];
  recipients: InsightRecipient[];
  amount_buckets: InsightAmountBucket[];
};

export async function getAwardInsights(
  startDate?: string | null,
  endDate?: string | null,
): Promise<AwardInsights | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("get_award_insights", {
    start_date: startDate || null,
    end_date: endDate || null,
  });
  if (error) {
    console.error("Failed to load award insights:", error);
    return null;
  }
  return data as AwardInsights;
}
