/**
 * @rhizomatic/api
 *
 * The API gateway. All frontend reads and writes go through here.
 * GraphQL for graph-shaped queries, REST for file uploads and health.
 *
 * Built with Fastify + Mercurius for GraphQL.
 */

import { Effect } from "effect";
import Fastify from "fastify";
import type { RhizomaticConfig } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// GraphQL schema (minimal scaffold — will grow with features)
// ---------------------------------------------------------------------------

export const schema = `
  type Query {
    health: HealthStatus!
    document(id: ID!): Document
    entity(name: String!): Entity
    search(query: String!, limit: Int): [SearchResult!]!
    entityNeighborhood(name: String!): [Connection!]!
    hubEntities(limit: Int): [EntitySummary!]!
  }

  type HealthStatus {
    api: Boolean!
    neo4j: Boolean!
    elasticsearch: Boolean!
  }

  type Document {
    id: ID!
    title: String!
    contentType: String!
    ingestedAt: String!
    summary: String
    chunks: [Chunk!]!
  }

  type Chunk {
    id: ID!
    content: String!
    position: Int!
    heading: String
    entities: [Entity!]!
  }

  type Entity {
    id: ID!
    name: String!
    kind: String!
    description: String
    aliases: [String!]!
    mentionCount: Int!
    relatedEntities: [Connection!]!
  }

  type Connection {
    entity: Entity!
    relationshipType: String!
    weight: Float
    kind: String
  }

  type SearchResult {
    id: ID!
    title: String
    content: String!
    score: Float!
    type: String!
  }

  type EntitySummary {
    name: String!
    kind: String!
    connections: Int!
  }

  type Mutation {
    ingestFile(fileName: String!, contentType: String!): IngestResult!
    createNote(content: String!, targetId: ID!, targetType: String!): Note!
    tagNode(nodeId: ID!, nodeType: String!, tagName: String!): Boolean!
    mergeEntities(sourceId: ID!, targetId: ID!): Entity!
  }

  type IngestResult {
    documentId: ID!
    jobId: ID!
    status: String!
  }

  type Note {
    id: ID!
    content: String!
    createdAt: String!
  }
`;

// ---------------------------------------------------------------------------
// Server builder
// ---------------------------------------------------------------------------

/** Build and start the Fastify server */
export const createServer = (config: RhizomaticConfig) =>
  Effect.gen(function* () {
    const app = Fastify({ logger: config.app.logLevel === "debug" });

    // Health check endpoint (REST)
    app.get("/health", async () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.0.0",
    }));

    // File upload endpoint (REST — multipart)
    app.post("/upload", async (_request, reply) => {
      // TODO: Handle multipart file upload → IngestionService.ingest
      reply.status(501).send({ error: "Not yet implemented" });
    });

    // TODO: Register Mercurius with schema and resolvers
    // await app.register(mercurius, { schema, resolvers });

    return {
      start: () =>
        Effect.tryPromise({
          try: () =>
            app.listen({ port: config.app.apiPort, host: "0.0.0.0" }),
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

// ---------------------------------------------------------------------------
// Server entry point
// ---------------------------------------------------------------------------

export { schema as graphqlSchema };
