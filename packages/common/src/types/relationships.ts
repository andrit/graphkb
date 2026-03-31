/**
 * @rhizomatic/common — Relationship types and composition rules
 *
 * Defines all edge types in the knowledge graph and the rules
 * for auto-composing transitive relationships.
 */

import type { RelationshipKind, RelationshipSource } from "./semantic.js";

// ---------------------------------------------------------------------------
// Relationship type definitions
// ---------------------------------------------------------------------------

/** Properties carried on a RELATED_TO edge */
export interface RelatedToProperties {
  readonly weight: number; // 0.0 to 1.0
  readonly kind: RelationshipKind;
  readonly source: RelationshipSource;
  readonly createdAt: Date;
}

/** Properties carried on a MENTIONS edge (Chunk → Entity) */
export interface MentionsProperties {
  readonly confidence: number; // 0.0 to 1.0
  readonly createdAt: Date;
}

/** Properties carried on a SIMILAR_TO edge (Chunk → Chunk) */
export interface SimilarToProperties {
  readonly score: number; // cosine similarity
  readonly createdAt: Date;
}

/** Properties carried on an OVERLAPS edge (Topic → Topic) */
export interface OverlapsProperties {
  readonly sharedCount: number;
  readonly createdAt: Date;
}

/** Properties carried on a HAS_CHUNK edge (Document → Chunk) */
export interface HasChunkProperties {
  readonly position: number;
}

/** Properties carried on a FROM_SOURCE edge (Document → Source) */
export interface FromSourceProperties {
  readonly fetchedAt: Date;
}

/** Union of all relationship types for type-safe edge handling */
export type RelationshipType =
  | "HAS_CHUNK"
  | "FROM_SOURCE"
  | "REFERENCES"
  | "MENTIONS"
  | "ABOUT"
  | "NEXT_CHUNK"
  | "SIMILAR_TO"
  | "RELATED_TO"
  | "INSTANCE_OF"
  | "PART_OF"
  | "CONTAINS"
  | "OVERLAPS"
  | "ANNOTATES"
  | "TAGGED";

// ---------------------------------------------------------------------------
// Composition rules
// ---------------------------------------------------------------------------

/**
 * A composition rule defines how two relationship types combine
 * to produce an inferred relationship.
 *
 * Example: if A PART_OF B and B INSTANCE_OF C, then A INSTANCE_OF C.
 *
 * Rules are data, not code — stored in the ontology configuration
 * and editable by the user as patterns emerge.
 */
export interface CompositionRule {
  /** First relationship in the chain (from A to B) */
  readonly first: RelationshipType;
  /** Second relationship in the chain (from B to C) */
  readonly second: RelationshipType;
  /** The inferred relationship type (from A to C) */
  readonly inferred: RelationshipType;
  /** How to compute the inferred weight */
  readonly weightStrategy: WeightStrategy;
  /** Maximum chain depth to prevent runaway inference */
  readonly maxDepth: number;
}

export type WeightStrategy =
  | { readonly _tag: "inherited" }          // weight comes from source edge
  | { readonly _tag: "multiplicative" }     // weight = w1 × w2 (decay)
  | { readonly _tag: "minimum" }            // weight = min(w1, w2)
  | { readonly _tag: "fixed"; readonly value: number }; // constant weight

/** Default composition rules shipped with the system */
export const DEFAULT_COMPOSITION_RULES: ReadonlyArray<CompositionRule> = [
  {
    first: "PART_OF",
    second: "INSTANCE_OF",
    inferred: "INSTANCE_OF",
    weightStrategy: { _tag: "inherited" },
    maxDepth: 3,
  },
  {
    first: "PART_OF",
    second: "PART_OF",
    inferred: "PART_OF",
    weightStrategy: { _tag: "inherited" },
    maxDepth: 5,
  },
  {
    first: "INSTANCE_OF",
    second: "INSTANCE_OF",
    inferred: "INSTANCE_OF",
    weightStrategy: { _tag: "inherited" },
    maxDepth: 3,
  },
  {
    first: "RELATED_TO",
    second: "RELATED_TO",
    inferred: "RELATED_TO",
    weightStrategy: { _tag: "multiplicative" },
    maxDepth: 3,
  },
];
