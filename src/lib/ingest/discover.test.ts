import { describe, expect, it, vi } from "vitest";

import {
  looksLikeSitemap,
  resolveSitemap,
  sitemapsFromRobots,
  type ResourceFetcher,
} from "./discover";

const SITEMAP_XML = `<?xml version="1.0"?><urlset><url><loc>https://docs.acme.dev/a</loc></url></urlset>`;
const INDEX_XML = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://docs.acme.dev/s1.xml</loc></sitemap></sitemapindex>`;
const NOT_FOUND_PAGE = "<!doctype html><html><body>404</body></html>";

/** Serves only the URLs present in `routes`; everything else 404s. */
function fakeFetcher(routes: Record<string, string>): ResourceFetcher {
  return vi.fn(async (url: string) => {
    const body = routes[url];
    if (body === undefined) {
      return { ok: false, status: 404, contentType: "text/html", body: "" };
    }
    return { ok: true, status: 200, contentType: "application/xml", body };
  });
}

describe("looksLikeSitemap", () => {
  it("recognises urlset and sitemapindex documents", () => {
    expect(looksLikeSitemap(SITEMAP_XML)).toBe(true);
    expect(looksLikeSitemap(INDEX_XML)).toBe(true);
  });

  it("rejects an HTML page served in place of a sitemap", () => {
    expect(looksLikeSitemap(NOT_FOUND_PAGE)).toBe(false);
  });
});

describe("sitemapsFromRobots", () => {
  it("extracts sitemap declarations case-insensitively", () => {
    const robots = "User-agent: *\nAllow: /\nSitemap: https://docs.acme.dev/sitemap-index.xml";
    expect(sitemapsFromRobots(robots)).toEqual([
      "https://docs.acme.dev/sitemap-index.xml",
    ]);
  });

  it("returns every declaration", () => {
    const robots = "sitemap: https://a.dev/1.xml\nSITEMAP:   https://a.dev/2.xml";
    expect(sitemapsFromRobots(robots)).toEqual([
      "https://a.dev/1.xml",
      "https://a.dev/2.xml",
    ]);
  });

  it("returns nothing when no sitemap is declared", () => {
    expect(sitemapsFromRobots("User-agent: *\nDisallow:")).toEqual([]);
  });
});

describe("resolveSitemap", () => {
  it("uses the given URL when it is already a sitemap", async () => {
    const fetcher = fakeFetcher({
      "https://docs.acme.dev/sitemap.xml": SITEMAP_XML,
    });

    const result = await resolveSitemap("https://docs.acme.dev/sitemap.xml", fetcher);

    expect(result).toMatchObject({ ok: true, via: "input" });
  });

  it("discovers a sitemap named in robots.txt", async () => {
    const fetcher = fakeFetcher({
      "https://docs.acme.dev/robots.txt":
        "User-agent: *\nSitemap: https://docs.acme.dev/sitemap-index.xml",
      "https://docs.acme.dev/sitemap-index.xml": INDEX_XML,
    });

    const result = await resolveSitemap("https://docs.acme.dev/guides", fetcher);

    expect(result).toMatchObject({
      ok: true,
      via: "robots",
      url: "https://docs.acme.dev/sitemap-index.xml",
    });
  });

  it("falls back to common paths when robots.txt is absent", async () => {
    const fetcher = fakeFetcher({
      "https://docs.acme.dev/sitemap-index.xml": INDEX_XML,
    });

    const result = await resolveSitemap("https://docs.acme.dev", fetcher);

    expect(result).toMatchObject({ ok: true, via: "guess" });
  });

  it("ignores an HTML page returned for a sitemap path", async () => {
    const fetcher = fakeFetcher({
      "https://docs.acme.dev/sitemap.xml": NOT_FOUND_PAGE,
      "https://docs.acme.dev/sitemap-index.xml": SITEMAP_XML,
    });

    const result = await resolveSitemap("https://docs.acme.dev/sitemap.xml", fetcher);

    expect(result).toMatchObject({
      ok: true,
      url: "https://docs.acme.dev/sitemap-index.xml",
    });
  });

  it("reports what it tried when nothing is found", async () => {
    const result = await resolveSitemap("https://docs.acme.dev", fakeFetcher({}));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("no sitemap found");
      expect(result.tried).toContain("https://docs.acme.dev/sitemap.xml");
      expect(result.tried.length).toBeGreaterThan(1);
    }
  });

  it("does not fetch the same candidate twice", async () => {
    const fetcher = fakeFetcher({});
    await resolveSitemap("https://docs.acme.dev/sitemap.xml", fetcher);

    const calls = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (call) => call[0],
    );
    const sitemapCalls = calls.filter(
      (url) => url === "https://docs.acme.dev/sitemap.xml",
    );

    expect(sitemapCalls).toHaveLength(1);
  });

  it("rejects invalid and non-HTTP input", async () => {
    const fetcher = fakeFetcher({});

    expect(await resolveSitemap("not a url", fetcher)).toMatchObject({ ok: false });
    expect(await resolveSitemap("ftp://acme.dev", fetcher)).toMatchObject({ ok: false });
  });
});
