/**
 * @rhizomatic/api — Server entry point
 *
 * This is where all the Effect Layers compose together.
 * Each service (graph, search, storage, ingestion) is defined
 * independently as a Layer, and this file wires them all up.
 */
/**
 * @rhizomatic/api — Server entry point
 */

import { Effect, Layer } from "effect";
import { loadConfigFromEnv } from "@rhizomatic/common";
import { GraphClientLive, initializeSchema } from "@rhizomatic/graph";
import { SearchClientLive, initializeIndexes } from "@rhizomatic/search";
import { FileStorageLive } from "@rhizomatic/storage";
import { createServer } from "./index.js";

const config = loadConfigFromEnv();

const main = Effect.gen(function* () {
  // ... same logging ...
  yield* initializeSchema;
  yield* initializeIndexes;
  const server = yield* createServer(config);
  yield* server.start();    // <-- was missing parens
  console.log(`Rhizomatic API ready on port ${config.app.apiPort}`);
});

const AppLayer = Layer.mergeAll(
  GraphClientLive(config.neo4j),
  SearchClientLive(config.elasticsearch),
  FileStorageLive(config.storage),
);

const runnable = Effect.provide(main, AppLayer);

Effect.runPromise(runnable).catch((error: unknown) => {
  console.error("Fatal error:", error);
  process.exit(1);
});