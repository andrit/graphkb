/**
 * @rhizomatic/api
 *
 * The API gateway. GraphQL for graph queries, REST for file uploads.
 * Built with Fastify + Mercurius.
 */

import { Effect } from "effect";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import mercurius from "mercurius";
import type { RhizomaticConfig } from "@rhizomatic/common";
import { GraphClient, queries } from "@rhizomatic/graph";
import { SearchClient, INDEXES } from "@rhizomatic/search";
import { FileStorage } from "@rhizomatic/storage";
import { runIngestionPipeline, TikaClient } from "@rhizomatic/ingestion";

// ---------------------------------------------------------------------------
// GraphQL schema
// ---------------------------------------------------------------------------

export const schema = `
  type Query {
    health: HealthStatus!
    document(id: ID!): Document
    documents(limit: Int): [Document!]!
    entity(name: String!): Entity
    entities(limit: Int): [EntitySummary!]!
    search(query: String!, limit: Int): [SearchResult!]!
    entityNeighborhood(name: String!): [Connection!]!
    hubEntities(limit: Int): [EntitySummary!]!
    documentBridges: [DocumentBridge!]!
  }

  type HealthStatus {
    api: Boolean!
    neo4j: Boolean!
    elasticsearch: Boolean!
    tika: Boolean!
  }

  type Document {
    id: ID!
    title: String!
    contentType: String!
    ingestedAt: String!
    summary: String
    metadata: String
    chunks: [Chunk!]!
    entityCount: Int!
  }

  type Chunk {
    id: ID!
    content: String!
    position: Int!
    heading: String
    entities: [MentionedEntity!]!
  }

  type MentionedEntity {
    name: String!
    kind: String!
    confidence: Float!
  }

  type Entity {
    id: ID!
    name: String!
    kind: String!
    description: String
    aliases: [String!]!
    mentionCount: Int!
    relatedEntities: [Connection!]!
    mentioningDocuments: [Document!]!
  }

  type Connection {
    entity: EntitySummary!
    relationshipType: String!
    weight: Float
    kind: String
  }

  type EntitySummary {
    name: String!
    kind: String!
    connections: Int!
    mentionCount: Int!
  }

  type SearchResult {
    id: ID!
    title: String
    content: String!
    score: Float!
    type: String!
  }

  type DocumentBridge {
    doc1: String!
    doc2: String!
    sharedEntities: [String!]!
  }

  type Mutation {
    ingestFile(fileName: String!, contentType: String!): IngestResult!
  }

  type IngestResult {
    documentId: ID!
    title: String!
    chunkCount: Int!
    entityCount: Int!
    relationshipCount: Int!
    contentType: String!
  }
`;

// ---------------------------------------------------------------------------
// GraphQL resolvers
// ---------------------------------------------------------------------------

