import { generateText } from "ai";

import { chatModel } from "@/lib/ai/gemini";

export type HistoryTurn = { role: "user" | "assistant"; content: string };

/** Only the last few turns matter, and they keep the rewrite call cheap. */
const HISTORY_TURNS = 4;

/**
 * Rewrites a follow-up into a standalone question.
 *
 * Without this, "what about the second one?" is embedded literally and
 * retrieves nothing, because the pronouns carry all the meaning and none of
 * the vocabulary.
 */
export async function rewriteFollowUp(
  history: HistoryTurn[],
  question: string,
): Promise<string> {
  if (history.length === 0) return question;

  const transcript = history
    .slice(-HISTORY_TURNS)
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: chatModel,
      prompt: [
        "Rewrite the follow-up question so it stands alone, resolving pronouns",
        "and references using the conversation. Reply with the rewritten",
        "question only, no preamble. If it already stands alone, repeat it",
        "unchanged.",
        "",
        transcript,
        `Follow-up: ${question}`,
      ].join("\n"),
    });

    const rewritten = text.trim();
    // A rewrite that collapses or balloons is a malformed response, not a
    // better query; fall back rather than retrieving on garbage.
    if (!rewritten || rewritten.length > question.length * 8) return question;
    return rewritten;
  } catch {
    return question;
  }
}
