import { describe, expect, it } from "vitest";

import { isAllowed, parseRobots } from "./robots";

const ROBOTS = `
# Acme docs
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /internal/
Disallow: /search
Allow: /internal/public
Crawl-delay: 2

Sitemap: https://docs.acme.dev/sitemap.xml
`;

describe("parseRobots", () => {
  it("uses the wildcard group by default", () => {
    const rules = parseRobots(ROBOTS);

    expect(rules.disallow).toEqual(["/internal/", "/search"]);
    expect(rules.allow).toEqual(["/internal/public"]);
    expect(rules.crawlDelaySeconds).toBe(2);
  });

  it("prefers rules for a named user-agent", () => {
    expect(parseRobots(ROBOTS, "BadBot").disallow).toEqual(["/"]);
  });

  it("collects sitemap declarations regardless of group", () => {
    expect(parseRobots(ROBOTS).sitemaps).toEqual([
      "https://docs.acme.dev/sitemap.xml",
    ]);
  });

  it("ignores comments and blank lines", () => {
    expect(parseRobots("# just a comment\n\n").disallow).toEqual([]);
  });

  it("shares one rule group across consecutive user-agent lines", () => {
    const rules = parseRobots("User-agent: a\nUser-agent: b\nDisallow: /x", "b");
    expect(rules.disallow).toEqual(["/x"]);
  });
});

describe("isAllowed", () => {
  const rules = parseRobots(ROBOTS);

  it("permits paths no rule matches", () => {
    expect(isAllowed(rules, "/guides/auth")).toBe(true);
  });

  it("blocks disallowed prefixes", () => {
    expect(isAllowed(rules, "/internal/secret")).toBe(false);
    expect(isAllowed(rules, "/search?q=token")).toBe(false);
  });

  it("lets a longer Allow override a shorter Disallow", () => {
    expect(isAllowed(rules, "/internal/public/page")).toBe(true);
  });

  it("supports wildcards and end-anchors", () => {
    const wildcard = parseRobots("User-agent: *\nDisallow: /*.json$");

    expect(isAllowed(wildcard, "/data/config.json")).toBe(false);
    expect(isAllowed(wildcard, "/data/config.json.html")).toBe(true);
  });

  it("permits everything when robots.txt is empty", () => {
    expect(isAllowed(parseRobots(""), "/anything")).toBe(true);
  });
});
