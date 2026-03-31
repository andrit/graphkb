/**
 * @rhizomatic/storage
 *
 * File storage abstraction. Stores original uploaded documents
 * using content-addressable hashing (filename = SHA-256 of content).
 *
 * Current implementation: local filesystem.
 * Future: S3-compatible (MinIO / AWS S3) via the same interface.
 */

import { Context, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StorageConfig } from "@rhizomatic/common";
import { StorageError, hashContent } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Service definition
// ---------------------------------------------------------------------------

export class FileStorage extends Context.Tag("FileStorage")<
  FileStorage,
  {
    /** Store a file. Returns the content hash (used as the storage key). */
    readonly store: (
      content: Buffer,
      originalName: string,
    ) => Effect.Effect<{ hash: string; path: string }, StorageError>;

    /** Retrieve a file by its content hash */
    readonly retrieve: (
      hash: string,
    ) => Effect.Effect<Buffer, StorageError>;

    /** Check if a file exists by its content hash */
    readonly exists: (
      hash: string,
    ) => Effect.Effect<boolean, StorageError>;

    /** Delete a file by its content hash */
    readonly remove: (
      hash: string,
    ) => Effect.Effect<void, StorageError>;

    /** List all stored file hashes */
    readonly list: () => Effect.Effect<ReadonlyArray<string>, StorageError>;
  }
>() {}

// ---------------------------------------------------------------------------
// Local filesystem implementation
// ---------------------------------------------------------------------------

const ensureDir = (dir: string): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: () => fs.mkdir(dir, { recursive: true }),
    catch: (error) =>
      new StorageError({
        message: `Failed to create directory: ${String(error)}`,
        path: dir,
        cause: error,
      }),
  }).pipe(Effect.map(() => void 0));

const hashToPath = (basePath: string, hash: string): string => {
  // Strip the "sha256:" prefix for the filename
  const cleanHash = hash.replace("sha256:", "");
  // Use first 2 chars as subdirectory for filesystem efficiency
  const subdir = cleanHash.slice(0, 2);
  return path.join(basePath, subdir, cleanHash);
};

export const FileStorageLive = (
  config: StorageConfig,
): Layer.Layer<FileStorage> =>
  Layer.succeed(FileStorage, {
    store: (content, _originalName) =>
      Effect.gen(function* () {
        const hash = hashContent(content);
        const filePath = hashToPath(config.path, hash);
        const dir = path.dirname(filePath);

        yield* ensureDir(dir);

        yield* Effect.tryPromise({
          try: () => fs.writeFile(filePath, content),
          catch: (error) =>
            new StorageError({
              message: `Failed to write file: ${String(error)}`,
              path: filePath,
              cause: error,
            }),
        });

        return { hash, path: filePath };
      }),

    retrieve: (hash) =>
      Effect.tryPromise({
        try: () => fs.readFile(hashToPath(config.path, hash)),
        catch: (error) =>
          new StorageError({
            message: `File not found: ${String(error)}`,
            path: hashToPath(config.path, hash),
            cause: error,
          }),
      }),

    exists: (hash) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await fs.access(hashToPath(config.path, hash));
            return true;
          } catch {
            return false;
          }
        },
        catch: (error) =>
          new StorageError({
            message: `Failed to check file: ${String(error)}`,
            path: hashToPath(config.path, hash),
            cause: error,
          }),
      }),

    remove: (hash) =>
      Effect.tryPromise({
        try: () => fs.unlink(hashToPath(config.path, hash)),
        catch: (error) =>
          new StorageError({
            message: `Failed to delete file: ${String(error)}`,
            path: hashToPath(config.path, hash),
            cause: error,
          }),
      }),

    list: () =>
      Effect.tryPromise({
        try: async () => {
          const entries: string[] = [];
          try {
            const subdirs = await fs.readdir(config.path);
            for (const subdir of subdirs) {
              const subdirPath = path.join(config.path, subdir);
              const stat = await fs.stat(subdirPath);
              if (stat.isDirectory()) {
                const files = await fs.readdir(subdirPath);
                entries.push(...files.map((f) => `sha256:${f}`));
              }
            }
          } catch {
            // Directory doesn't exist yet — return empty
          }
          return entries;
        },
        catch: (error) =>
          new StorageError({
            message: `Failed to list files: ${String(error)}`,
            path: config.path,
            cause: error,
          }),
      }),
  });
