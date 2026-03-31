/**
 * @rhizomatic/graph
 *
 * Neo4j client wrapped in Effect Layers. Provides typed Cypher query
 * builders and composition rule evaluation. The graph package is the
 * primary interface to the knowledge graph — all reads and writes
 * go through here.
 */

import { Context, Effect, Layer, pipe } from "effect";
import neo4j, {
  type Record as Neo4jRecord,
} from "neo4j-driver";
import type {
  Neo4jConfig,
  Entity,
  Document,
  Chunk,
  CompositionRule,
  RelatedToProperties,
} from "@rhizomatic/common";
import { GraphError } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Service definition (Effect Context.Tag)
// ---------------------------------------------------------------------------

export class GraphClient extends Context.Tag("GraphClient")<
  GraphClient,
  {
    /** Run a raw Cypher query and return records */
    readonly query: (
      cypher: string,
      params?: Record<string, unknown>,
    ) => Effect.Effect<ReadonlyArray<Neo4jRecord>, GraphError>;

    /** Run a Cypher write query (CREATE, MERGE, SET, DELETE) */
    readonly write: (
      cypher: string,
      params?: Record<string, unknown>,
    ) => Effect.Effect<void, GraphError>;

    /** Close the driver connection */
    readonly close: () => Effect.Effect<void, GraphError>;
  }
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const GraphClientLive = (config: Neo4jConfig): Layer.Layer<GraphClient> =>
  Layer.succeed(GraphClient, {
    query: (cypher, params = {}) =>
      Effect.tryPromise({
        try: async () => {
          const driver = neo4j.driver(
            config.uri,
            neo4j.auth.basic(config.user, config.password),
          );
          const session = driver.session();
          try {
            const result = await session.run(cypher, params);
            return result.records;
          } finally {
            await session.close();
            await driver.close();
          }
        },
        catch: (error) =>
          new GraphError({
            message: `Cypher query failed: ${String(error)}`,
            query: cypher,
            cause: error,
          }),
      }),

    write: (cypher, params = {}) =>
      Effect.tryPromise({
        try: async () => {
          const driver = neo4j.driver(
            config.uri,
            neo4j.auth.basic(config.user, config.password),
          );
          const session = driver.session();
          try {
            await session.run(cypher, params);
          } finally {
            await session.close();
            await driver.close();
          }
        },
        catch: (error) =>
          new GraphError({
            message: `Cypher write failed: ${String(error)}`,
            query: cypher,
            cause: error,
          }),
      }),

    close: () => Effect.void,
  });

// ---------------------------------------------------------------------------
// Query builders (pure functions returning Cypher strings + params)
// ---------------------------------------------------------------------------

