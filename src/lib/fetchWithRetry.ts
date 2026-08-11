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
    //
    // 403 (not on the invite allowlist) and 410 (account deleted) are verdicts
    // about WHO is calling. They cannot change between attempts, so retrying
    // only delays the explanation: the import tab sends batches of 80 rows, and
    // at 3 retries plus a final unconditional attempt a 400-row run spent ~23
    // seconds showing "מנתח…" before admitting the account is not invited.
    if (res.ok || res.status === 400 || res.status === 401 || res.status === 403
        || res.status === 410 || res.status === 429 || res.status === 503) {
      return res  // don't retry a decision that cannot change
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
    }
  }
  return fetch(url, options)  // final attempt
}
