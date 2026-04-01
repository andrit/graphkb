/**
 * @rhizomatic/cli
 *
 * Command-line tool for development and administration.
 * Lets you test pipeline stages individually, inspect the graph,
 * run searches, and manage infrastructure.
 */

import { Command } from "commander";
import { loadConfigFromEnv } from "@rhizomatic/common";

const program = new Command();

program
  .name("rhizomatic")
  .description("Rhizomatic knowledge base — CLI tools")
  .version("0.0.0");

// ---------------------------------------------------------------------------
// Infrastructure commands
// ---------------------------------------------------------------------------

program
  .command("init")
  .description("Initialize Neo4j schema and Elasticsearch indexes")
  .action(async () => {
    const config = loadConfigFromEnv();
    console.log("Initializing Rhizomatic infrastructure...");
    console.log(`  Neo4j: ${config.neo4j.uri}`);
    console.log(`  Elasticsearch: ${config.elasticsearch.url}`);

    // TODO: Import and run initializeSchema + initializeIndexes
    console.log("Schema and indexes initialized.");
  });

program
  .command("health")
  .description("Check connectivity to Neo4j, Elasticsearch, and Redis")
  .action(async () => {
    const config = loadConfigFromEnv();
    console.log("Checking infrastructure health...");

    // TODO: Ping each service and report status
    console.log(`  Neo4j:         [ ] ${config.neo4j.uri}`);
    console.log(`  Elasticsearch: [ ] ${config.elasticsearch.url}`);
    console.log(`  Redis:         [ ] ${config.redis.url}`);
  });

// ---------------------------------------------------------------------------
// Ingestion commands
// ---------------------------------------------------------------------------

program
  .command("ingest <filepath>")
  .description("Ingest a file into the knowledge graph")
  .option("-t, --type <type>", "Content type override")
  .action(async (filepath, options) => {
    console.log(`Ingesting: ${filepath}`);
    if (options.type) {
      console.log(`  Type override: ${options.type}`);
    }
    // TODO: Read file, detect type, call IngestionService.ingest
    console.log("Ingestion queued.");
  });

// ---------------------------------------------------------------------------
// Graph inspection commands
// ---------------------------------------------------------------------------

program
  .command("entities")
  .description("List top entities by connection count")
  .option("-l, --limit <n>", "Number of entities to show", "20")
  .action(async (options) => {
    console.log(`Top ${options.limit} entities:`);
    // TODO: Query graph for hub entities
  });

program
  .command("entity <name>")
  .description("Show details and connections for an entity")
  .action(async (name) => {
    console.log(`Entity: ${name}`);
    // TODO: Query entityNeighborhood
  });

program
  .command("path <from> <to>")
  .description("Find the shortest path between two entities")
  .option("-d, --depth <n>", "Maximum path depth", "4")
  .action(async (from, to, options) => {
    console.log(`Shortest path: "${from}" → "${to}" (max ${options.depth} hops)`);
    // TODO: Query shortestPath
  });

program
  .command("bridges")
  .description("Find documents bridged by shared entities")
  .action(async () => {
    console.log("Document bridges:");
    // TODO: Query documentBridges
  });

// ---------------------------------------------------------------------------
// Search commands
// ---------------------------------------------------------------------------

program
  .command("search <query>")
  .description("Full-text search across the knowledge base")
  .option("-l, --limit <n>", "Number of results", "10")
  .action(async (query, options) => {
    console.log(`Searching: "${query}" (limit: ${options.limit})`);
    // TODO: Query SearchClient.search
  });

// ---------------------------------------------------------------------------
// Data management commands
// ---------------------------------------------------------------------------

program
  .command("stats")
  .description("Show graph statistics (node counts, edge counts)")
  .action(async () => {
    console.log("Graph statistics:");
    // TODO: Count nodes and edges by type
  });

program
  .command("export")
  .description("Export graph data as JSON")
  .option("-o, --output <path>", "Output file path", "./export.json")
  .action(async (options) => {
    console.log(`Exporting to: ${options.output}`);
    // TODO: Export graph
  });

program.parse();
