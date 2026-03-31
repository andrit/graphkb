/**
 * @rhizomatic/common
 *
 * Shared types, errors, configuration, and utilities for the
 * Rhizomatic knowledge base system. Every other package depends
 * on this one. It has zero external dependencies beyond Effect.
 */

// Re-export core Effect utilities for consistency across packages
export { Effect, pipe, Layer, Context, Schema } from "effect";

// Types — the shared vocabulary of the system
export type * from "./types/index.js";
export { DEFAULT_COMPOSITION_RULES } from "./types/index.js";

// Errors — tagged unions for the Effect error channel
export * from "./errors/index.js";

// Configuration — typed config schemas
export * from "./config/index.js";

// Utilities — pure helper functions
export * from "./utils/index.js";
