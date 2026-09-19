"use client";

import { useRef, useState } from "react";

import type { Citation } from "@/lib/db/schema";

type Turn = {
  role: "user" | "assistant";
  text: string;
  citations: Citation[];
  streaming?: boolean;
};

const SUGGESTIONS = [
  "How do I define a schema?",
  "What is the difference between the query API and select?",
  "How do I run migrations?",
];

/** Renders `[1]` markers as links to the cited section. */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const byMarker = new Map(citations.map((citation) => [citation.marker, citation]));
  const parts = text.split(/(\[\d+\])/g);

  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap text-neutral-200">
      {parts.map((part, index) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const citation = match ? byMarker.get(Number(match[1])) : undefined;

        if (!citation) return <span key={index}>{part}</span>;

        return (
          <a
            key={index}
            href={citation.anchor ? `${citation.url}#${citation.anchor}` : citation.url}
            target="_blank"
            rel="noreferrer"
            title={citation.headingPath || citation.url}
            className="mx-0.5 rounded bg-neutral-800 px-1 py-0.5 align-super text-[10px] text-neutral-300 no-underline hover:bg-neutral-700 hover:text-white"
          >
            {citation.marker}
          </a>
        );
      })}
    </p>
  );
}

export function AskPanel({ slug }: { slug: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setQuestion("");
    setTurns((previous) => [
      ...previous,
      { role: "user", text: trimmed, citations: [] },
      { role: "assistant", text: "", citations: [], streaming: true },
    ]);

    const updateAnswer = (update: Partial<Turn>) => {
      setTurns((previous) => {
        const next = [...previous];
        next[next.length - 1] = { ...next[next.length - 1], ...update };
        return next;
      });
    };

    try {
      const response = await fetch(`/api/projects/${slug}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmed, conversationId: conversationId.current }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(detail.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";

      // The stream is newline-delimited JSON; a chunk can split a line.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const raw of lines) {
          if (!raw.trim()) continue;
          const event = JSON.parse(raw);

          if (event.type === "delta") {
            streamed += event.text;
            updateAnswer({ text: streamed });
          } else if (event.type === "final") {
            conversationId.current = event.conversationId;
            updateAnswer({
              text: event.text,
              citations: event.citations ?? [],
              streaming: false,
            });
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

      updateAnswer({ streaming: false });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
      setTurns((previous) => previous.slice(0, -1));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40">
      <div className="max-h-[28rem] space-y-6 overflow-y-auto px-6 py-6">
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-400">
              Ask a question. Every claim is answered from the indexed pages and
              linked back to the section it came from.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  className="rounded-full border border-neutral-800 px-3 py-1 text-xs text-neutral-400 transition hover:border-neutral-600 hover:text-white"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <p key={index} className="text-sm font-medium text-white">
              {turn.text}
            </p>
          ) : (
            <div key={index} className="space-y-3">
              {turn.text ? (
                <AnswerText text={turn.text} citations={turn.citations} />
              ) : (
                <p className="text-sm text-neutral-500">Searching the index…</p>
              )}

              {turn.citations.length > 0 ? (
                <ul className="space-y-1 border-l border-neutral-800 pl-3">
                  {turn.citations.map((citation) => (
                    <li key={citation.marker} className="text-xs text-neutral-500">
                      <span className="text-neutral-600">[{citation.marker}]</span>{" "}
                      <a
                        href={
                          citation.anchor
                            ? `${citation.url}#${citation.anchor}`
                            : citation.url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-neutral-300"
                      >
                        {citation.headingPath || citation.title || citation.url}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex gap-3 border-t border-neutral-800 px-6 py-4"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this documentation…"
          disabled={busy}
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-white placeholder:text-neutral-600 focus:border-neutral-600 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-40"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </form>

      {error ? (
        <p className="px-6 pb-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
