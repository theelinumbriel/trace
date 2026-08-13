"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STORAGE_KEY = "trace.locality";

export function useLocality(): [string | null, (v: string) => void] {
  const [locality, setLocality] = useState<string | null>(null);
  useEffect(() => {
    setLocality(localStorage.getItem(STORAGE_KEY));
  }, []);
  const save = (v: string) => {
    localStorage.setItem(STORAGE_KEY, v);
    setLocality(v);
  };
  return [locality, save];
}

type BigDataCloudResponse = {
  city?: string;
  locality?: string;
  principalSubdivision?: string;
  countryCode?: string;
};

/**
 * Approximate-locality resolution. Privacy invariants:
 *  - coordinates are rounded to 2 decimals (~1.1 km) BEFORE any network call
 *  - the reverse-geocode call is client-side only (BigDataCloud free
 *    endpoint terms) — precise coordinates never reach our servers
 *  - only the display string is kept
 */
async function resolveLocality(): Promise<string> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 600_000,
    }),
  );
  const lat = Math.round(pos.coords.latitude * 100) / 100;
  const lng = Math.round(pos.coords.longitude * 100) / 100;
  const res = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`,
  );
  if (!res.ok) throw new Error("reverse geocode failed");
  const data = (await res.json()) as BigDataCloudResponse;
  const parts = [
    data.locality && data.locality !== data.city ? data.locality : null,
    data.city || data.principalSubdivision || null,
  ].filter(Boolean);
  if (parts.length === 0) throw new Error("no locality");
  return parts.join(", ");
}

/**
 * The terminal "Your scan" node content: locality display, or the opt-in
 * flow (explainer first, permission second — never prompt on load).
 */
export function ScanNodeContent() {
  const [locality, saveLocality] = useLocality();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const onUseMyArea = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const value = await resolveLocality();
      saveLocality(value);
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-micro font-medium uppercase tracking-widest text-meta">
        Your scan
      </p>
      {locality ? (
        <>
          <p className="mt-0.5 text-title-2 text-ink">{locality}</p>
          <p className="mt-1 text-meta font-medium text-ink">Observed</p>
        </>
      ) : (
        <>
          <p className="mt-0.5 text-title-2 text-ink">Here</p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1 inline-flex items-center gap-1 text-meta font-medium text-ink underline underline-offset-2"
          >
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.5} />
            Location off · Add your area?
          </button>
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Complete the last mile.</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Trace can end this journey at your neighborhood. We use your
                  approximate area only — like &ldquo;Upper East Side, New
                  York&rdquo;.
                </p>
                <p>
                  Your exact coordinates are never stored or sent to our
                  servers.
                </p>
                {failed && (
                  <p className="text-danger">
                    Couldn&apos;t resolve your area — permission denied or the
                    lookup failed. You can try again anytime.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setOpen(false)}
            >
              Not now
            </Button>
            <Button
              className="rounded-full"
              onClick={onUseMyArea}
              disabled={busy}
            >
              {busy ? "Locating…" : "Use my area"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
