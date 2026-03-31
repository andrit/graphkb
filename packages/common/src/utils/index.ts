/**
 * @rhizomatic/common — Utility functions
 *
 * Pure, composable helper functions. No side effects, no dependencies
 * beyond the standard library and Effect.
 */

import { createHash, randomUUID } from "node:crypto";

/** Generate a UUID v4 with an optional prefix for readability */
export const generateId = (prefix?: string): string => {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
};

/** Compute SHA-256 hash of content (for file deduplication) */
export const hashContent = (content: Buffer | string): string => {
  const hash = createHash("sha256");
  hash.update(content);
  return `sha256:${hash.digest("hex")}`;
};

/** Slugify a string for use as a tag name or URL segment */
export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Clamp a number to a range.
 * Used for weights, confidence scores, trust levels (all 0-1).
 */
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Clamp to [0, 1] — the standard weight/confidence range */
export const clampUnit = (value: number): number => clamp(value, 0, 1);

/**
 * Compute the decayed weight for composed RELATED_TO edges.
 * weight_AC = weight_AB × weight_BC
 */
export const decayWeight = (w1: number, w2: number): number =>
  clampUnit(w1 * w2);

/** Get the current timestamp as a Date */
export const now = (): Date => new Date();

/**
 * Deduplicate an array by a key function.
 * Returns items in first-seen order.
 */
export const deduplicateBy = <T>(
  items: ReadonlyArray<T>,
  keyFn: (item: T) => string,
): ReadonlyArray<T> => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
};
