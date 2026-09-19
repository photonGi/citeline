"use server";

import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import { getDb } from "@/lib/db/client";
import { ingestRuns, projects, sources } from "@/lib/db/schema";
import { crawlRequested, inngest } from "@/lib/inngest/client";
import { slugify } from "@/lib/ingest/normalize";

const urlField = z
  .string()
  .min(1, "Sitemap URL is required")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "Must be a valid http(s) URL");

const createProjectSchema = z.object({
  name: z.string().min(2, "Name is too short").max(80),
  sitemapUrl: urlField,
  maxPages: z.coerce.number().int().min(1).max(500),
});

export type CreateProjectState = { error: string } | undefined;

async function uniqueSlug(base: string): Promise<string> {
  const db = getDb();
  const candidate = base || "project";

  const [taken] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, candidate))
    .limit(1);

  if (!taken) return candidate;
  return `${candidate}-${randomBytes(3).toString("hex")}`;
}

export async function createProject(
  _previous: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const session = await auth();
  if (!session?.user?.id) return { error: "You must be signed in." };

  const parsed = createProjectSchema.safeParse({
    name: formData.get("name"),
    sitemapUrl: formData.get("sitemapUrl"),
    maxPages: formData.get("maxPages"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const db = getDb();
  const slug = await uniqueSlug(slugify(parsed.data.name));

  const [project] = await db
    .insert(projects)
    .values({ ownerId: session.user.id, name: parsed.data.name, slug })
    .returning({ id: projects.id, slug: projects.slug });

  const [source] = await db
    .insert(sources)
    .values({
      projectId: project.id,
      kind: "sitemap",
      location: parsed.data.sitemapUrl,
      maxPages: parsed.data.maxPages,
    })
    .returning({ id: sources.id });

  const [run] = await db
    .insert(ingestRuns)
    .values({ projectId: project.id, sourceId: source.id, status: "queued" })
    .returning({ id: ingestRuns.id });

  await inngest.send(
    crawlRequested.create({
      runId: run.id,
      projectId: project.id,
      sourceId: source.id,
    }),
  );

  redirect(`/dashboard/${project.slug}`);
}

/** Re-crawls an existing source; unchanged pages are skipped by content hash. */
export async function recrawlProject(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;

  const projectId = String(formData.get("projectId") ?? "");
  const db = getDb();

  const [project] = await db
    .select({ id: projects.id, slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, session.user.id)))
    .limit(1);

  if (!project) return;

  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.projectId, project.id))
    .limit(1);

  if (!source) return;

  const [run] = await db
    .insert(ingestRuns)
    .values({ projectId: project.id, sourceId: source.id, status: "queued" })
    .returning({ id: ingestRuns.id });

  await inngest.send(
    crawlRequested.create({
      runId: run.id,
      projectId: project.id,
      sourceId: source.id,
    }),
  );

  redirect(`/dashboard/${project.slug}`);
}
