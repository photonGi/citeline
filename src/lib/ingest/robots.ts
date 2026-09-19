export type RobotsRules = {
  allow: string[];
  disallow: string[];
  sitemaps: string[];
  crawlDelaySeconds: number | null;
};

const EMPTY: RobotsRules = {
  allow: [],
  disallow: [],
  sitemaps: [],
  crawlDelaySeconds: null,
};

/**
 * Minimal robots.txt parser covering the directives that matter for a docs
 * crawl. Rules for the named user-agent win; otherwise the wildcard group
 * applies. Sitemap lines are global and collected regardless of group.
 */
export function parseRobots(text: string, userAgent = "*"): RobotsRules {
  const target = userAgent.toLowerCase();

  const groups = new Map<string, RobotsRules>();
  const sitemaps: string[] = [];
  let active: string[] = [];
  let previousLineWasAgent = false;

  const groupFor = (agent: string) => {
    let group = groups.get(agent);
    if (!group) {
      group = { allow: [], disallow: [], sitemaps: [], crawlDelaySeconds: null };
      groups.set(agent, group);
    }
    return group;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!previousLineWasAgent) active = [];
      active.push(value.toLowerCase());
      previousLineWasAgent = true;
      continue;
    }

    previousLineWasAgent = false;

    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    for (const agent of active) {
      const group = groupFor(agent);
      if (field === "allow" && value) group.allow.push(value);
      if (field === "disallow" && value) group.disallow.push(value);
      if (field === "crawl-delay") {
        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed)) group.crawlDelaySeconds = parsed;
      }
    }
  }

  const group = groups.get(target) ?? groups.get("*") ?? EMPTY;
  return { ...group, sitemaps };
}

function matches(pattern: string, path: string): boolean {
  const anchoredEnd = pattern.endsWith("$");
  const body = anchoredEnd ? pattern.slice(0, -1) : pattern;
  const segments = body.split("*");

  let cursor = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === "") continue;

    const found = i === 0 ? (path.startsWith(segment) ? 0 : -1) : path.indexOf(segment, cursor);
    if (found === -1) return false;
    cursor = found + segment.length;
  }

  return anchoredEnd ? cursor === path.length : true;
}

/**
 * Longest matching rule wins; ties go to Allow, per the robots specification.
 * An unmatched path is permitted.
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;

  for (const pattern of rules.allow) {
    if (matches(pattern, path)) bestAllow = Math.max(bestAllow, pattern.length);
  }
  for (const pattern of rules.disallow) {
    if (matches(pattern, path)) bestDisallow = Math.max(bestDisallow, pattern.length);
  }

  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}
