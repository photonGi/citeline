"use client";

import { useActionState } from "react";

import { createProject, type CreateProjectState } from "@/app/dashboard/actions";

const EXAMPLES = [
  { label: "Drizzle ORM", url: "https://orm.drizzle.team" },
  { label: "Astro", url: "https://docs.astro.build" },
  { label: "Auth.js", url: "https://authjs.dev" },
];

export function NewProjectForm() {
  const [state, action, pending] = useActionState<CreateProjectState, FormData>(
    createProject,
    undefined,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr_auto]">
        <label className="block">
          <span className="text-xs text-neutral-400">Project name</span>
          <input
            name="name"
            required
            placeholder="Tailwind CSS docs"
            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs text-neutral-400">
            Docs URL or sitemap
          </span>
          <input
            name="sitemapUrl"
            required
            inputMode="url"
            placeholder="https://orm.drizzle.team"
            className="mt-1 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm text-white placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs text-neutral-400">Max pages</span>
          <input
            name="maxPages"
            type="number"
            min={1}
            max={500}
            defaultValue={25}
            className="mt-1 w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white focus:border-neutral-600 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
        >
          {pending ? "Starting crawl…" : "Create and index"}
        </button>

        <span className="text-xs text-neutral-500">
          Try:{" "}
          {EXAMPLES.map((example, index) => (
            <span key={example.url}>
              {index > 0 ? ", " : ""}
              <button
                type="button"
                onClick={(event) => {
                  const form = event.currentTarget.closest("form");
                  if (!form) return;
                  (form.elements.namedItem("name") as HTMLInputElement).value =
                    `${example.label} docs`;
                  (form.elements.namedItem("sitemapUrl") as HTMLInputElement).value =
                    example.url;
                }}
                className="underline decoration-neutral-700 underline-offset-2 hover:text-neutral-300"
              >
                {example.label}
              </button>
            </span>
          ))}
        </span>
      </div>

      {state?.error ? (
        <p className="text-sm text-red-400" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
