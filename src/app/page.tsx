import Link from "next/link";

import { auth } from "@/auth";
import { SignInButton } from "@/components/auth-buttons";

const capabilities = [
  {
    title: "Hybrid retrieval",
    body: "Vector search and Postgres full-text search run in parallel and are combined with reciprocal rank fusion, so exact symbols like useLayoutEffect rank as well as conceptual questions.",
  },
  {
    title: "Citations that resolve",
    body: "Every claim carries a marker linking to a source page and heading. Markers are validated against the retrieved context, and invented references are stripped before display.",
  },
  {
    title: "Honest refusals",
    body: "When retrieval confidence falls below threshold, Citeline says it does not know and records the question as a documentation gap instead of inventing an API.",
  },
  {
    title: "Content-gap reporting",
    body: "Unanswered questions are aggregated into a report, turning reader confusion into a prioritised writing backlog.",
  },
];

export default async function Home() {
  const session = await auth();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <span className="font-mono text-sm tracking-tight text-neutral-400">
          citeline
        </span>
        {session?.user ? (
          <Link
            href="/dashboard"
            className="text-sm text-neutral-300 transition hover:text-white"
          >
            Dashboard
          </Link>
        ) : null}
      </header>

      <div className="mt-24 max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Answers from your documentation, with receipts.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-neutral-400">
          Point Citeline at a documentation site, a GitHub repository, or an
          OpenAPI specification. Your readers ask questions in plain language
          and get answers grounded in your pages — every claim cited, and a
          refusal instead of a guess when the answer is not there.
        </p>

        <div className="mt-10 flex items-center gap-4">
          {session?.user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
            >
              Open dashboard
            </Link>
          ) : (
            <SignInButton />
          )}
          <span className="text-sm text-neutral-500">
            Free to try on any public docs site.
          </span>
        </div>
      </div>

      <section className="mt-28 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        {capabilities.map((capability) => (
          <div key={capability.title}>
            <h2 className="text-sm font-medium text-white">{capability.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              {capability.body}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
