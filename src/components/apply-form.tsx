"use client";
import { useState } from "react";
import { applyToGrant } from "@/app/grants/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Applicant = {
  id: string;
  display_name: string;
  type: string;
  is_self?: boolean;
};
type Application = { id: string; status: string; applicant_id: string };

export function ApplyForm({
  grantId,
  applicants,
  applications,
}: {
  grantId: string;
  applicants: Applicant[];
  applications?: Application[];
}) {
  const [applicantId, setApplicantId] = useState(applicants[0]?.id ?? "");
  if (!applicants.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add an applicant profile to apply.
      </p>
    );

  const existingByApplicant = new Map(
    (applications ?? []).map((app) => [app.applicant_id, app]),
  );
  const selectedExisting = existingByApplicant.get(applicantId);

  return (
    <form action={applyToGrant} className="flex gap-2 items-center">
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="applicantId" value={applicantId} />
      <Select
        value={applicantId}
        onValueChange={(v) => setApplicantId(v ?? "")}
      >
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Choose applicant" />
        </SelectTrigger>
        <SelectContent>
          {applicants.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.display_name} ({a.type}){a.is_self ? " — self" : ""}
              {existingByApplicant.has(a.id) ? " (applied)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={!!selectedExisting}>
        {selectedExisting ? "Applied" : "Apply"}
      </Button>
    </form>
  );
}
