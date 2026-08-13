"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeDetector,
  prepareZXingModule,
} from "barcode-detector/ponyfill";
import type { ParsedScan } from "@/lib/gtin";
import { parseScanValue } from "@/lib/gtin";

// Ponyfill-always: native BarcodeDetector is absent on iOS Safari, partial
// on desktop, and GMS-dependent on Android — one consistent decoder beats
// four inconsistent ones. WASM is self-hosted (public/wasm), never CDN.
prepareZXingModule({
  overrides: {
    locateFile: (path: string) =>
      path.endsWith(".wasm") ? `/wasm/${path}` : path,
  },
});

export type ScannerState =
  | "idle"
  | "requesting"
  | "scanning"
  | "detected"
  | "denied"
  | "unsupported";

export type Detection = {
  parsed: ParsedScan;
  rawValue: string;
  symbology: "upc_a" | "ean_13" | "ean_8" | "data_matrix" | "qr_code";
  invalid?: false;
};

const FORMAT_MAP: Record<string, Detection["symbology"]> = {
  upc_a: "upc_a",
  ean_13: "ean_13",
  ean_8: "ean_8",
  data_matrix: "data_matrix",
  qr_code: "qr_code",
};

const DETECT_INTERVAL_MS = 140;
const DUPLICATE_WINDOW_MS = 5000;

export function useScanner(
  onDetect: (d: Detection) => void,
  onInvalid: () => void,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<ScannerState>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const lastValue = useRef<{ value: string; at: number } | null>(null);
  const frozen = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    stop();
    frozen.current = false;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setState("unsupported");
      return;
    }
    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();

      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setTorchAvailable(!!caps?.torch);

      const detector = new BarcodeDetector({
        formats: ["upc_a", "ean_13", "ean_8", "qr_code", "data_matrix"],
      });

      setState("scanning");
      timer.current = setInterval(async () => {
        if (frozen.current || !videoRef.current) return;
        if (videoRef.current.readyState < 2) return;
        try {
          const results = await detector.detect(videoRef.current);
          if (results.length === 0) return;
          const hit = results[0];
          const now = Date.now();
          if (
            lastValue.current &&
            lastValue.current.value === hit.rawValue &&
            now - lastValue.current.at < DUPLICATE_WINDOW_MS
          ) {
            return;
          }
          lastValue.current = { value: hit.rawValue, at: now };
          const parsed = parseScanValue(hit.rawValue);
          if (!parsed) {
            onInvalid();
            return;
          }
          frozen.current = true;
          videoRef.current.pause();
          setState("detected");
          onDetect({
            parsed,
            rawValue: hit.rawValue,
            symbology: FORMAT_MAP[hit.format] ?? "ean_13",
          });
        } catch {
          /* single-frame decode failure — keep scanning */
        }
      }, DETECT_INTERVAL_MS);
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError")
      ) {
        setState("denied");
      } else if (
        err instanceof DOMException &&
        (err.name === "NotFoundError" || err.name === "OverconstrainedError")
      ) {
        setState("unsupported");
      } else {
        setState("unsupported");
      }
    }
  }, [onDetect, onInvalid, stop]);

  /** Un-freeze and resume scanning after a miss/error. */
  const resume = useCallback(() => {
    frozen.current = false;
    lastValue.current = null;
    videoRef.current?.play().catch(() => start());
    setState("scanning");
  }, [start]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  // iOS kills backgrounded streams — rebuild on return.
  useEffect(() => {
    const onWake = () => {
      if (
        document.visibilityState === "visible" &&
        streamRef.current &&
        !streamRef.current.active
      ) {
        start();
      }
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("pageshow", onWake);
    return () => {
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [start]);

  useEffect(() => stop, [stop]);

  return { videoRef, state, start, resume, stop, torchAvailable, torchOn, toggleTorch };
}
