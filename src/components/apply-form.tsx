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

type Applicant = { id: string; display_name: string; type: string };

export function ApplyForm({
  grantId,
  applicants,
}: {
  grantId: string;
  applicants: Applicant[];
}) {
  const [applicantId, setApplicantId] = useState(applicants[0]?.id ?? "");
  if (!applicants.length)
    return (
      <p className="text-sm text-muted-foreground">
        Add an applicant profile to apply.
      </p>
    );

  return (
    <form action={applyToGrant} className="flex gap-2">
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
              {a.display_name} ({a.type})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit">Apply</Button>
    </form>
  );
}
