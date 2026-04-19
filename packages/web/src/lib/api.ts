/**
 * API client for the Rhizomatic backend.
 * GraphQL queries go through /graphql, file uploads through /upload.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// ---------------------------------------------------------------------------
// GraphQL client
// ---------------------------------------------------------------------------

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface DocumentSummary {
  id: string;
  title: string;
  contentType: string;
  ingestedAt: string;
  summary: string | null;
  entityCount: number;
}

export interface DocumentDetail {
  id: string;
  title: string;
  contentType: string;
  ingestedAt: string;
  summary: string | null;
  metadata: string | null;
  entityCount: number;
  chunks: {
    id: string;
    content: string;
    position: number;
    heading: string | null;
    entities: { name: string; kind: string; confidence: number }[];
  }[];
}

export interface EntitySummary {
  name: string;
  kind: string;
  connections: number;
  mentionCount: number;
}

export interface EntityDetail {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  aliases: string[];
  mentionCount: number;
  relatedEntities: {
    entity: EntitySummary;
    relationshipType: string;
    weight: number | null;
    kind: string | null;
  }[];
  mentioningDocuments: DocumentSummary[];
}

export interface SearchResult {
  id: string;
  title: string | null;
  content: string;
  score: number;
  type: string;
}

export interface IngestionResult {
  documentId: string;
  title: string;
  chunkCount: number;
  entityCount: number;
  relationshipCount: number;
  contentType: string;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchDocuments(limit = 20): Promise<DocumentSummary[]> {
  const data = await graphql<{ documents: DocumentSummary[] }>(
    `query($limit: Int) {
      documents(limit: $limit) {
        id title contentType ingestedAt summary entityCount
      }
    }`,
    { limit },
  );
  return data.documents;
}

export async function fetchDocument(id: string): Promise<DocumentDetail | null> {
  const data = await graphql<{ document: DocumentDetail | null }>(
    `query($id: ID!) {
      document(id: $id) {
        id title contentType ingestedAt summary metadata entityCount
        chunks {
          id content position heading
          entities { name kind confidence }
        }
      }
    }`,
    { id },
  );
  return data.document;
}

export async function fetchEntities(limit = 50): Promise<EntitySummary[]> {
  const data = await graphql<{ entities: EntitySummary[] }>(
    `query($limit: Int) {
      entities(limit: $limit) {
        name kind connections mentionCount
      }
    }`,
    { limit },
  );
  return data.entities;
}

export async function fetchEntity(name: string): Promise<EntityDetail | null> {
  const data = await graphql<{ entity: EntityDetail | null }>(
    `query($name: String!) {
      entity(name: $name) {
        id name kind description aliases mentionCount
        relatedEntities {
          entity { name kind connections mentionCount }
          relationshipType weight kind
        }
        mentioningDocuments {
          id title contentType ingestedAt summary entityCount
        }
      }
    }`,
    { name },
  );
  return data.entity;
}

export async function searchAll(query: string, limit = 20): Promise<SearchResult[]> {
  const data = await graphql<{ search: SearchResult[] }>(
    `query($query: String!, $limit: Int) {
      search(query: $query, limit: $limit) {
        id title content score type
      }
    }`,
    { query, limit },
  );
  return data.search;
}

export async function fetchHubEntities(limit = 20): Promise<EntitySummary[]> {
  const data = await graphql<{ hubEntities: EntitySummary[] }>(
    `query($limit: Int) {
      hubEntities(limit: $limit) {
        name kind connections mentionCount
      }
    }`,
    { limit },
  );
  return data.hubEntities;
}

export async function uploadFile(file: File): Promise<IngestionResult> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `Upload failed: ${res.status}`);
  }

  return res.json();
}

export async function fetchHealth(): Promise<{
  api: boolean;
  neo4j: boolean;
  elasticsearch: boolean;
}> {
  const data = await graphql<{
    health: { api: boolean; neo4j: boolean; elasticsearch: boolean };
  }>(`{ health { api neo4j elasticsearch } }`);
  return data.health;
}
