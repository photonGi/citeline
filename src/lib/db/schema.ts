import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// Relative import: drizzle-kit bundles this file without tsconfig path aliases.
import { EMBEDDING_DIMENSIONS } from "../ai/config";

/**
 * Postgres `tsvector`, which Drizzle has no built-in type for. Declared so the
 * generated full-text column can be indexed and queried through the schema.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ *
 * Auth.js tables. Column names are fixed by @auth/drizzle-adapter.
 * ------------------------------------------------------------------ */

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

/* ------------------------------------------------------------------ *
 * Application tables.
 * ------------------------------------------------------------------ */

/** Tenant root. Every retrieval query is scoped by project. */
export const projects = pgTable(
  "project",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Showcase projects are readable without authentication. */
    isPublicDemo: boolean("is_public_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("project_slug_idx").on(table.slug)],
);

export type SourceKind = "sitemap" | "github" | "openapi";

export const sources = pgTable(
  "source",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<SourceKind>().notNull(),
    /** Sitemap URL, `owner/repo[/path]`, or OpenAPI document URL. */
    location: text("location").notNull(),
    maxPages: integer("max_pages").notNull().default(200),
    maxDepth: integer("max_depth").notNull().default(4),
    createdAt: createdAt(),
  },
  (table) => [index("source_project_idx").on(table.projectId)],
);

export type DocumentStatus = "pending" | "indexed" | "failed" | "skipped";

export const documents = pgTable(
  "document",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    title: text("title"),
    /** Hash of normalised content; unchanged pages are skipped on re-crawl. */
    contentHash: text("content_hash").notNull(),
    status: text("status").$type<DocumentStatus>().notNull().default("pending"),
    error: text("error"),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("document_project_url_idx").on(table.projectId, table.url),
    index("document_hash_idx").on(table.projectId, table.contentHash),
  ],
);

export const chunks = pgTable(
  "chunk",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    /** Breadcrumb such as `Guides › Auth › Refresh tokens`. */
    headingPath: text("heading_path").notNull().default(""),
    /** Fragment identifier of the nearest heading, for deep-linked citations. */
    anchor: text("anchor"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    tsv: tsvector("tsv").generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', heading_path || ' ' || content)`,
    ),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("chunk_document_index_idx").on(table.documentId, table.chunkIndex),
    index("chunk_project_idx").on(table.projectId),
    index("chunk_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("chunk_tsv_gin_idx").using("gin", table.tsv),
  ],
);

export const conversations = pgTable(
  "conversation",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null for anonymous widget and public-demo conversations. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [index("conversation_project_idx").on(table.projectId)],
);

export type Citation = {
  marker: number;
  chunkId: string;
  url: string;
  title: string | null;
  headingPath: string;
  anchor: string | null;
};

export const messages = pgTable(
  "message",
  {
    id: id(),
    conversationId: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations").$type<Citation[]>().notNull().default([]),
    /** True when the assistant declined for lack of grounded context. */
    refused: boolean("refused").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("message_conversation_idx").on(table.conversationId)],
);

export const feedback = pgTable(
  "feedback",
  {
    id: id(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    helpful: boolean("helpful").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("feedback_message_idx").on(table.messageId)],
);

/** Drives analytics and the content-gap report. */
export const queryLogs = pgTable(
  "query_log",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    rewrittenQuestion: text("rewritten_question"),
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>().notNull().default([]),
    topScore: real("top_score"),
    answered: boolean("answered").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    surface: text("surface").$type<"app" | "widget" | "demo">().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("query_log_project_idx").on(table.projectId, table.createdAt)],
);

export const widgetKeys = pgTable(
  "widget_key",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("widget_key_public_idx").on(table.publicKey)],
);

export type IngestRunStatus = "queued" | "running" | "completed" | "failed";

export const ingestRuns = pgTable(
  "ingest_run",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: text("status").$type<IngestRunStatus>().notNull().default("queued"),
    pagesDiscovered: integer("pages_discovered").notNull().default(0),
    pagesIndexed: integer("pages_indexed").notNull().default(0),
    pagesSkipped: integer("pages_skipped").notNull().default(0),
    pagesFailed: integer("pages_failed").notNull().default(0),
    chunksEmbedded: integer("chunks_embedded").notNull().default(0),
    error: text("error"),
    startedAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("ingest_run_project_idx").on(table.projectId)],
);
