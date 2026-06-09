// Cost accounting. OTLP carries token counts but not dollars, so Overseer
// derives cost from a per-model price table. Prices are expressed per million
// tokens, which is how providers publish them, split into input (prompt) and
// output (completion) rates.
//
// This table is a reasonable, public-knowledge approximation, not a billing
// source of truth. The point of v1 is relative cost visibility (which agent or
// model is getting expensive), so an entry being a little stale matters less
// than the trend being right. A trace can always override the derived figure by
// sending an explicit cost attribute, which the mapping prefers when present.

export interface ModelPrice {
  // Substring matched against the model id, case-insensitively. The first entry
  // whose key appears in the model id wins, so order from specific to general.
  key: string;
  inputPerMTok: number;
  outputPerMTok: number;
}

// Ordered most specific first. "claude-opus" must come before any shorter
// "claude" style key would, for example.
export const DEFAULT_PRICES: ModelPrice[] = [
  { key: "claude-opus", inputPerMTok: 15, outputPerMTok: 75 },
  { key: "claude-sonnet", inputPerMTok: 3, outputPerMTok: 15 },
  { key: "claude-haiku", inputPerMTok: 0.8, outputPerMTok: 4 },
  { key: "gpt-4o-mini", inputPerMTok: 0.15, outputPerMTok: 0.6 },
  { key: "gpt-4o", inputPerMTok: 2.5, outputPerMTok: 10 },
  { key: "gpt-4", inputPerMTok: 30, outputPerMTok: 60 },
  { key: "gpt-3.5", inputPerMTok: 0.5, outputPerMTok: 1.5 },
];

export function findPrice(model: string, table: ModelPrice[] = DEFAULT_PRICES): ModelPrice | null {
  const m = model.toLowerCase();
  for (const price of table) {
    if (m.includes(price.key)) return price;
  }
  return null;
}

// Derive cost in US dollars from a model id and token counts. Returns null when
// the model is unknown to the table, so callers can distinguish "we priced it
// at zero" from "we could not price it." Missing token counts count as zero.
export function computeCost(
  model: string | null,
  inputTokens: number | null,
  outputTokens: number | null,
  table: ModelPrice[] = DEFAULT_PRICES,
): number | null {
  if (!model) return null;
  const price = findPrice(model, table);
  if (!price) return null;
  const inTok = inputTokens ?? 0;
  const outTok = outputTokens ?? 0;
  const cost = (inTok / 1_000_000) * price.inputPerMTok + (outTok / 1_000_000) * price.outputPerMTok;
  // Round to a tenth of a cent's thousandth so floating point noise does not
  // leak into stored values; six decimals is plenty for per-call costs.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
