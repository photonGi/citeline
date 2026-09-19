import { XMLParser } from "fast-xml-parser";

export type SitemapEntry = { url: string; lastModified: string | null };

export type ParsedSitemap = {
  entries: SitemapEntry[];
  /** Nested sitemap URLs, present when the document is a sitemap index. */
  sitemaps: string[];
};

/** Assets that are never documentation pages. */
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".avif",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".json",
  ".xml",
  ".txt",
  ".zip",
  ".gz",
  ".tar",
  ".pdf",
  ".mp4",
  ".webm",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

const TRACKING_PARAMS = /^(utm_|ref$|fbclid$|gclid$)/;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readLoc(node: unknown): string | null {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "loc" in node) {
    const loc = (node as { loc?: unknown }).loc;
    if (typeof loc === "string") return loc;
    if (typeof loc === "number") return String(loc);
  }
  return null;
}

/** Parses a sitemap or sitemap index. Unknown shapes yield empty results. */
export function parseSitemap(xml: string): ParsedSitemap {
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { entries: [], sitemaps: [] };
  }

  const index = parsed.sitemapindex as { sitemap?: unknown } | undefined;
  if (index) {
    const sitemaps = toArray(index.sitemap)
      .map(readLoc)
      .filter((loc): loc is string => Boolean(loc));
    return { entries: [], sitemaps };
  }

  const urlset = parsed.urlset as { url?: unknown } | undefined;
  if (!urlset) return { entries: [], sitemaps: [] };

  const entries: SitemapEntry[] = [];
  for (const node of toArray(urlset.url)) {
    const url = readLoc(node);
    if (!url) continue;
    const lastmod =
      node && typeof node === "object" && "lastmod" in node
        ? String((node as { lastmod?: unknown }).lastmod)
        : null;
    entries.push({ url, lastModified: lastmod });
  }

  return { entries, sitemaps: [] };
}

/**
 * Resolves a URL and strips the parts that create duplicate index entries:
 * fragments, tracking parameters and trailing slashes.
 */
export function canonicalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function isCrawlablePath(pathname: string): boolean {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return true;

  const extension = last.slice(dot).toLowerCase();
  if (extension === ".html" || extension === ".htm") return true;
  return !SKIP_EXTENSIONS.has(extension);
}

export function pathDepth(pathname: string): number {
  return pathname.split("/").filter(Boolean).length;
}

export type SelectOptions = {
  origin: string;
  maxPages: number;
  maxDepth: number;
};

/**
 * Applies the crawl budget: same origin only, no assets, depth-limited,
 * deduplicated, and capped at maxPages. The bounds exist to keep a runaway
 * crawl from exhausting the embedding quota.
 */
export function selectCrawlTargets(
  entries: SitemapEntry[],
  options: SelectOptions,
): string[] {
  const origin = new URL(options.origin).origin;
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const canonical = canonicalizeUrl(entry.url, origin);
    if (!canonical || seen.has(canonical)) continue;

    const url = new URL(canonical);
    if (url.origin !== origin) continue;
    if (!isCrawlablePath(url.pathname)) continue;
    if (pathDepth(url.pathname) > options.maxDepth) continue;

    seen.add(canonical);
    selected.push(canonical);
    if (selected.length >= options.maxPages) break;
  }

  return selected;
}
