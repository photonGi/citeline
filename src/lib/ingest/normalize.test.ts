import { describe, expect, it } from "vitest";

import { normalizeHtml, slugify } from "./normalize";

const PAGE = `
<!doctype html>
<html>
  <head><title>Authentication | Acme Docs</title></head>
  <body>
    <header class="site-header"><a href="/">Acme</a></header>
    <nav class="navbar"><a href="/pricing">Pricing</a></nav>
    <aside class="sidebar"><ul><li><a href="/intro">Introduction</a></li></ul></aside>
    <main>
      <h1 id="authentication">Authentication<a href="#authentication">#</a></h1>
      <p>Acme uses bearer tokens.</p>
      <h2 id="refresh-tokens">Refresh tokens</h2>
      <p>Access tokens expire after one hour.</p>
      <pre><code class="language-ts">const token = await refresh();</code></pre>
      <h3>Rotation</h3>
      <p>Rotate the refresh token on every use.</p>
      <table>
        <thead><tr><th>Field</th><th>Type</th></tr></thead>
        <tbody><tr><td>expires_in</td><td>number</td></tr></tbody>
      </table>
      <h2>Scopes</h2>
      <ul><li>read<ul><li>read:user</li></ul></li><li>write</li></ul>
    </main>
    <footer class="site-footer">© Acme</footer>
    <script>window.analytics = true;</script>
  </body>
</html>
`;

describe("slugify", () => {
  it("produces a fragment-safe slug", () => {
    expect(slugify("Refresh Tokens & Rotation!")).toBe("refresh-tokens-rotation");
  });
});

describe("normalizeHtml", () => {
  const page = normalizeHtml(PAGE);
  const allContent = page.sections.map((section) => section.content).join("\n");

  it("prefers the page h1 as the title", () => {
    expect(page.title).toBe("Authentication");
  });

  it("drops navigation, sidebar, header, footer and scripts", () => {
    expect(allContent).not.toContain("Pricing");
    expect(allContent).not.toContain("Introduction");
    expect(allContent).not.toContain("© Acme");
    expect(allContent).not.toContain("window.analytics");
  });

  it("builds a nested heading trail", () => {
    const trails = page.sections.map((section) => section.headingPath.join(" > "));

    expect(trails).toContain("Authentication");
    expect(trails).toContain("Authentication > Refresh tokens");
    expect(trails).toContain("Authentication > Refresh tokens > Rotation");
    expect(trails).toContain("Authentication > Scopes");
  });

  it("keeps section bodies free of their own heading text", () => {
    const rotation = page.sections.find(
      (section) => section.headingPath.at(-1) === "Rotation",
    );

    expect(rotation).toBeDefined();
    expect(rotation!.content).toContain("Rotate the refresh token");
    expect(rotation!.content).not.toContain("# Rotation");
  });

  it("uses the heading id as the citation anchor", () => {
    const refresh = page.sections.find(
      (section) => section.headingPath.at(-1) === "Refresh tokens",
    );

    expect(refresh?.anchor).toBe("refresh-tokens");
  });

  it("strips heading permalink markers from the trail", () => {
    expect(page.sections[0].headingPath).toEqual(["Authentication"]);
  });

  it("preserves fenced code with its language", () => {
    expect(allContent).toContain("```ts");
    expect(allContent).toContain("const token = await refresh();");
  });

  it("converts tables to markdown rather than discarding them", () => {
    expect(allContent).toContain("| Field | Type |");
    expect(allContent).toContain("expires_in");
  });

  it("renders a nested list once, not twice", () => {
    const occurrences = allContent.split("read:user").length - 1;
    expect(occurrences).toBe(1);
  });

  it("returns no sections for an empty document", () => {
    expect(normalizeHtml("<html><body></body></html>").sections).toEqual([]);
  });
});
