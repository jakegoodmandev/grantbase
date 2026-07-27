"use client";

import { format, parseISO } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DateRangePicker({
  startDate,
  endDate,
  className,
}: {
  startDate?: string | null;
  endDate?: string | null;
  className?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = React.useState(false);

  const initialRange = React.useMemo<DateRange | undefined>(() => {
    if (!startDate && !endDate) return undefined;
    return {
      from: startDate ? parseISO(startDate) : undefined,
      to: endDate ? parseISO(endDate) : undefined,
    };
  }, [startDate, endDate]);

  const [range, setRange] = React.useState<DateRange | undefined>(
    initialRange,
  );

  React.useEffect(() => {
    setRange(initialRange);
  }, [initialRange]);

  function applyRange(next: DateRange | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (next?.from) {
      params.set("startDate", format(next.from, "yyyy-MM-dd"));
    } else {
      params.delete("startDate");
    }
    if (next?.to) {
      params.set("endDate", format(next.to, "yyyy-MM-dd"));
    } else {
      params.delete("endDate");
    }
    router.push(`?${params.toString()}`, { scroll: false });
  }

  function handleSelect(next: DateRange | undefined) {
    setRange(next);
    if (next?.from && next?.to) {
      setOpen(false);
      applyRange(next);
    }
  }

  function handleClear() {
    setRange(undefined);
    setOpen(false);
    applyRange(undefined);
  }

  const label = React.useMemo(() => {
    if (range?.from && range?.to) {
      return `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`;
    }
    if (range?.from) {
      return `${format(range.from, "MMM d, yyyy")} – …`;
    }
    return "Pick a date range";
  }, [range]);

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className={cn(
                "w-full justify-start text-left font-normal sm:w-auto",
                !range && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {label}
            </Button>
          }
        />
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelect}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
      {(range?.from || range?.to) && (
        <Button variant="ghost" size="sm" onClick={handleClear}>
          Clear
        </Button>
      )}
    </div>
  );
}
