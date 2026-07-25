"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function GrantFilters() {
  const router = useRouter();
  const sp = useSearchParams();
  const [eligibility, setEligibility] = useState(
    sp.get("eligibility") ?? "any",
  );
  const [status, setStatus] = useState(sp.get("status") ?? "any");
  const [minAmount, setMinAmount] = useState(sp.get("minAmount") ?? "");
  const [byDeadline, setByDeadline] = useState(sp.get("byDeadline") ?? "");

  function apply() {
    const params = new URLSearchParams();
    if (eligibility !== "any") params.set("eligibility", eligibility);
    if (status !== "any") params.set("status", status);
    if (minAmount) params.set("minAmount", minAmount);
    if (byDeadline) params.set("byDeadline", byDeadline);
    router.push(`/grants?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <Select
        value={eligibility}
        onValueChange={(v) => setEligibility(v ?? "any")}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any eligibility</SelectItem>
          <SelectItem value="individual">Individuals</SelectItem>
          <SelectItem value="organization">Organizations</SelectItem>
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setStatus(v ?? "any")}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any status</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="rolling">Rolling</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        placeholder="Min award $"
        className="w-36"
        value={minAmount}
        onChange={(e) => setMinAmount(e.target.value)}
      />
      <Input
        type="date"
        className="w-44"
        value={byDeadline}
        onChange={(e) => setByDeadline(e.target.value)}
      />
      <Button onClick={apply}>Filter</Button>
    </div>
  );
}
