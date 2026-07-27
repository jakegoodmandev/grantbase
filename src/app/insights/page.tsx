import { getAwardInsights } from "@/lib/insights/data";
import { InsightsDashboard } from "./insights-dashboard";

export const metadata = {
  title: "Award insights | grantbase",
  description: "Explore historical grant awards across the catalog.",
};

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const { startDate, endDate } = await searchParams;
  const data = await getAwardInsights(startDate, endDate);

  if (!data) {
    return (
      <main className="max-w-6xl mx-auto p-6">
        <h1 className="text-2xl font-bold">Award insights</h1>
        <p className="text-muted-foreground mt-2">
          Unable to load insights right now. Please try again later.
        </p>
      </main>
    );
  }

  return (
    <InsightsDashboard data={data} startDate={startDate} endDate={endDate} />
  );
}
