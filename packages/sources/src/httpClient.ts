const RETRY_DELAYS_MS = [500, 1500];

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

/**
 * 10s-timeout, retrying fetch. Retries on a network error or a 5xx response
 * only — a 4xx is a configuration problem, not a transient one, and a 304 is
 * a success returned as-is (05-sources.md's operating rules).
 */
export async function fetchWithRetry(
  url: string,
  init: { headers: Record<string, string>; timeoutMs: number },
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url, {
        headers: init.headers,
        signal: AbortSignal.timeout(init.timeoutMs),
      });
      if (response.status === 304 || !isRetryableStatus(response.status)) {
        return response;
      }
      lastError = new Error(`${url} responded ${response.status}`);
    } catch (err) {
      lastError = err;
    }

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  throw lastError;
}
