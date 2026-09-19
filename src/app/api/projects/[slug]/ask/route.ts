import { streamText } from "ai";
import { and, asc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/auth";
import { chatModel } from "@/lib/ai/gemini";
import {
  isUncited,
  validateCitations,
  type CitationSource,
} from "@/lib/answer/citations";
import {
  buildContextBlock,
  buildSystemPrompt,
  buildUserPrompt,
  REFUSAL_SENTENCE,
  toCitationSources,
} from "@/lib/answer/prompt";
import { rewriteFollowUp, type HistoryTurn } from "@/lib/answer/rewrite";
import { getDb } from "@/lib/db/client";
import { conversations, messages, projects, queryLogs } from "@/lib/db/schema";
import { checkRateLimit } from "@/lib/ratelimit";
import { retrieve, shouldRefuse } from "@/lib/retrieval/search";

export const maxDuration = 60;

const askSchema = z.object({
  question: z.string().min(3).max(1000),
  conversationId: z.string().uuid().optional(),
});

/** Newline-delimited JSON: one event per line, no framing library needed. */
function line(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const started = Date.now();
  const { slug } = await params;

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const parsed = askSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = getDb();

  // A project is readable by its owner, or by anyone if it is a public demo.
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      isPublicDemo: projects.isPublicDemo,
    })
    .from(projects)
    .where(
      and(
        eq(projects.slug, slug),
        userId
          ? or(eq(projects.ownerId, userId), eq(projects.isPublicDemo, true))
          : eq(projects.isPublicDemo, true),
      ),
    )
    .limit(1);

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const limit = await checkRateLimit(userId ?? "anonymous");
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many questions. Try again in a minute." },
      { status: 429 },
    );
  }

  const { question, conversationId } = parsed.data;

  const history: HistoryTurn[] = conversationId
    ? (
        await db
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(asc(messages.createdAt))
      ).map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      }))
    : [];

  const searchQuery = await rewriteFollowUp(history, question);
  const retrieval = await retrieve({ projectId: project.id, question: searchQuery });
  const sources = retrieval.results.map((result) => result.item);
  const citationSources: CitationSource[] = toCitationSources(sources);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answerText = "";
      let refused = false;

      const finish = async () => {
        const validated = refused
          ? { text: answerText, citations: [] }
          : validateCitations(answerText, citationSources);

        // An answer nobody can check is not an answer this product ships.
        const unsupported = !refused && isUncited(validated);
        const finalText = unsupported
          ? `${REFUSAL_SENTENCE} The retrieved pages did not support a citable answer.`
          : validated.text;

        // The model can decline while still citing the topics it does cover.
        // Counting that as answered would hide real gaps from the gap report.
        const declined = finalText.trimStart().startsWith(REFUSAL_SENTENCE);
        const answered = !refused && !unsupported && !declined;

        const activeConversationId =
          conversationId ??
          (
            await db
              .insert(conversations)
              .values({ projectId: project.id, userId })
              .returning({ id: conversations.id })
          )[0].id;

        await db.insert(messages).values([
          {
            conversationId: activeConversationId,
            role: "user",
            content: question,
          },
          {
            conversationId: activeConversationId,
            role: "assistant",
            content: finalText,
            citations: validated.citations,
            refused: !answered,
          },
        ]);

        await db.insert(queryLogs).values({
          projectId: project.id,
          question,
          rewrittenQuestion: searchQuery === question ? null : searchQuery,
          answered,
          topScore: retrieval.topSimilarity,
          retrievedChunkIds: sources.map((source) => source.id),
          latencyMs: Date.now() - started,
          surface: "app",
        });

        controller.enqueue(
          line({
            type: "final",
            text: finalText,
            citations: validated.citations,
            answered,
            conversationId: activeConversationId,
          }),
        );
        controller.close();
      };

      try {
        if (shouldRefuse(retrieval)) {
          refused = true;
          answerText = REFUSAL_SENTENCE;
          controller.enqueue(line({ type: "delta", text: answerText }));
          await finish();
          return;
        }

        const result = streamText({
          model: chatModel,
          system: buildSystemPrompt(project.name),
          prompt: buildUserPrompt(searchQuery, buildContextBlock(sources)),
          temperature: 0.2,
        });

        for await (const delta of result.textStream) {
          answerText += delta;
          controller.enqueue(line({ type: "delta", text: delta }));
        }

        await finish();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(line({ type: "error", message }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
