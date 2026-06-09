// Trace and span id generation. OTLP ids are random hex: 16 bytes for a trace
// id, 8 bytes for a span id. We use the crypto RNG rather than Math.random so
// ids do not collide across a busy agent fleet.

import { randomBytes } from "node:crypto";

export type RandomHex = (bytes: number) => string;

const cryptoHex: RandomHex = (bytes) => randomBytes(bytes).toString("hex");

export function newTraceId(randomHex: RandomHex = cryptoHex): string {
  return randomHex(16);
}

export function newSpanId(randomHex: RandomHex = cryptoHex): string {
  return randomHex(8);
}
