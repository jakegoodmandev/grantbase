"use client";
import { useState } from "react";
import { createApplicant } from "@/app/applicants/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ApplicantForm() {
  const [type, setType] = useState("individual");

  return (
    <form action={createApplicant} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Input
          name="displayName"
          type="text"
          placeholder="Display name"
          required
          className="w-64"
        />
        <input type="hidden" name="type" value={type} />
        <Select value={type} onValueChange={(v) => setType(v ?? "individual")}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="organization">Organization</SelectItem>
          </SelectContent>
        </Select>
        <Input
          name="email"
          type="email"
          placeholder="Email (optional)"
          className="w-64"
        />
      </div>
      <Button type="submit">Add client</Button>
    </form>
  );
}
