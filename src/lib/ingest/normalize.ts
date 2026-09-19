import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

import type { DocSection } from "./chunk";

export type NormalizedPage = {
  title: string | null;
  sections: DocSection[];
};

/**
 * Chrome that adds no answers but plenty of noise. Left in the index it
 * pollutes retrieval, because every page then looks similar to every other.
 */
const REMOVE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "svg",
  "form",
  "nav",
  "aside",
  "footer",
  "header",
  "[aria-hidden='true']",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='search']",
  ".sidebar",
  ".toc",
  ".table-of-contents",
  ".breadcrumb",
  ".breadcrumbs",
  ".navbar",
  ".site-header",
  ".site-footer",
  ".edit-this-page",
  ".pagination",
  ".skip-link",
  ".announcement",
].join(",");

/** Tried in order; the first match is treated as the page body. */
const CONTENT_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  ".markdown-body",
  ".theme-doc-markdown",
  ".prose",
  "#main-content",
  "#content",
  ".content",
];

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,pre,ul,ol,table,blockquote,dl";
const HEADING_SELECTOR = "h1,h2,h3,h4,h5,h6";

function createTurndown() {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    hr: "---",
  });

  service.use(gfm);

  // Turndown escapes markdown punctuation by default, turning `expires_in`
  // into `expires\_in`. This text is fed to embeddings and Postgres full-text
  // search, never re-rendered, and the backslashes break lexical matching on
  // exactly the identifiers API documentation is full of.
  service.escape = (text) => text;

  // Heading permalinks ("#", "¶") render as stray link text in markdown.
  service.addRule("stripAnchorLinks", {
    filter: (node) =>
      node.nodeName === "A" &&
      /^[#¶§\s]*$/.test(node.textContent ?? "") &&
      (node.getAttribute("href") ?? "").startsWith("#"),
    replacement: () => "",
  });

  return service;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function headingLevel(tagName: string): number {
  return Number.parseInt(tagName.slice(1), 10);
}

/** Drops the trailing permalink glyph that most docs generators append. */
function cleanHeadingText(text: string): string {
  return text.replace(/[#¶§]+\s*$/, "").trim();
}

/**
 * Converts a documentation page into sections keyed by their heading trail.
 * Keeping the trail is what lets a citation say where in the page an answer
 * came from, and it measurably improves embedding quality.
 */
export function normalizeHtml(html: string): NormalizedPage {
  const $ = cheerio.load(html);
  const turndown = createTurndown();

  const documentTitle = $("title").first().text().trim() || null;

  $(REMOVE_SELECTORS).remove();

  const root =
    CONTENT_SELECTORS.map((selector) => $(selector).first()).find(
      (candidate) => candidate.length > 0,
    ) ?? $("body");

  const rootNode = root.get(0);
  if (!rootNode) return { title: documentTitle, sections: [] };

  const pageHeading = cleanHeadingText(root.find("h1").first().text());
  const title = pageHeading || documentTitle;

  // Blocks nested inside another block (a <ul> inside an <li>, a <p> inside a
  // <blockquote>) are already captured by their ancestor's conversion.
  const blocks = root
    .find(BLOCK_SELECTOR)
    .toArray()
    .filter(
      (element) =>
        $(element).parentsUntil(rootNode).filter(BLOCK_SELECTOR).length === 0,
    );

  const sections: DocSection[] = [];
  const stack: { level: number; text: string; anchor: string | null }[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n\n").trim();
    buffer = [];
    if (!content) return;
    sections.push({
      headingPath: stack.map((entry) => entry.text),
      anchor: stack.length > 0 ? stack[stack.length - 1].anchor : null,
      content,
    });
  };

  for (const element of blocks) {
    const node = $(element);
    const tagName = element.tagName.toLowerCase();

    if (node.is(HEADING_SELECTOR)) {
      flush();

      const text = cleanHeadingText(node.text());
      if (!text) continue;

      const level = headingLevel(tagName);
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      const explicitId =
        node.attr("id") ??
        node.find("[id]").first().attr("id") ??
        node.find("a[href^='#']").first().attr("href")?.slice(1);

      stack.push({ level, text, anchor: explicitId || slugify(text) });
      continue;
    }

    const markdown = turndown.turndown($.html(node)).trim();
    if (markdown) buffer.push(markdown);
  }

  flush();

  return { title, sections };
}
