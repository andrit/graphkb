/**
 * @rhizomatic/api — Server entry point
 *
 * This is where all the Effect Layers compose together.
 * Each service (graph, search, storage) is defined independently
 * as a Layer, and this file wires them all up.
 */

import { Effect, Layer } from "effect";
import { loadConfigFromEnv } from "@rhizomatic/common";
import { GraphClientLive, initializeSchema } from "@rhizomatic/graph";
import { SearchClientLive, initializeIndexes } from "@rhizomatic/search";
import { FileStorageLive } from "@rhizomatic/storage";
import { TikaClientLive, TikaClientTest } from "@rhizomatic/ingestion";
import { createServer } from "./index.js";

const config = loadConfigFromEnv();

const main = Effect.gen(function* () {
  console.log("Rhizomatic API starting...");
  console.log(`  Neo4j:         ${config.neo4j.uri}`);
  console.log(`  Elasticsearch: ${config.elasticsearch.url}`);
  console.log(`  Redis:         ${config.redis.url}`);
  console.log(`  Tika:          ${config.tika.enabled ? config.tika.url : "disabled"}`);
  console.log(`  Storage:       ${config.storage.path}`);
  console.log(`  API port:      ${config.app.apiPort}`);

  // Initialize database schemas
  console.log("Initializing Neo4j schema...");
  yield* initializeSchema;

  console.log("Initializing Elasticsearch indexes...");
  yield* initializeIndexes;

  // Build and start the server
  console.log("Starting API server...");
  const server = yield* createServer(config);
  yield* server.start();

  console.log(`Rhizomatic API ready on port ${config.app.apiPort}`);
  console.log(`  GraphiQL:  http://localhost:${config.app.apiPort}/graphiql`);
  console.log(`  Upload:    POST http://localhost:${config.app.apiPort}/upload`);
  console.log(`  Health:    http://localhost:${config.app.apiPort}/health`);
});

// Compose all Layers
// When Tika is disabled via config, provide a test layer that always
// reports unhealthy — the pipeline degrades gracefully to plain-text fallback.
const tikaLayer = config.tika.enabled
  ? TikaClientLive(config.tika)
  : TikaClientTest({ healthy: false });

const AppLayer = Layer.mergeAll(
  GraphClientLive(config.neo4j),
  SearchClientLive(config.elasticsearch),
  FileStorageLive(config.storage),
  tikaLayer,
);

// Run the program
const runnable = Effect.provide(main, AppLayer);

Effect.runPromise(runnable).catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
