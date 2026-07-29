export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delayMs = 1500,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options)
    // 503 is our own "AI paused" answer, not a transient upstream failure —
    // retrying it triples the quota bookkeeping during the exact incident the
    // pause exists to contain.
    if (res.ok || res.status === 400 || res.status === 401 || res.status === 429 || res.status === 503) {
      return res  // don't retry on client errors or rate limits
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
    }
  }
  return fetch(url, options)  // final attempt
}
