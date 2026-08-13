"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseScanValue } from "@/lib/gtin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ManualEntryForm({
  autoFocus = false,
  onNavigate,
}: {
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseScanValue(value);
    if (!parsed) {
      setError(
        "That doesn't look like a valid barcode number. Check the digits printed under the bars.",
      );
      return;
    }
    onNavigate?.();
    router.push(
      `/product/${parsed.gtin14}${parsed.lot ? `?lot=${encodeURIComponent(parsed.lot)}` : ""}`,
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="barcode-input">Barcode number</Label>
        <Input
          id="barcode-input"
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="e.g. 858010005580"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          className="font-mono tabular-nums"
        />
        {error && <p className="text-meta text-danger">{error}</p>}
        <p className="text-micro text-meta">
          UPC, EAN, GTIN — or paste a GS1 code like
          (01)00858010005580(10)LOT.
        </p>
      </div>
      <Button type="submit" className="w-full rounded-full">
        Look up product
      </Button>
    </form>
  );
}
