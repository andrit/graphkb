/**
 * @rhizomatic/ingestion — Entity extraction (TypeScript-native)
 *
 * Phase 1 entity extraction using pattern matching and heuristics.
 * No Python/spaCy dependency — runs entirely in the TypeScript process.
 *
 * Extraction strategy:
 * 1. Capitalized noun phrases (proper nouns → person, org, place candidates)
 * 2. Technical terms (camelCase, known patterns → technology, concept)
 * 3. Quoted terms (explicit named things)
 * 4. Co-occurrence relationships (entities sharing a chunk)
 *
 * Phase 2: Replace with spaCy via the Python processor worker for
 * higher-quality extraction. The interface stays the same.
 */

import type {
  ExtractedEntity,
  ExtractedTriple,
  ProcessedChunk,
} from "@rhizomatic/common";
import { clampUnit } from "@rhizomatic/common";

// ---------------------------------------------------------------------------
// Known entity patterns
// ---------------------------------------------------------------------------

/** Common words that should NOT be treated as entities */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "up", "about", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "since",
  "without", "also", "this", "that", "these", "those", "then", "than",
  "such", "both", "each", "every", "all", "any", "few", "more", "most",
  "other", "some", "no", "not", "only", "own", "same", "so", "very",
  "can", "will", "just", "should", "now", "new", "first", "last", "long",
  "great", "little", "right", "big", "high", "old", "public", "late",
  "general", "full", "part", "small", "next", "early", "young", "important",
  "may", "june", "march", "april", "january", "february", "july", "august",
  "september", "october", "november", "december", "monday", "tuesday",
  "wednesday", "thursday", "friday", "saturday", "sunday", "however",
  "although", "because", "therefore", "furthermore", "moreover",
  "nevertheless", "meanwhile", "otherwise", "instead", "chapter",
  "section", "figure", "table", "page", "example", "note", "see",
  "introduction", "conclusion", "abstract", "summary", "references",
  "background", "results", "discussion", "methods", "data",
  "many", "much", "well", "still", "already", "even", "here", "there",
  "when", "where", "why", "how", "what", "which", "who", "whom",
]);

/** Words that signal a person name when capitalized */
const PERSON_PREFIXES = new Set([
  "mr", "mrs", "ms", "dr", "prof", "professor", "sir", "lord", "lady",
  "president", "senator", "governor", "mayor", "judge", "general",
  "captain", "colonel", "sergeant", "detective", "officer",
]);

/** Common organizational suffixes */
const ORG_SUFFIXES = new Set([
  "inc", "corp", "ltd", "llc", "co", "company", "corporation",
  "foundation", "institute", "university", "college", "school",
  "association", "organization", "society", "group", "labs", "lab",
  "technologies", "systems", "solutions", "partners", "team",
]);

/** Known technology terms (extensible) */
const TECH_TERMS = new Set([
  "javascript", "typescript", "python", "rust", "java", "c++", "c#",
  "go", "ruby", "swift", "kotlin", "scala", "haskell", "erlang", "elixir",
  "react", "angular", "vue", "svelte", "next.js", "nuxt", "remix",
  "node.js", "deno", "bun", "express", "fastify", "koa",
  "neo4j", "elasticsearch", "redis", "postgresql", "mysql", "mongodb",
  "docker", "kubernetes", "aws", "azure", "gcp", "terraform",
  "graphql", "rest", "grpc", "websocket",
  "linux", "windows", "macos", "ios", "android",
  "git", "github", "gitlab", "bitbucket",
  "machine learning", "deep learning", "neural network", "nlp",
  "artificial intelligence", "computer vision",
  "blockchain", "cryptocurrency", "bitcoin", "ethereum",
  "api", "sdk", "cli", "gui", "ide",
  "html", "css", "sql", "json", "xml", "yaml", "toml",
  "tcp", "http", "https", "ssh", "ftp",
  "oauth", "jwt", "tls", "ssl",
  "spacy", "pytorch", "tensorflow", "pandas", "numpy",
  "effect", "fp-ts", "zod", "prisma", "drizzle",
]);

// ---------------------------------------------------------------------------
// Extraction functions (pure)
// ---------------------------------------------------------------------------

/** Check if a word is a stop word */
const isStopWord = (word: string): boolean =>
  STOP_WORDS.has(word.toLowerCase());

/** Normalize an entity name to canonical form */
const canonicalize = (name: string): string =>
  name.trim().replace(/\s+/g, " ");

/** Determine entity kind from context clues */
const inferKind = (name: string, context: string): string => {
  const lower = name.toLowerCase();

  // Check tech terms
  if (TECH_TERMS.has(lower)) return "technology";

  // Check organizational suffixes
  const lastWord = lower.split(/\s+/).pop() ?? "";
  if (ORG_SUFFIXES.has(lastWord)) return "organization";

  // Check person prefixes
  const firstWord = lower.split(/\s+/)[0] ?? "";
  if (PERSON_PREFIXES.has(firstWord)) return "person";

  // Heuristics from surrounding context
  const nearby = context.toLowerCase();
  if (/\b(wrote|said|argued|proposed|born|died|authored)\b/.test(nearby))
    return "person";
  if (/\b(company|firm|startup|corporation)\b/.test(nearby))
    return "organization";
  if (/\b(city|country|state|region|continent)\b/.test(nearby))
    return "place";
  if (/\b(language|framework|library|tool|database|protocol)\b/.test(nearby))
    return "technology";

  // Two-word capitalized phrases are often person names
  if (/^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(name)) return "person";

  return "concept";
};