const buildResolvers = (
  graphClient: GraphClient["Type"],
  searchClient: SearchClient["Type"],
  tikaClient: TikaClient["Type"],
) => ({
  Query: {
    health: async () => {
      let neo4jOk = false;
      let esOk = false;
      let tikaOk = false;
      try {
        await Effect.runPromise(graphClient.query("RETURN 1 AS ok"));
        neo4jOk = true;
      } catch { /* */ }
      try {
        const status = await Effect.runPromise(searchClient.health());
        esOk = status === "green" || status === "yellow";
      } catch { /* */ }
      try {
        tikaOk = await Effect.runPromise(tikaClient.health());
      } catch { /* */ }
      return { api: true, neo4j: neo4jOk, elasticsearch: esOk, tika: tikaOk };
    },

    documents: async (_: unknown, { limit = 20 }: { limit?: number }) => {
      const records = await Effect.runPromise(
        graphClient.query(
          `MATCH (d:Document)
           OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:Chunk)-[:MENTIONS]->(e:Entity)
           RETURN d, count(DISTINCT e) AS entityCount
           ORDER BY d.ingestedAt DESC LIMIT $limit`,
          { limit },
        ),
      );
      return records.map((r) => ({
        ...recordToDoc(r.get("d")),
        entityCount: (r.get("entityCount") as { low?: number })?.low ?? r.get("entityCount") ?? 0,
      }));
    },

    document: async (_: unknown, { id }: { id: string }) => {
      const records = await Effect.runPromise(
        graphClient.query(
          `MATCH (d:Document {id: $id})
           OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
           OPTIONAL MATCH (c)-[m:MENTIONS]->(e:Entity)
           WITH d, c, collect({name: e.name, kind: e.kind, confidence: m.confidence}) AS entities
           ORDER BY c.position
           RETURN d,
                  collect({id: c.id, content: c.content, position: c.position, heading: c.heading, entities: entities}) AS chunks`,
          { id },
        ),
      );
      if (records.length === 0) return null;
      const r = records[0];
      const doc = recordToDoc(r.get("d"));
      const chunks = (r.get("chunks") as any[]).filter((c: any) => c.id != null);
      return {
        ...doc,
        chunks: chunks.map((c: any) => ({
          ...c,
          position: c.position?.low ?? c.position,
          entities: (c.entities ?? []).filter((e: any) => e.name != null),
        })),
        entityCount: new Set(
          chunks.flatMap((c: any) =>
            (c.entities ?? []).filter((e: any) => e.name != null).map((e: any) => e.name),
          ),
        ).size,
      };
    },

    entity: async (_: unknown, { name }: { name: string }) => {
      const records = await Effect.runPromise(
        graphClient.query(
          `MATCH (e:Entity {name: $name})
           OPTIONAL MATCH (e)-[r:RELATED_TO]-(connected:Entity)
           WITH e,
                collect({
                  entity: {name: connected.name, kind: connected.kind, connections: 0, mentionCount: connected.mentionCount},
                  relationshipType: "RELATED_TO",
                  weight: r.weight,
                  kind: r.kind
                }) AS related
           OPTIONAL MATCH (d:Document)-[:HAS_CHUNK]->(c:Chunk)-[:MENTIONS]->(e)
           RETURN e, related, collect(DISTINCT d) AS docs`,
          { name },
        ),
      );
      if (records.length === 0) return null;
      const r = records[0];
      const entity = r.get("e").properties;
      return {
        ...entity,
        mentionCount: entity.mentionCount?.low ?? entity.mentionCount ?? 0,
        aliases: entity.aliases ?? [],
        relatedEntities: (r.get("related") as any[]).filter(
          (c: any) => c.entity?.name != null,
        ),
        mentioningDocuments: (r.get("docs") as any[])
          .filter((d: any) => d?.properties?.id)
          .map((d: any) => recordToDoc(d)),
      };
    },

    entities: async (_: unknown, { limit = 50 }: { limit?: number }) => {
      const records = await Effect.runPromise(
        graphClient.query(
          `MATCH (e:Entity)
           OPTIONAL MATCH (e)-[r:RELATED_TO]-()
           RETURN e.name AS name, e.kind AS kind,
                  count(r) AS connections, e.mentionCount AS mentionCount
           ORDER BY connections DESC, mentionCount DESC
           LIMIT $limit`,
          { limit },
        ),
      );
      return records.map((r) => ({
        name: r.get("name"),
        kind: r.get("kind"),
        connections: (r.get("connections") as any)?.low ?? r.get("connections") ?? 0,
        mentionCount: (r.get("mentionCount") as any)?.low ?? r.get("mentionCount") ?? 0,
      }));
    },

    search: async (
      _: unknown,
      { query, limit = 10 }: { query: string; limit?: number },
    ) => {
      // Search across all indexes
      const [docResults, chunkResults, entityResults] = await Promise.all([
        Effect.runPromise(
          searchClient.search(INDEXES.documents, { multi_match: { query, fields: ["title", "summary"] } }, limit),
        ).catch(() => []),
        Effect.runPromise(
          searchClient.search(INDEXES.chunks, { match: { content: query } }, limit),
        ).catch(() => []),
        Effect.runPromise(
          searchClient.search(INDEXES.entities, { multi_match: { query, fields: ["name", "aliases", "description"] } }, limit),
        ).catch(() => []),
      ]);

      const results = [
        ...docResults.map((r: any) => ({
          id: r.id ?? r._id,
          title: r.title,
          content: r.summary ?? r.title ?? "",
          score: r._score ?? 0,
          type: "document",
        })),
        ...chunkResults.map((r: any) => ({
          id: r.id ?? r._id,
          title: r.heading ?? null,
          content: r.content?.slice(0, 200) ?? "",
          score: r._score ?? 0,
          type: "chunk",
        })),
        ...entityResults.map((r: any) => ({
          id: r.id ?? r._id,
          title: r.name,
          content: r.name ?? "",
          score: r._score ?? 0,
          type: "entity",
        })),
      ];

      // Sort by score descending, take top results
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, limit);
    },

    entityNeighborhood: async (_: unknown, { name }: { name: string }) => {
      const q = queries.entityNeighborhood(name);
      const records = await Effect.runPromise(
        graphClient.query(q.cypher, q.params),
      );
      return records
        .filter((r) => {
          const connected = r.get("connected");
          return connected?.properties?.name != null;
        })
        .map((r) => {
          const connected = r.get("connected").properties;
          const relProps = r.get("relProps") as Record<string, unknown>;
          return {
            entity: {
              name: connected.name,
              kind: connected.kind ?? "concept",
              connections: 0,
              mentionCount: (connected.mentionCount as any)?.low ?? connected.mentionCount ?? 0,
            },
            relationshipType: r.get("relType"),
            weight: relProps?.weight ?? null,
            kind: relProps?.kind ?? null,
          };
        });
    },

    hubEntities: async (_: unknown, { limit = 20 }: { limit?: number }) => {
      const q = queries.hubEntities(limit);
      const records = await Effect.runPromise(
        graphClient.query(q.cypher, q.params),
      );
      return records.map((r) => ({
        name: r.get("e.name"),
        kind: r.get("e.kind"),
        connections: (r.get("connections") as any)?.low ?? r.get("connections") ?? 0,
        mentionCount: 0,
      }));
    },

    documentBridges: async () => {
      const q = queries.documentBridges();
      const records = await Effect.runPromise(
        graphClient.query(q.cypher, q.params),
      );
      return records.map((r) => ({
        doc1: r.get("doc1"),
        doc2: r.get("doc2"),
        sharedEntities: r.get("sharedEntities"),
      }));
    },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const recordToDoc = (node: any) => {
  const p = node.properties ?? node;
  return {
    id: p.id,
    title: p.title,
    contentType: p.contentType,
    ingestedAt: p.ingestedAt?.toString?.() ?? p.ingestedAt ?? "",
    summary: p.summary ?? null,
    metadata: typeof p.metadata === "string" ? p.metadata : JSON.stringify(p.metadata ?? {}),
    chunks: [],
    entityCount: 0,
  };
};

// ---------------------------------------------------------------------------
// Server builder
// ---------------------------------------------------------------------------

export const createServer = (config: RhizomaticConfig) =>
  Effect.gen(function* () {
    const graphClient = yield* GraphClient;
    const searchClient = yield* SearchClient;
    const fileStorage = yield* FileStorage;
    const tikaClient = yield* TikaClient;

    const app = Fastify({ logger: config.app.logLevel === "debug" });

    // Register multipart
    await app.register(fastifyMultipart, {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
    });

    // Health check (REST)
    app.get("/health", async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    }));

    // CORS headers for the frontend
    app.addHook("onRequest", async (request, reply) => {
      reply.header("Access-Control-Allow-Origin", "*");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      if (request.method === "OPTIONS") {
        reply.status(204).send();
      }
    });

    // File upload endpoint (REST — multipart)
    app.post("/upload", async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({ error: "No file provided" });
        }

        const buffer = await data.toBuffer();
        const fileName = data.filename;

        // Run the full ingestion pipeline with manually provided services
        const pipeline = runIngestionPipeline(buffer, fileName).pipe(
          Effect.provideService(GraphClient, graphClient),
          Effect.provideService(SearchClient, searchClient),
          Effect.provideService(FileStorage, fileStorage),
          Effect.provideService(TikaClient, tikaClient),
        );
        const result = await Effect.runPromise(pipeline);

        return reply.status(200).send(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: message });
      }
    });

    // Register GraphQL via Mercurius
    const resolvers = buildResolvers(graphClient, searchClient, tikaClient);
    await app.register(mercurius, {
      schema,
      resolvers,
      graphiql: true, // GraphiQL UI at /graphiql
    });

    return {
      start: () =>
        Effect.tryPromise({
          try: () => app.listen({ port: config.app.apiPort, host: "0.0.0.0" }),
          catch: (error) => new Error(`Server failed to start: ${String(error)}`),
        }),
      stop: () =>
        Effect.tryPromise({
          try: () => app.close(),
          catch: (error) => new Error(`Server failed to stop: ${String(error)}`),
        }),
      instance: app,
    };
  });

export { schema as graphqlSchema };
