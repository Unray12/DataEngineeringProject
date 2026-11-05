/**
 * Plain-language glossary for /quality. The technical lineage terms are
 * allowed on this page only (WEBAPP A7); everywhere else the UI says
 * "records" and "readings".
 */

export type GlossaryEntry = {
  term: string;
  label: string;
  plain: string;
  detail?: string;
};

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: "valid",
    label: "Valid",
    plain: "A reading that passed every check and is safe to use.",
    detail: "The value arrived in range, was not a duplicate, and was not quarantined.",
  },
  {
    term: "duplicate",
    label: "Duplicate",
    plain: "The same reading arrived more than once, so only one copy is kept.",
    detail: "Retries and replays can produce duplicates; they are counted here instead of being shown twice.",
  },
  {
    term: "outOfRange",
    label: "Out of range",
    plain: "The number is outside what this sensor can physically measure, or outside the crop target.",
    detail: "These readings are visible for investigation but are not treated as normal values.",
  },
  {
    term: "quarantined",
    label: "Quarantined",
    plain: "The record was too broken to trust and was set aside instead of being shown as real.",
    detail: "Missing fields, malformed values and schema failures end up here.",
  },
  {
    term: "suspect",
    label: "Suspect",
    plain: "A value that looks unusual but is still shown, marked so you know not to trust it blindly.",
    detail: "The near real-time view marks suspect points instead of hiding them.",
  },
  {
    term: "lineage",
    label: "Lineage",
    plain: "The trail that shows which batch and stream position a record came from.",
    detail: "Technical details: batch id, topic, partition, offset and ingest time.",
  },
];

export const GLOSSARY_BY_TERM = new Map(GLOSSARY.map((entry) => [entry.term, entry]));

export const QUALITY_TERM_LABELS: Record<string, string> = {
  valid: "Valid",
  duplicate: "Duplicate",
  outOfRange: "Out of range",
  quarantined: "Quarantined",
  suspect: "Suspect",
  lineage: "Lineage",
};

export const QUALITY_COLORS: Record<"valid" | "duplicate" | "outOfRange" | "quarantined", string> = {
  valid: "#10b981",
  duplicate: "#3b82f6",
  outOfRange: "#f59e0b",
  quarantined: "#f43f5e",
};