export const queries = {
  /** Initialize the schema: constraints and indexes */
  initSchema: (): { cypher: string; params: Record<string, unknown> }[] => [
    { cypher: "CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT chunk_id IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT source_id IF NOT EXISTS FOR (s:Source) REQUIRE s.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT entity_name IF NOT EXISTS FOR (e:Entity) REQUIRE e.name IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT topic_id IF NOT EXISTS FOR (t:Topic) REQUIRE t.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT note_id IF NOT EXISTS FOR (n:Note) REQUIRE n.id IS UNIQUE", params: {} },
    { cypher: "CREATE CONSTRAINT tag_name IF NOT EXISTS FOR (t:Tag) REQUIRE t.name IS UNIQUE", params: {} },
    { cypher: "CREATE INDEX doc_content_type IF NOT EXISTS FOR (d:Document) ON (d.contentType)", params: {} },
    { cypher: "CREATE INDEX doc_ingested IF NOT EXISTS FOR (d:Document) ON (d.ingestedAt)", params: {} },
    { cypher: "CREATE INDEX entity_kind IF NOT EXISTS FOR (e:Entity) ON (e.kind)", params: {} },
    { cypher: "CREATE INDEX entity_mention_count IF NOT EXISTS FOR (e:Entity) ON (e.mentionCount)", params: {} },
    { cypher: "CREATE INDEX chunk_position IF NOT EXISTS FOR (c:Chunk) ON (c.position)", params: {} },
    { cypher: "CREATE INDEX source_kind IF NOT EXISTS FOR (s:Source) ON (s.kind)", params: {} },
    { cypher: "CREATE FULLTEXT INDEX entity_search IF NOT EXISTS FOR (e:Entity) ON EACH [e.name, e.description]", params: {} },
  ],

  /** Create a Document node */
  createDocument: (doc: Document) => ({
    cypher: `
      CREATE (d:Document {
        id: $id, title: $title, contentType: $contentType,
        fileHash: $fileHash, ingestedAt: datetime($ingestedAt),
        summary: $summary, metadata: $metadata
      }) RETURN d`,
    params: {
      ...doc,
      ingestedAt: doc.ingestedAt.toISOString(),
      metadata: JSON.stringify(doc.metadata),
    },
  }),

  /** Create a Chunk node and link to its Document */
  createChunk: (chunk: Chunk) => ({
    cypher: `
      MATCH (d:Document {id: $documentId})
      CREATE (c:Chunk {
        id: $id, content: $content, position: $position,
        heading: $heading, charCount: $charCount
      })
      CREATE (d)-[:HAS_CHUNK {position: $position}]->(c)
      RETURN c`,
    params: chunk,
  }),

  /** Merge an Entity (create if not exists, update if found) */
  mergeEntity: (entity: Entity) => ({
    cypher: `
      MERGE (e:Entity {name: $name})
      ON CREATE SET
        e.id = $id, e.aliases = $aliases, e.kind = $kind,
        e.description = $description, e.firstSeen = datetime($firstSeen),
        e.mentionCount = 1
      ON MATCH SET
        e.mentionCount = e.mentionCount + 1,
        e.aliases = [x IN e.aliases + $aliases WHERE x IS NOT NULL | x]
      RETURN e`,
    params: {
      ...entity,
      firstSeen: entity.firstSeen.toISOString(),
    },
  }),

  /** Create a MENTIONS edge from Chunk to Entity */
  createMention: (chunkId: string, entityName: string, confidence: number) => ({
    cypher: `
      MATCH (c:Chunk {id: $chunkId})
      MATCH (e:Entity {name: $entityName})
      MERGE (c)-[r:MENTIONS]->(e)
      ON CREATE SET r.confidence = $confidence, r.createdAt = datetime()
      RETURN r`,
    params: { chunkId, entityName, confidence },
  }),

  /** Create or update a RELATED_TO edge between entities */
  relateEntities: (
    fromName: string,
    toName: string,
    props: RelatedToProperties,
  ) => ({
    cypher: `
      MATCH (a:Entity {name: $fromName})
      MATCH (b:Entity {name: $toName})
      MERGE (a)-[r:RELATED_TO]->(b)
      SET r.weight = $weight, r.kind = $kind,
          r.source = $source, r.createdAt = datetime($createdAt)
      RETURN r`,
    params: {
      fromName,
      toName,
      ...props,
      createdAt: props.createdAt.toISOString(),
    },
  }),

  /** Find all entities connected to a given entity (1-hop neighborhood) */
  entityNeighborhood: (entityName: string) => ({
    cypher: `
      MATCH (e:Entity {name: $name})-[r]-(connected)
      RETURN e, type(r) AS relType, properties(r) AS relProps, connected
      ORDER BY r.weight DESC`,
    params: { name: entityName },
  }),

  /** Find the shortest path between two entities */
  shortestPath: (fromName: string, toName: string, maxHops: number = 4) => ({
    cypher: `
      MATCH path = shortestPath(
        (a:Entity {name: $fromName})-[*..${maxHops}]-(b:Entity {name: $toName})
      )
      RETURN path`,
    params: { fromName, toName },
  }),

  /** Find composed relationships (lazy evaluation of composition rules) */
  composedRelationships: (
    entityName: string,
    rule: CompositionRule,
  ) => ({
    cypher: `
      MATCH (a:Entity {name: $name})-[r1:${rule.first}]->(b:Entity)-[r2:${rule.second}]->(c:Entity)
      WHERE a <> c AND NOT (a)-[:${rule.inferred}]->(c)
      RETURN a.name AS from, c.name AS to, b.name AS via,
             r1.weight AS w1, r2.weight AS w2`,
    params: { name: entityName },
  }),

  /** Find documents bridged by shared entities */
  documentBridges: () => ({
    cypher: `
      MATCH (d1:Document)-[:HAS_CHUNK]->(:Chunk)-[:MENTIONS]->(e:Entity)
            <-[:MENTIONS]-(:Chunk)<-[:HAS_CHUNK]-(d2:Document)
      WHERE id(d1) < id(d2)
      RETURN d1.title AS doc1, d2.title AS doc2,
             collect(DISTINCT e.name) AS sharedEntities
      ORDER BY size(sharedEntities) DESC`,
    params: {},
  }),

  /** Top hub entities by connection count */
  hubEntities: (limit: number = 20) => ({
    cypher: `
      MATCH (e:Entity)-[r:RELATED_TO]-()
      RETURN e.name, e.kind, count(r) AS connections
      ORDER BY connections DESC LIMIT $limit`,
    params: { limit },
  }),
} as const;

// ---------------------------------------------------------------------------
// Schema initialization helper
// ---------------------------------------------------------------------------

/** Run all schema initialization queries */
export const initializeSchema = pipe(
  GraphClient,
  Effect.flatMap((client) =>
    Effect.forEach(queries.initSchema(), ({ cypher }) =>
      client.write(cypher),
    ),
  ),
  Effect.map(() => void 0),
);
