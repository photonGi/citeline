export const USER_AGENT =
  "CitelineBot/0.1 (+https://github.com/photonGi/citeline; documentation indexer)";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 3_000_000;

export type FetchedPage =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: string };

/**
 * Fetches a documentation page. Identifies itself, bounds the response, and
 * treats anything that is not HTML as a skip rather than a failure — sitemaps
 * routinely list feeds and redirects.
 */
export async function fetchPage(url: string): Promise<FetchedPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      return { ok: false, error: `unsupported content-type: ${contentType || "unknown"}` };
    }

    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_BYTES) {
      return { ok: false, error: `response too large (${length} bytes)` };
    }

    const html = await response.text();
    if (html.length > MAX_BYTES) {
      return { ok: false, error: "response too large" };
    }

    return { ok: true, html, finalUrl: response.url || url };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `timed out after ${FETCH_TIMEOUT_MS}ms`
          : error.message
        : String(error);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export type FetchedResource = {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
};

/**
 * Fetches a text resource such as robots.txt or a sitemap. Reports the status
 * rather than collapsing every problem into null — "404 at /sitemap.xml" is
 * actionable, "could not fetch" is not.
 */
export async function fetchResource(url: string): Promise<FetchedResource> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    });

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: response.ok ? await response.text() : "",
    };
  } catch {
    return { ok: false, status: 0, contentType: "", body: "" };
  } finally {
    clearTimeout(timeout);
  }
}
