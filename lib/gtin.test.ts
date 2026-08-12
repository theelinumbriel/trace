import { describe, expect, it } from "vitest";
import {
  computeCheckDigit,
  hasValidCheckDigit,
  normalizeGtin,
  parseScanValue,
} from "./gtin";

const GS = String.fromCharCode(29);

// All seven seed UPCs — real, live-verified codes with valid check digits.
const SEED_UPCS = [
  "663505002063", // Counter Culture Big Trouble
  "858010005580", // Tony's Chocolonely Milk 32%
  "850687110505", // California Olive Ranch 100% CA
  "039978001542", // Bob's Red Mill Rolled Oats
  "190646641016", // Oatly Original 64oz
  "888336749295", // Patagonia P-6 Tee
  "078742351926", // Great Value Purified Water
];

describe("computeCheckDigit", () => {
  it("computes the classic UPC-A example", () => {
    expect(computeCheckDigit("03600029145")).toBe(2); // 036000291452
  });
  it("computes EAN-13 example", () => {
    expect(computeCheckDigit("400638133393")).toBe(1); // 4006381333931
  });
});

describe("hasValidCheckDigit", () => {
  it.each(SEED_UPCS)("accepts seed UPC %s", (upc) => {
    expect(hasValidCheckDigit(upc)).toBe(true);
  });
  it("rejects a corrupted digit", () => {
    expect(hasValidCheckDigit("858010005581")).toBe(false);
  });
});

describe("normalizeGtin", () => {
  it("zero-pads UPC-A to GTIN-14 and derives upc12", () => {
    expect(normalizeGtin("858010005580")).toEqual({
      gtin14: "00858010005580",
      upc12: "858010005580",
      input: "858010005580",
    });
  });
  it("handles EAN-13 (no upc12)", () => {
    const r = normalizeGtin("3017624010701"); // Nutella, real EAN-13
    expect(r?.gtin14).toBe("03017624010701");
    expect(r?.upc12).toBeNull();
  });
  it("handles EAN-8", () => {
    const r = normalizeGtin("96385074");
    expect(r?.gtin14).toBe("00000096385074");
  });
  it("strips grouping characters", () => {
    expect(normalizeGtin("0 858010 005580")?.gtin14).toBe("00858010005580");
  });
  it("rejects bad check digits and bad lengths", () => {
    expect(normalizeGtin("858010005581")).toBeNull();
    expect(normalizeGtin("12345")).toBeNull();
    expect(normalizeGtin("")).toBeNull();
  });
});

describe("parseScanValue", () => {
  it("plain UPC → product trace", () => {
    const r = parseScanValue("858010005580");
    expect(r?.gtin14).toBe("00858010005580");
    expect(r?.isBatch).toBe(false);
    expect(r?.ais).toBeNull();
  });

  it("GS1 element string with GS separators → batch trace", () => {
    // The demo DataMatrix payload: (01)(10)lot(17)expiry with GS after
    // the variable-length lot.
    const raw = `010085801000558010TRACE-DEMO${GS}17270601`;
    const r = parseScanValue(raw);
    expect(r?.gtin14).toBe("00858010005580");
    expect(r?.lot).toBe("TRACE-DEMO");
    expect(r?.expiryDate).toBe("2027-06-01");
    expect(r?.isBatch).toBe(true);
  });

  it("symbology-prefixed element string survives", () => {
    const raw = `]d2010085801000558010TRACE-DEMO${GS}17270601`;
    expect(parseScanValue(raw)?.lot).toBe("TRACE-DEMO");
  });

  it("human-readable parenthesized form", () => {
    const r = parseScanValue("(01)00858010005580(10)TRACE-DEMO(17)270601");
    expect(r?.gtin14).toBe("00858010005580");
    expect(r?.lot).toBe("TRACE-DEMO");
    expect(r?.isBatch).toBe(true);
  });

  it("GS1 Digital Link URI", () => {
    const r = parseScanValue(
      "https://id.gs1.org/01/00858010005580/10/TRACE-DEMO?17=270601",
    );
    expect(r?.gtin14).toBe("00858010005580");
    expect(r?.lot).toBe("TRACE-DEMO");
    expect(r?.expiryDate).toBe("2027-06-01");
  });

  it("bare GTIN inside a QR (AI 01 only) is still a product trace", () => {
    const r = parseScanValue("(01)00858010005580");
    expect(r?.isBatch).toBe(false);
  });

  it("rejects garbage and invalid check digits", () => {
    expect(parseScanValue("hello world")).toBeNull();
    expect(parseScanValue("858010005581")).toBeNull();
    expect(parseScanValue("(01)00858010005581(10)L1")).toBeNull();
  });
});
