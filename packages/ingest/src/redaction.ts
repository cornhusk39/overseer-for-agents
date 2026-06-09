// Ingest-time redaction. The SPEC is explicit: raw unscrubbed payloads are
// never persisted, and all ingested telemetry is untrusted. So every string we
// are about to store passes through here first.
//
// Two modes:
//   scrub     (default) keep all attributes, but run regex scrubbers over every
//             string value so emails, phone numbers, and key-shaped tokens are
//             masked before they hit disk.
//   allowlist keep only attributes whose key the operator explicitly listed and
//             drop everything else. Useful when a team knows exactly which
//             attributes are safe and wants to default-deny the rest.
//
// The scrubbers are deliberately conservative about what they match. A missed
// secret is worse than an over-masked value, but over-masking trace ids into
// uselessness is also a real cost, so the key-shaped patterns target concrete
// known shapes rather than "any long string."

import type { RedactionMode } from "./config.js";

export interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

// Order matters a little: more specific key shapes run before the generic JWT
// catch so the replacement label is the most informative one.
export const DEFAULT_RULES: RedactionRule[] = [
  {
    // Local part and domain are length-bounded per the RFC limits, which also
    // keeps the pattern from backtracking quadratically on long junk strings.
    // Input is additionally length-capped before it ever reaches the scrubbers.
    name: "email",
    pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g,
    replacement: "[redacted-email]",
  },
  {
    name: "aws-access-key-id",
    pattern: /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g,
    replacement: "[redacted-aws-key]",
  },
  {
    name: "openai-style-key",
    pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    replacement: "[redacted-api-key]",
  },
  {
    name: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[redacted-slack-token]",
  },
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "[redacted-jwt]",
  },
  {
    // Phone numbers are inherently fuzzy. This targets 10 to 15 digit sequences
    // with common separators and an optional country code, which covers most
    // real numbers without swallowing short ids.
    name: "phone",
    pattern: /\+?\d{1,3}[\s.-]?\(?\d{2,4}\)?(?:[\s.-]?\d{2,4}){2,3}\b/g,
    replacement: "[redacted-phone]",
  },
];

export interface ScrubResult<T> {
  value: T;
  // How many individual replacements were made. Stored as redaction metadata so
  // an operator can see that scrubbing actually ran and how much it touched.
  hits: number;
}

// Scrub a single string. Each rule that matches contributes to the hit count.
export function scrubString(input: string, rules: RedactionRule[] = DEFAULT_RULES): ScrubResult<string> {
  let value = input;
  let hits = 0;
  for (const rule of rules) {
    value = value.replace(rule.pattern, () => {
      hits += 1;
      return rule.replacement;
    });
  }
  return { value, hits };
}

// Recursively scrub any JSON-shaped value. Objects and arrays are walked; only
// strings are rewritten. Numbers, booleans, and null pass through untouched.
export function scrubValue(input: unknown, rules: RedactionRule[] = DEFAULT_RULES): ScrubResult<unknown> {
  if (typeof input === "string") return scrubString(input, rules);
  if (Array.isArray(input)) {
    let hits = 0;
    const value = input.map((item) => {
      const r = scrubValue(item, rules);
      hits += r.hits;
      return r.value;
    });
    return { value, hits };
  }
  if (input && typeof input === "object") {
    let hits = 0;
    const value: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const r = scrubValue(v, rules);
      hits += r.hits;
      value[k] = r.value;
    }
    return { value, hits };
  }
  return { value: input, hits: 0 };
}

export interface RedactionOptions {
  mode: RedactionMode;
  allowlist: string[];
  rules?: RedactionRule[];
}

// Apply the configured redaction to a flattened attribute record. In scrub mode
// every value is walked and masked. In allowlist mode unlisted keys are dropped
// entirely, which is the strongest guarantee: data we never keep cannot leak.
export function redactAttributes(
  attributes: Record<string, unknown>,
  options: RedactionOptions,
): ScrubResult<Record<string, unknown>> {
  const rules = options.rules ?? DEFAULT_RULES;

  if (options.mode === "allowlist") {
    const allow = new Set(options.allowlist);
    const value: Record<string, unknown> = {};
    let hits = 0;
    for (const [k, v] of Object.entries(attributes)) {
      if (allow.has(k)) {
        value[k] = v;
      } else {
        // Count each dropped attribute as a redaction hit for auditing.
        hits += 1;
      }
    }
    return { value, hits };
  }

  const result = scrubValue(attributes, rules) as ScrubResult<Record<string, unknown>>;
  return result;
}
