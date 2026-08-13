"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceView } from "@/lib/schemas/api";

const POLL_MS = 1200;
const POLL_MAX_MS = 10_000;

type TraceHookState = {
  view: TraceView | null;
  /** Network/API failure while the trace itself may still be fine. */
  error: string | null;
  running: boolean;
  retry: () => void;
};

/**
 * Kick (or attach to) a reconstruction, then poll the DB-persisted step
 * states. Polling backs off exponentially on network failure and resumes
 * on visibilitychange/online — state lives in Postgres, so a backgrounded
 * iPhone Safari tab loses nothing.
 */
export function useTrace(gtin: string, lot: string | null): TraceHookState {
  const [view, setView] = useState<TraceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delay = useRef(POLL_MS);
  const stopped = useRef(false);

  const retry = useCallback(() => {
    setError(null);
    setView(null);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    stopped.current = false;
    delay.current = POLL_MS;

    const traceUrl = `/api/products/${gtin}/trace${lot ? `?lot=${encodeURIComponent(lot)}` : ""}`;

    async function poll() {
      if (stopped.current) return;
      try {
        const res = await fetch(traceUrl, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as TraceView;
          setView(data);
          setError(null);
          delay.current = POLL_MS;
          if (
            data.state === "complete" ||
            data.state === "partial" ||
            data.state === "failed"
          ) {
            return; // terminal
          }
        } else if (res.status === 404) {
          // Trace row not visible yet right after the kick — keep polling.
        } else {
          throw new Error(`trace poll ${res.status}`);
        }
      } catch {
        setError("offline");
        delay.current = Math.min(delay.current * 2, POLL_MAX_MS);
      }
      timer.current = setTimeout(poll, delay.current);
    }

    async function kick() {
      try {
        const res = await fetch("/api/trace/reconstruct", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gtin,
            mode: lot ? "batch" : "product",
            ...(lot ? { lot } : {}),
          }),
        });
        if (!res.ok && res.status !== 202) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setError(body?.error?.message ?? `reconstruct ${res.status}`);
          return;
        }
      } catch {
        setError("offline");
      }
      poll();
    }

    kick();

    const wake = () => {
      if (stopped.current) return;
      if (document.visibilityState === "visible") {
        if (timer.current) clearTimeout(timer.current);
        delay.current = POLL_MS;
        poll();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [gtin, lot, nonce]);

  const running =
    view === null || view.state === "pending" || view.state === "running";

  return { view, error, running, retry };
}