/**
 * Extract entities from a single chunk of text.
 *
 * Multi-strategy approach:
 * 1. Capitalized multi-word phrases (proper nouns)
 * 2. Known technology terms
 * 3. Quoted terms
 */
export const extractEntities = (text: string): ExtractedEntity[] => {
  const entities: Map<string, ExtractedEntity> = new Map();

  const addEntity = (
    surfaceForm: string,
    kind: string,
    confidence: number,
  ) => {
    const canonical = canonicalize(surfaceForm);
    if (canonical.length < 2 || canonical.length > 100) return;
    if (isStopWord(canonical)) return;
    // Skip if all words are stop words
    const words = canonical.split(/\s+/);
    if (words.every((w) => isStopWord(w))) return;

    const key = canonical.toLowerCase();
    const existing = entities.get(key);
    if (existing) {
      // Keep higher confidence
      if (confidence > existing.confidence) {
        entities.set(key, { ...existing, confidence });
      }
    } else {
      entities.set(key, {
        surfaceForm,
        canonicalName: canonical,
        kind,
        confidence: clampUnit(confidence),
      });
    }
  };

  // Strategy 1: Capitalized multi-word phrases
  // Match sequences of capitalized words (2+ words = higher confidence)
  const properNounPattern = /(?<![.!?]\s)(?:^|\s)((?:[A-Z][a-zA-Z]+)(?:\s+(?:[A-Z][a-zA-Z]+|(?:of|the|and|for|in|on|at)\s+[A-Z][a-zA-Z]+))*)/gm;
  let match: RegExpExecArray | null;

  while ((match = properNounPattern.exec(text)) !== null) {
    const phrase = match[1]?.trim();
    if (!phrase) continue;
    if (phrase.split(/\s+/).length >= 2) {
      // Multi-word: higher confidence
      const kind = inferKind(phrase, text.slice(Math.max(0, match.index - 50), match.index + phrase.length + 50));
      addEntity(phrase, kind, 0.75);
    } else if (phrase.length > 2 && !isStopWord(phrase)) {
      // Single capitalized word: lower confidence, check it's not a sentence start
      const charBefore = match.index > 0 ? text[match.index - 1] : "\n";
      if (charBefore !== "." && charBefore !== "!" && charBefore !== "?" && charBefore !== "\n") {
        const kind = inferKind(phrase, text.slice(Math.max(0, match.index - 50), match.index + phrase.length + 50));
        addEntity(phrase, kind, 0.5);
      }
    }
  }

  // Strategy 2: Known technology terms (case-insensitive)
  for (const term of TECH_TERMS) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
    if (pattern.test(text)) {
      addEntity(term.charAt(0).toUpperCase() + term.slice(1), "technology", 0.9);
    }
  }

  // Strategy 3: Quoted terms ("double quotes" or 'single quotes')
  const quotedPattern = /["']([A-Z][^"']{1,60})["']/g;
  while ((match = quotedPattern.exec(text)) !== null) {
    const quoted = match[1]?.trim();
    if (!quoted || quoted.length <= 2) continue;
    const kind = inferKind(quoted, text.slice(Math.max(0, match.index - 50), match.index + quoted.length + 50));
    addEntity(quoted, kind, 0.65);
  }

  return Array.from(entities.values());
};

/**
 * Discover relationships between co-occurring entities.
 *
 * Phase 1 strategy: entities appearing in the same chunk are related
 * by co-occurrence. Weight is proportional to the number of shared chunks.
 */
export const extractRelationships = (
  entities: ExtractedEntity[],
  chunkId: string,
): ExtractedTriple[] => {
  const triples: ExtractedTriple[] = [];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i]!;
      const b = entities[j]!;
      if (a.canonicalName !== b.canonicalName) {
        triples.push({
          subject: a,
          predicate: "RELATED_TO",
          object: b,
          confidence: clampUnit(a.confidence * b.confidence * 0.8),
          sourceChunkId: chunkId,
        });
      }
    }
  }

  return triples;
};

/**
 * Run entity extraction over all chunks, enriching each chunk
 * with its discovered entities and collecting all relationships.
 */
export const extractFromChunks = (
  chunks: ProcessedChunk[],
  documentId: string,
): {
  enrichedChunks: ProcessedChunk[];
  allEntities: ExtractedEntity[];
  allTriples: ExtractedTriple[];
} => {
  const allEntities: Map<string, ExtractedEntity> = new Map();
  const allTriples: ExtractedTriple[] = [];

  const enrichedChunks = chunks.map((chunk) => {
    const chunkId = `${documentId}_chunk_${chunk.position}`;
    const entities = extractEntities(chunk.content);
    const triples = extractRelationships(entities, chunkId);

    // Deduplicate entities across chunks
    for (const entity of entities) {
      const key = entity.canonicalName.toLowerCase();
      const existing = allEntities.get(key);
      if (!existing || entity.confidence > existing.confidence) {
        allEntities.set(key, entity);
      }
    }

    allTriples.push(...triples);

    return { ...chunk, entities };
  });

  return {
    enrichedChunks,
    allEntities: Array.from(allEntities.values()),
    allTriples,
  };
};
