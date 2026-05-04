export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  delayMs = 1500,
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options)
    if (res.ok || res.status === 400 || res.status === 401 || res.status === 429) {
      return res  // don't retry on client errors or rate limits
    }
    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delayMs * (attempt + 1)))
    }
  }
  return fetch(url, options)  // final attempt
}
