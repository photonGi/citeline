import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth-buttons";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const owned = await getDb()
    .select({ id: projects.id, name: projects.name, slug: projects.slug })
    .from(projects)
    .where(eq(projects.ownerId, session.user.id));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <div>
          <span className="font-mono text-sm tracking-tight text-neutral-400">
            citeline
          </span>
          <p className="mt-1 text-sm text-neutral-500">
            Signed in as {session.user.email ?? session.user.name}
          </p>
        </div>
        <SignOutButton />
      </header>

      <h1 className="mt-16 text-2xl font-semibold tracking-tight text-white">
        Projects
      </h1>

      {owned.length === 0 ? (
        <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-8">
          <p className="text-sm text-neutral-400">
            No projects yet. A project holds one documentation source and the
            index built from it.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {owned.map((project) => (
            <li key={project.id} className="px-6 py-4">
              <p className="text-sm font-medium text-white">{project.name}</p>
              <p className="mt-0.5 font-mono text-xs text-neutral-500">
                /{project.slug}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
