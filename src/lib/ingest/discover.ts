import type { FetchedResource } from "./fetch-page";

export type ResourceFetcher = (url: string) => Promise<FetchedResource>;

/**
 * Fallback paths, tried only when robots.txt names no sitemap. Real
 * documentation sites disagree about this path far more than expected:
 * `/sitemap.xml` 404s on several popular ones that use `/sitemap-index.xml`.
 */
export const COMMON_SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap-index.xml",
  "/sitemap_index.xml",
  "/sitemap/sitemap.xml",
  "/docs/sitemap.xml",
];

/**
 * A missing sitemap frequently returns a 200 HTML page rather than a 404, so
 * the body has to be inspected instead of trusting the status.
 */
export function looksLikeSitemap(body: string): boolean {
  return /<(sitemapindex|urlset)\b/i.test(body);
}

export function sitemapsFromRobots(text: string): string[] {
  return [...text.matchAll(/^[^\S\n]*sitemap:[^\S\n]*(\S+)/gim)].map(
    (match) => match[1],
  );
}

export type SitemapResolution =
  | { ok: true; url: string; xml: string; via: "input" | "robots" | "guess" }
  | { ok: false; error: string; tried: string[] };

/**
 * Accepts either a sitemap URL or a plain documentation URL and finds the
 * sitemap: the given URL if it is one, then robots.txt, then common paths.
 * The fetcher is injected so this is testable without network access.
 */
export async function resolveSitemap(
  input: string,
  fetchResource: ResourceFetcher,
): Promise<SitemapResolution> {
  let base: URL;
  try {
    base = new URL(input.trim());
  } catch {
    return { ok: false, error: "not a valid URL", tried: [] };
  }

  if (base.protocol !== "http:" && base.protocol !== "https:") {
    return { ok: false, error: "only http and https are supported", tried: [] };
  }

  const tried: string[] = [];

  const attempt = async (
    url: string,
    via: "input" | "robots" | "guess",
  ): Promise<SitemapResolution | null> => {
    if (tried.includes(url)) return null;
    tried.push(url);

    const response = await fetchResource(url);
    if (!response.ok || !looksLikeSitemap(response.body)) return null;

    return { ok: true, url, xml: response.body, via };
  };

  if (/\.xml$/i.test(base.pathname)) {
    const direct = await attempt(base.toString(), "input");
    if (direct) return direct;
  }

  const robots = await fetchResource(new URL("/robots.txt", base.origin).toString());
  if (robots.ok) {
    for (const candidate of sitemapsFromRobots(robots.body)) {
      let resolved: string;
      try {
        resolved = new URL(candidate, base.origin).toString();
      } catch {
        continue;
      }
      const found = await attempt(resolved, "robots");
      if (found) return found;
    }
  }

  for (const path of COMMON_SITEMAP_PATHS) {
    const found = await attempt(new URL(path, base.origin).toString(), "guess");
    if (found) return found;
  }

  return {
    ok: false,
    error: `no sitemap found for ${base.origin}`,
    tried,
  };
}
