/**
 * @rhizomatic/common — Graph node types (semantic layer)
 *
 * These types represent discovered and curated knowledge in the graph.
 * Entities emerge from NLP extraction. Topics from clustering or curation.
 * Notes and Tags are user-created.
 */

/** How a RELATED_TO edge was created */
export type RelationshipSource = "auto" | "manual" | "inferred";

/** The kind of RELATED_TO connection */
export type RelationshipKind =
  | "co-occurrence"
  | "causal"
  | "hierarchical"
  | "analogical"
  | "institutional"
  | "user-defined";

/** How a Topic was created */
export type TopicOrigin = "auto" | "manual";

/**
 * :Entity — A named thing in the knowledge graph.
 * The heart of the rhizome. Kind is an open string, not a fixed enum,
 * because the system cannot predict every type of entity across
 * mixed knowledge domains.
 */
export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly kind: string; // open-ended: person, org, tech, concept, place...
  readonly description: string | undefined;
  readonly firstSeen: Date;
  readonly mentionCount: number;
}

/**
 * :Topic — An emergent cluster of related entities and chunks.
 * The natural unit of wiki browsing. Can be auto-generated from
 * entity clustering or manually created by the user.
 */
export interface Topic {
  readonly id: string;
  readonly name: string;
  readonly summary: string | undefined;
  readonly origin: TopicOrigin;
}

/**
 * :Note — User-authored freeform text attached to any node.
 * Your voice in the graph. Notes are first-class citizens —
 * indexed in Elasticsearch, tagged, and graph-connected.
 */
export interface Note {
  readonly id: string;
  readonly content: string; // markdown
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * :Tag — Lightweight flat label applied to any node.
 * Unlike Topics (which have structure), Tags are just strings
 * for personal organization.
 */
export interface Tag {
  readonly id: string;
  readonly name: string; // unique, lowercase, slugified
  readonly color: string | undefined;
}
