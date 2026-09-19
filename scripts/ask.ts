/**
 * Runs the retrieval and answer pipeline outside the HTTP layer, printing what
 * was retrieved and why. Used to inspect answer quality and refusals.
 *
 * Usage:
 *   npm run ask -- --project drizzle-orm-docs-8c5b --q "How do I define a schema?"
 */
import { streamText } from "ai";
import { eq } from "drizzle-orm";

import { chatModel } from "@/lib/ai/gemini";
import { isUncited, validateCitations } from "@/lib/answer/citations";
import {
  buildContextBlock,
  buildSystemPrompt,
  buildUserPrompt,
  toCitationSources,
} from "@/lib/answer/prompt";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { retrieve, shouldRefuse } from "@/lib/retrieval/search";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const slug = arg("project");
  const question = arg("q");

  if (!slug || !question) {
    console.error('Usage: npm run ask -- --project <slug> --q "your question"');
    process.exit(1);
  }

  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.slug, slug))
    .limit(1);

  if (!project) {
    console.error(`No project with slug ${slug}`);
    process.exit(1);
  }

  console.log(`\n  Q: ${question}\n`);

  const started = Date.now();
  const retrieval = await retrieve({ projectId: project.id, question });
  const sources = retrieval.results.map((result) => result.item);

  console.log(
    `  retrieved ${sources.length} chunks in ${Date.now() - started}ms ` +
      `(top similarity ${retrieval.topSimilarity?.toFixed(3) ?? "n/a"}, ` +
      `lexical match: ${retrieval.hasLexicalMatch})`,
  );

  for (const [index, result] of retrieval.results.entries()) {
    const ranks = Object.entries(result.ranks)
      .map(([name, rank]) => `${name}#${rank}`)
      .join(" ");
    console.log(
      `    [${index + 1}] ${result.item.headingPath || "(no heading)"} — ${ranks}`,
    );
  }

  if (shouldRefuse(retrieval)) {
    console.log("\n  REFUSED: retrieval below relevance threshold\n");
    process.exit(0);
  }

  const result = streamText({
    model: chatModel,
    system: buildSystemPrompt(project.name),
    prompt: buildUserPrompt(question, buildContextBlock(sources)),
    temperature: 0.2,
  });

  let raw = "";
  for await (const delta of result.textStream) raw += delta;

  const validated = validateCitations(raw, toCitationSources(sources));

  console.log(`\n  A: ${validated.text}\n`);
  console.log(`  citations (${validated.citations.length}):`);
  for (const citation of validated.citations) {
    const link = citation.anchor ? `${citation.url}#${citation.anchor}` : citation.url;
    console.log(`    [${citation.marker}] ${link}`);
  }

  const dropped = (raw.match(/\[\d+\]/g) ?? []).length -
    (validated.text.match(/\[\d+\]/g) ?? []).length;
  if (dropped > 0) console.log(`\n  ${dropped} invalid marker(s) stripped`);
  if (isUncited(validated)) console.log("\n  WARNING: answer had no valid citation");

  console.log(`\n  total ${Date.now() - started}ms\n`);
  process.exit(0);
}

void main();
