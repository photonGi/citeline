import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { recrawlProject } from "@/app/dashboard/actions";
import { auth } from "@/auth";
import { AskPanel } from "@/components/ask-panel";
import { AutoRefresh } from "@/components/auto-refresh";
import { getDb } from "@/lib/db/client";
import { chunks, documents, ingestRuns, projects, sources } from "@/lib/db/schema";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Crawling",
  completed: "Completed",
  failed: "Failed",
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 px-4 py-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-medium text-white">{value}</p>
    </div>
  );
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const db = getDb();

  const [project] = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.slug, slug), eq(projects.ownerId, session.user.id)))
    .limit(1);

  if (!project) notFound();

  const [source] = await db
    .select({ location: sources.location, maxPages: sources.maxPages })
    .from(sources)
    .where(eq(sources.projectId, project.id))
    .limit(1);

  const [run] = await db
    .select()
    .from(ingestRuns)
    .where(eq(ingestRuns.projectId, project.id))
    .orderBy(desc(ingestRuns.startedAt))
    .limit(1);

  const [chunkTotal] = await db
    .select({ total: count() })
    .from(chunks)
    .where(eq(chunks.projectId, project.id));

  const recentDocuments = await db
    .select({
      url: documents.url,
      title: documents.title,
      status: documents.status,
      error: documents.error,
    })
    .from(documents)
    .where(eq(documents.projectId, project.id))
    .orderBy(desc(documents.lastCrawledAt))
    .limit(25);

  const inFlight = run?.status === "queued" || run?.status === "running";
  const processed = run
    ? run.pagesIndexed + run.pagesSkipped + run.pagesFailed
    : 0;
  const progress =
    run && run.pagesDiscovered > 0
      ? Math.round((processed / run.pagesDiscovered) * 100)
      : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16">
      <AutoRefresh enabled={inFlight} />

      <header className="flex items-start justify-between gap-6">
        <div>
          <Link
            href="/dashboard"
            className="font-mono text-xs text-neutral-500 hover:text-white"
          >
            ← all projects
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {project.name}
          </h1>
          {source ? (
            <p className="mt-1 font-mono text-xs break-all text-neutral-500">
              {source.location} · max {source.maxPages} pages
            </p>
          ) : null}
        </div>

        <form action={recrawlProject}>
          <input type="hidden" name="projectId" value={project.id} />
          <button
            type="submit"
            disabled={inFlight}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition hover:border-neutral-500 disabled:opacity-40"
          >
            {inFlight ? "Crawl in progress…" : "Re-crawl"}
          </button>
        </form>
      </header>

      {run ? (
        <section className="mt-10">
          <div className="flex items-center justify-between text-sm">
            <span className="text-neutral-300">
              {STATUS_LABEL[run.status] ?? run.status}
              {inFlight ? ` · ${processed} of ${run.pagesDiscovered} pages` : null}
            </span>
            {inFlight ? (
              <span className="text-xs text-neutral-500">refreshing…</span>
            ) : null}
          </div>

          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full bg-white transition-all"
              style={{ width: `${run.status === "completed" ? 100 : progress}%` }}
            />
          </div>

          {run.error ? (
            <p className="mt-3 text-sm text-red-400">{run.error}</p>
          ) : null}

          <div className="mt-6 grid gap-3 sm:grid-cols-5">
            <Stat label="Discovered" value={run.pagesDiscovered} />
            <Stat label="Indexed" value={run.pagesIndexed} />
            <Stat label="Skipped" value={run.pagesSkipped} />
            <Stat label="Failed" value={run.pagesFailed} />
            <Stat label="Chunks" value={chunkTotal?.total ?? 0} />
          </div>
        </section>
      ) : null}

      {(chunkTotal?.total ?? 0) > 0 ? (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-medium text-white">Ask</h2>
          <AskPanel slug={project.slug} />
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-sm font-medium text-white">Pages</h2>

        {recentDocuments.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            Nothing indexed yet. If the crawl just started, this fills in as
            pages are processed.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
            {recentDocuments.map((document) => (
              <li key={document.url} className="px-6 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate text-sm text-white">
                    {document.title ?? document.url}
                  </p>
                  <span
                    className={
                      document.status === "failed"
                        ? "text-xs text-red-400"
                        : "text-xs text-neutral-500"
                    }
                  >
                    {document.status}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-neutral-600">
                  {document.url}
                </p>
                {document.error ? (
                  <p className="mt-1 text-xs text-red-400/80">{document.error}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
