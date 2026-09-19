import { describe, expect, it } from "vitest";

import {
  canonicalizeUrl,
  isCrawlablePath,
  parseSitemap,
  pathDepth,
  selectCrawlTargets,
} from "./sitemap";

describe("parseSitemap", () => {
  it("reads a urlset with several entries", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://docs.acme.dev/intro</loc><lastmod>2026-01-02</lastmod></url>
        <url><loc>https://docs.acme.dev/auth</loc></url>
      </urlset>`;

    const { entries, sitemaps } = parseSitemap(xml);

    expect(sitemaps).toEqual([]);
    expect(entries).toEqual([
      { url: "https://docs.acme.dev/intro", lastModified: "2026-01-02" },
      { url: "https://docs.acme.dev/auth", lastModified: null },
    ]);
  });

  it("reads a urlset containing exactly one entry", () => {
    const xml = `<urlset><url><loc>https://docs.acme.dev/only</loc></url></urlset>`;
    expect(parseSitemap(xml).entries).toHaveLength(1);
  });

  it("reads a sitemap index instead of pages", () => {
    const xml = `<sitemapindex>
        <sitemap><loc>https://docs.acme.dev/sitemap-1.xml</loc></sitemap>
        <sitemap><loc>https://docs.acme.dev/sitemap-2.xml</loc></sitemap>
      </sitemapindex>`;

    const { entries, sitemaps } = parseSitemap(xml);

    expect(entries).toEqual([]);
    expect(sitemaps).toEqual([
      "https://docs.acme.dev/sitemap-1.xml",
      "https://docs.acme.dev/sitemap-2.xml",
    ]);
  });

  it("handles namespace-prefixed tags", () => {
    const xml = `<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sm:url><sm:loc>https://docs.acme.dev/ns</sm:loc></sm:url>
      </sm:urlset>`;

    expect(parseSitemap(xml).entries[0]?.url).toBe("https://docs.acme.dev/ns");
  });

  it("returns empty results for junk input", () => {
    expect(parseSitemap("not xml at all")).toEqual({ entries: [], sitemaps: [] });
    expect(parseSitemap("<html><body>nope</body></html>")).toEqual({
      entries: [],
      sitemaps: [],
    });
  });
});

describe("canonicalizeUrl", () => {
  it("strips fragments and tracking parameters", () => {
    expect(
      canonicalizeUrl("https://docs.acme.dev/auth?utm_source=x&page=2#refresh"),
    ).toBe("https://docs.acme.dev/auth?page=2");
  });

  it("removes a trailing slash but keeps the root", () => {
    expect(canonicalizeUrl("https://docs.acme.dev/auth/")).toBe(
      "https://docs.acme.dev/auth",
    );
    expect(canonicalizeUrl("https://docs.acme.dev/")).toBe("https://docs.acme.dev/");
  });

  it("resolves relative URLs against a base", () => {
    expect(canonicalizeUrl("/guides/auth", "https://docs.acme.dev")).toBe(
      "https://docs.acme.dev/guides/auth",
    );
  });

  it("rejects non-HTTP schemes and malformed input", () => {
    expect(canonicalizeUrl("mailto:hi@acme.dev")).toBeNull();
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
  });
});

describe("isCrawlablePath", () => {
  it("accepts extensionless and html paths", () => {
    expect(isCrawlablePath("/guides/auth")).toBe(true);
    expect(isCrawlablePath("/guides/auth.html")).toBe(true);
  });

  it("rejects assets", () => {
    expect(isCrawlablePath("/logo.png")).toBe(false);
    expect(isCrawlablePath("/bundle.js")).toBe(false);
    expect(isCrawlablePath("/spec.pdf")).toBe(false);
  });

  it("treats a dotfile-looking segment as crawlable", () => {
    expect(isCrawlablePath("/.well-known/page")).toBe(true);
  });
});

describe("pathDepth", () => {
  it("counts non-empty segments", () => {
    expect(pathDepth("/")).toBe(0);
    expect(pathDepth("/guides/auth/refresh")).toBe(3);
  });
});

describe("selectCrawlTargets", () => {
  const options = { origin: "https://docs.acme.dev", maxPages: 10, maxDepth: 3 };
  const entry = (url: string) => ({ url, lastModified: null });

  it("keeps same-origin pages only", () => {
    const targets = selectCrawlTargets(
      [entry("https://docs.acme.dev/auth"), entry("https://blog.acme.dev/post")],
      options,
    );

    expect(targets).toEqual(["https://docs.acme.dev/auth"]);
  });

  it("deduplicates URLs that canonicalise to the same page", () => {
    const targets = selectCrawlTargets(
      [
        entry("https://docs.acme.dev/auth"),
        entry("https://docs.acme.dev/auth/"),
        entry("https://docs.acme.dev/auth#refresh"),
      ],
      options,
    );

    expect(targets).toHaveLength(1);
  });

  it("enforces the depth limit", () => {
    const targets = selectCrawlTargets(
      [entry("https://docs.acme.dev/a/b/c/d/e")],
      options,
    );

    expect(targets).toEqual([]);
  });

  it("enforces the page cap", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry(`https://docs.acme.dev/page-${i}`),
    );

    expect(selectCrawlTargets(entries, { ...options, maxPages: 5 })).toHaveLength(5);
  });

  it("drops asset URLs found in the sitemap", () => {
    const targets = selectCrawlTargets(
      [entry("https://docs.acme.dev/diagram.png")],
      options,
    );

    expect(targets).toEqual([]);
  });
});
