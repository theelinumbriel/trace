import { describe, expect, it } from "vitest";
import { scoreClaim, type EvidenceInput } from "./confidence";

const AS_OF = new Date("2026-08-13T00:00:00Z");

const ev = (overrides: Partial<EvidenceInput>): EvidenceInput => ({
  sourceType: "manufacturer_disclosure",
  publicationDate: "2026-01-01",
  sourceDomain: "example.com",
  specificity: "exact_product",
  ...overrides,
});

describe("scoreClaim", () => {
  it("no evidence → unknown, 0", () => {
    const r = scoreClaim([], 0, AS_OF);
    expect(r.status).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("single recent manufacturer doc → documented, in 70–94", () => {
    const r = scoreClaim([ev({})], 0, AS_OF);
    expect(r.status).toBe("documented");
    expect(r.confidence).toBeGreaterThanOrEqual(70);
    expect(r.confidence).toBeLessThanOrEqual(94);
  });

  it("two independent primary domains → verified ≥85, capped ≤94", () => {
    const r = scoreClaim(
      [ev({ sourceDomain: "a.com" }), ev({ sourceDomain: "b.com" })],
      0,
      AS_OF,
    );
    expect(r.status).toBe("verified");
    expect(r.confidence).toBeGreaterThanOrEqual(85);
    expect(r.confidence).toBeLessThanOrEqual(94);
  });

  it("same domain never stacks", () => {
    const one = scoreClaim([ev({})], 0, AS_OF);
    const two = scoreClaim([ev({}), ev({})], 0, AS_OF);
    expect(two.confidence).toBe(one.confidence);
    expect(two.status).toBe(one.status);
  });

  it("direct traceability → verified, can exceed 94", () => {
    const r = scoreClaim(
      [
        ev({
          sourceType: "traceability_system",
          specificity: "exact_item",
        }),
      ],
      0,
      AS_OF,
    );
    expect(r.status).toBe("verified");
    expect(r.confidence).toBeGreaterThanOrEqual(95);
  });

  it("documentary-only can never emit ≥95", () => {
    const domains = ["a.com", "b.com", "c.com", "d.com", "e.com"];
    const r = scoreClaim(
      domains.map((d) => ev({ sourceDomain: d })),
      0,
      AS_OF,
    );
    expect(r.confidence).toBeLessThanOrEqual(94);
  });

  it("one inferred hop lands in the inferred band (spec texture ~78)", () => {
    const r = scoreClaim(
      [
        ev({ sourceDomain: "a.com" }),
        ev({ sourceDomain: "b.com", sourceType: "customs_record" }),
      ],
      1,
      AS_OF,
    );
    expect(r.status).toBe("inferred");
    expect(r.confidence).toBeGreaterThanOrEqual(70);
    expect(r.confidence).toBeLessThanOrEqual(84);
  });

  it("depth penalty is monotonic", () => {
    const base = [ev({})];
    const d0 = scoreClaim(base, 0, AS_OF).confidence;
    const d1 = scoreClaim(base, 1, AS_OF).confidence;
    const d2 = scoreClaim(base, 2, AS_OF).confidence;
    expect(d1).toBeLessThan(d0);
    expect(d2).toBeLessThan(d1);
  });

  it("adding evidence never lowers confidence", () => {
    const one = scoreClaim([ev({ sourceDomain: "a.com" })], 0, AS_OF);
    const more = scoreClaim(
      [
        ev({ sourceDomain: "a.com" }),
        ev({ sourceDomain: "b.com", sourceType: "news_media" }),
      ],
      0,
      AS_OF,
    );
    expect(more.confidence).toBeGreaterThanOrEqual(one.confidence);
  });

  it("recency floor keeps old evidence meaningful", () => {
    const r = scoreClaim([ev({ publicationDate: "2016-01-01" })], 0, AS_OF);
    expect(r.confidence).toBeGreaterThanOrEqual(45);
    // and specifically the floor: base .86 × .6 × .95 ≈ .49
    expect(r.breakdown.perEvidence[0].recency).toBe(0.6);
  });

  it("missing publication date uses fixed 0.8 factor", () => {
    const r = scoreClaim([ev({ publicationDate: null })], 0, AS_OF);
    expect(r.breakdown.perEvidence[0].recency).toBe(0.8);
  });

  it("open-database-only support is inference-grade and <50 excludable", () => {
    const r = scoreClaim(
      [
        ev({
          sourceType: "product_database",
          publicationDate: null,
          specificity: "exact_product",
        }),
      ],
      0,
      AS_OF,
    );
    expect(r.status).toBe("inferred");
    expect(r.confidence).toBeLessThan(50);
  });

  it("is deterministic", () => {
    const input = [
      ev({ sourceDomain: "a.com" }),
      ev({ sourceDomain: "b.com", sourceType: "government_record" }),
    ];
    const a = JSON.stringify(scoreClaim(input, 1, AS_OF));
    const b = JSON.stringify(scoreClaim(input, 1, AS_OF));
    expect(a).toBe(b);
  });

  it("status always satisfies the DB band constraint", () => {
    const cases: [EvidenceInput[], number][] = [
      [[], 0],
      [[ev({})], 0],
      [[ev({})], 1],
      [[ev({})], 3],
      [[ev({ sourceType: "traceability_system", specificity: "exact_item" })], 0],
      [[ev({ sourceType: "retailer_listing", publicationDate: null })], 0],
      [[ev({ sourceDomain: "a.com" }), ev({ sourceDomain: "b.com" })], 0],
    ];
    for (const [evidence, depth] of cases) {
      const { status, confidence } = scoreClaim(evidence, depth, AS_OF);
      const bands = {
        verified: [85, 100],
        documented: [70, 94],
        inferred: [1, 84],
        unknown: [0, 0],
      } as const;
      const [lo, hi] = bands[status];
      expect(confidence).toBeGreaterThanOrEqual(lo);
      expect(confidence).toBeLessThanOrEqual(hi);
    }
  });
});
