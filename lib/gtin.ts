import { GS1Parser } from "@valentynb/gs1-parser";
import { DigitalLink } from "digital-link.js";

/**
 * GTIN handling. One canonical key everywhere: GTIN-14, zero-padded.
 *   UPC-A (12)  → "00" + code
 *   EAN-13      → "0"  + code
 *   EAN-8       → "000000" + code
 *   GTIN-14     → as-is
 */

export type NormalizedGtin = {
  /** "00858010005580" — products.gtin, route param, cache key. */
  gtin14: string;
  /** "858010005580" — FDC gtinUpc match key; null for true EAN-13/8. */
  upc12: string | null;
  input: string;
};

export type ParsedScan = NormalizedGtin & {
  /** Present when the code carried GS1 application identifiers. */
  ais: Record<string, string> | null;
  lot: string | null; // AI(10)
  serial: string | null; // AI(21)
  /** AI(17) expiry as ISO date, best-effort ("27-06-01" → "2027-06-01"). */
  expiryDate: string | null;
  /** True iff lot or serial present → BATCH TRACE. A bare GTIN in a QR is still a product trace. */
  isBatch: boolean;
};

const GS = String.fromCharCode(29); // FNC1 group separator as decoded by ZXing

/** GS1 mod-10 check digit over the digits preceding the check position. */
export function computeCheckDigit(payload: string): number {
  let sum = 0;
  // Rightmost payload digit gets weight 3, alternating leftwards.
  for (let i = 0; i < payload.length; i++) {
    const digit = payload.charCodeAt(payload.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 2) return false;
  const expected = computeCheckDigit(digits.slice(0, -1));
  return expected === digits.charCodeAt(digits.length - 1) - 48;
}

export function normalizeGtin(raw: string): NormalizedGtin | null {
  const digits = raw.replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  if (!hasValidCheckDigit(digits)) return null;
  const gtin14 = digits.padStart(14, "0");
  // A GTIN-14 whose first two digits are "00" embeds a UPC-A.
  const upc12 = gtin14.startsWith("00") ? gtin14.slice(2) : null;
  return { gtin14, upc12, input: raw };
}

function fromAis(
  input: string,
  ais: Record<string, string>,
): ParsedScan | null {
  const gtinRaw = ais["01"];
  if (!gtinRaw) return null;
  const normalized = normalizeGtin(gtinRaw);
  if (!normalized) return null;
  const lot = ais["10"] ?? null;
  const serial = ais["21"] ?? null;
  return {
    ...normalized,
    input,
    ais,
    lot,
    serial,
    expiryDate: ais["17"] ? yymmddToIso(ais["17"]) : null,
    isBatch: lot !== null || serial !== null,
  };
}

function yymmddToIso(v: string): string | null {
  if (!/^\d{6}$/.test(v)) return null;
  const yy = v.slice(0, 2);
  const mm = v.slice(2, 4);
  // GS1: DD of "00" means end of month; approximate with 01 for display.
  const dd = v.slice(4, 6) === "00" ? "01" : v.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12) return null;
  return `20${yy}-${mm}-${dd}`;
}

/** "(01)00858010005580(10)L1" → {"01": "00858010005580", "10": "L1"}. */
function parseParenForm(raw: string): Record<string, string> | null {
  const ais: Record<string, string> = {};
  const re = /\((\d{2,4})\)([^(]*)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(raw)) !== null) {
    matched = true;
    ais[m[1]] = m[2].trim();
  }
  return matched ? ais : null;
}

function parseElementString(raw: string): Record<string, string> | null {
  try {
    const result = new GS1Parser({ ignoreInvalidFields: true }).decode(raw);
    if (!result.isValid) return null;
    const ais: Record<string, string> = {};
    for (const el of Object.values(result.data)) {
      if (el?.ai && el.dataString) ais[el.ai] = el.dataString;
    }
    return Object.keys(ais).length > 0 ? ais : null;
  } catch {
    return null;
  }
}

function parseDigitalLink(raw: string): Record<string, string> | null {
  try {
    const dl = DigitalLink(raw);
    if (!dl.isValid()) return null;
    return {
      ...dl.getIdentifier(),
      ...dl.getKeyQualifiers(),
      ...dl.getAttributes(),
    } as Record<string, string>;
  } catch {
    return null;
  }
}

/**
 * Parse anything a scanner or a paste can produce:
 *   - plain UPC/EAN/GTIN digits (with stray spaces/dashes)
 *   - GS1 element strings (with FNC1/GS separators, symbology prefixes)
 *   - human-readable "(01)…(10)…" form
 *   - GS1 Digital Link URIs
 * Returns null for anything that doesn't resolve to a check-digit-valid GTIN.
 */
export function parseScanValue(raw: string): ParsedScan | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // GS1 Digital Link URI.
  if (/^https?:\/\//i.test(trimmed)) {
    const ais = parseDigitalLink(trimmed);
    return ais ? fromAis(trimmed, ais) : null;
  }

  // Human-readable parenthesized AIs.
  if (trimmed.startsWith("(")) {
    const ais = parseParenForm(trimmed);
    return ais ? fromAis(trimmed, ais) : null;
  }

  // Plain GTIN digits (allow grouping whitespace/dashes).
  const digitsOnly = trimmed.replace(/[\s-]/g, "");
  if (/^\d+$/.test(digitsOnly) && [8, 12, 13, 14].includes(digitsOnly.length)) {
    const normalized = normalizeGtin(digitsOnly);
    return normalized
      ? {
          ...normalized,
          input: trimmed,
          ais: null,
          lot: null,
          serial: null,
          expiryDate: null,
          isBatch: false,
        }
      : null;
  }

  // GS1 element string (symbology prefix "]d2"/"]Q3", GS separators, or a
  // longer digit run starting with an AI).
  const stripped = trimmed.replace(/^\][A-Za-z]\d/, "");
  if (stripped.includes(GS) || /^\d{16,}/.test(stripped) || /^01\d{14}/.test(stripped)) {
    const ais = parseElementString(stripped);
    return ais ? fromAis(trimmed, ais) : null;
  }

  return null;
}
