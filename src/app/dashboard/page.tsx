import { count, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth-buttons";
import { NewProjectForm } from "@/components/new-project-form";
import { getDb } from "@/lib/db/client";
import { chunks, documents, projects } from "@/lib/db/schema";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const db = getDb();

  const owned = await db
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.ownerId, session.user.id));

  const projectIds = owned.map((project) => project.id);

  // Counted separately rather than joined: joining documents and chunks in one
  // query multiplies the rows and inflates both counts.
  const [documentCounts, chunkCounts] = projectIds.length
    ? await Promise.all([
        db
          .select({ projectId: documents.projectId, total: count() })
          .from(documents)
          .where(inArray(documents.projectId, projectIds))
          .groupBy(documents.projectId),
        db
          .select({ projectId: chunks.projectId, total: count() })
          .from(chunks)
          .where(inArray(chunks.projectId, projectIds))
          .groupBy(chunks.projectId),
      ])
    : [[], []];

  const documentsByProject = new Map(
    documentCounts.map((row) => [row.projectId, row.total]),
  );
  const chunksByProject = new Map(chunkCounts.map((row) => [row.projectId, row.total]));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <div>
          <Link
            href="/"
            className="font-mono text-sm tracking-tight text-neutral-400 hover:text-white"
          >
            citeline
          </Link>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as {session.user.email ?? session.user.name}
          </p>
        </div>
        <SignOutButton />
      </header>

      <section className="mt-16">
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Index a documentation site
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Point Citeline at a sitemap. Pages are crawled in the background,
          split at heading boundaries, and embedded for retrieval. Re-crawls
          skip pages whose content has not changed.
        </p>
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-6">
          <NewProjectForm />
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-medium text-white">Projects</h2>

        {owned.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No projects yet. Create one above.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
            {owned.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/dashboard/${project.slug}`}
                  className="flex items-center justify-between px-6 py-4 transition hover:bg-neutral-900/60"
                >
                  <div>
                    <p className="text-sm font-medium text-white">{project.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-neutral-500">
                      /{project.slug}
                    </p>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {documentsByProject.get(project.id) ?? 0} pages ·{" "}
                    {chunksByProject.get(project.id) ?? 0} chunks
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
