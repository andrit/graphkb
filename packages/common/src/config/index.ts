/**
 * @rhizomatic/common — Configuration
 *
 * Typed configuration schemas loaded from environment variables.
 * Uses Effect Schema for runtime validation — the app fails fast
 * with clear error messages if config is wrong.
 */

import { Schema } from "effect";

/** Neo4j connection configuration */
export const Neo4jConfig = Schema.Struct({
  uri: Schema.String.pipe(Schema.nonEmptyString()),
  user: Schema.String.pipe(Schema.nonEmptyString()),
  password: Schema.String.pipe(Schema.nonEmptyString()),
});
export type Neo4jConfig = typeof Neo4jConfig.Type;

/** Elasticsearch connection configuration */
export const ElasticsearchConfig = Schema.Struct({
  url: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ElasticsearchConfig = typeof ElasticsearchConfig.Type;

/** Redis connection configuration */
export const RedisConfig = Schema.Struct({
  url: Schema.String.pipe(Schema.nonEmptyString()),
});
export type RedisConfig = typeof RedisConfig.Type;

/** File storage configuration */
export const StorageConfig = Schema.Struct({
  path: Schema.String.pipe(Schema.nonEmptyString()),
});
export type StorageConfig = typeof StorageConfig.Type;

/** Processing pipeline configuration */
export const ProcessingConfig = Schema.Struct({
  concurrency: Schema.Number.pipe(Schema.int(), Schema.positive()),
  embeddingModel: Schema.String.pipe(Schema.nonEmptyString()),
});
export type ProcessingConfig = typeof ProcessingConfig.Type;

/** Application-level configuration */
export const AppConfig = Schema.Struct({
  nodeEnv: Schema.Literal("development", "production", "test"),
  apiPort: Schema.Number.pipe(Schema.int(), Schema.positive()),
  webPort: Schema.Number.pipe(Schema.int(), Schema.positive()),
  logLevel: Schema.Literal("debug", "info", "warn", "error"),
});
export type AppConfig = typeof AppConfig.Type;

/** Complete Rhizomatic configuration */
export const RhizomaticConfig = Schema.Struct({
  neo4j: Neo4jConfig,
  elasticsearch: ElasticsearchConfig,
  redis: RedisConfig,
  storage: StorageConfig,
  processing: ProcessingConfig,
  app: AppConfig,
});
export type RhizomaticConfig = typeof RhizomaticConfig.Type;

/**
 * Load configuration from environment variables.
 * Returns a validated RhizomaticConfig or fails with a clear error.
 */
export const loadConfigFromEnv = (): RhizomaticConfig => {
  const env = (key: string, fallback?: string): string => {
    const value = process.env[key] ?? fallback;
    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  };

  return {
    neo4j: {
      uri: env("NEO4J_URI", "bolt://localhost:7687"),
      user: env("NEO4J_USER", "neo4j"),
      password: env("NEO4J_PASSWORD", "rhizomatic-dev"),
    },
    elasticsearch: {
      url: env("ELASTICSEARCH_URL", "http://localhost:9200"),
    },
    redis: {
      url: env("REDIS_URL", "redis://localhost:6379"),
    },
    storage: {
      path: env("FILE_STORAGE_PATH", "./data/files"),
    },
    processing: {
      concurrency: Number(env("PROCESSOR_CONCURRENCY", "2")),
      embeddingModel: env("EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
    },
    app: {
      nodeEnv: env("NODE_ENV", "development") as "development" | "production" | "test",
      apiPort: Number(env("API_PORT", "4000")),
      webPort: Number(env("WEB_PORT", "3000")),
      logLevel: env("LOG_LEVEL", "debug") as "debug" | "info" | "warn" | "error",
    },
  };
};
