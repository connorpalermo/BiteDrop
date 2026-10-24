interface RobotsGroup {
  userAgent: string;
  disallow: string[];
}

function parseGroups(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;

    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (!key || !value) continue;

    if (key === 'user-agent') {
      current = { userAgent: value.toLowerCase(), disallow: [] };
      groups.push(current);
    } else if (key === 'disallow' && current) {
      current.disallow.push(value);
    }
  }

  return groups;
}

function selectGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | undefined {
  const bot = userAgent.split('/')[0]!.toLowerCase();
  return groups.find((g) => g.userAgent === bot) ?? groups.find((g) => g.userAgent === '*');
}

/**
 * Fails open: a missing/unreachable robots.txt, or no applicable group,
 * means "allowed" — a broken robots.txt is not a disallow.
 *
 * Allow: overrides are not implemented — a deliberate simplification,
 * acceptable for the two feeds this phase fetches (see phase-04 Review notes).
 */
export async function isFetchAllowed(
  feedUrl: string,
  userAgent: string,
  timeoutMs: number,
): Promise<boolean> {
  const robotsUrl = `${new URL(feedUrl).origin}/robots.txt`;

  let response: Response;
  try {
    response = await fetch(robotsUrl, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return true;
  }
  if (!response.ok) return true;

  const groups = parseGroups(await response.text());
  const group = selectGroup(groups, userAgent);
  if (!group) return true;

  const path = new URL(feedUrl).pathname;
  return !group.disallow.some((prefix) => prefix !== '' && path.startsWith(prefix));
}
