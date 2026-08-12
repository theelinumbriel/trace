/**
 * Deterministic company-name canonicalization for alias matching
 * ("Oatly AB" ≡ "OATLY, Inc." ≡ "Oatly Group"). Pure TS so it behaves
 * identically on Neon and PGlite (no unaccent/pg_trgm extension needed).
 */

const LEGAL_SUFFIXES =
  /\b(incorporated|inc|corp(oration)?|co|company|llc|ltd|limited|gmbh|ab|bv|b\.v|nv|sa|s\.a|plc|group|holdings?|international|foods?|brands?)\b/g;

export function canonicalKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.,'’&()]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
