/** Fetch with a hard timeout. Provider calls default to 4s. */
export async function fetchWithTimeout(
  url: string,
  {
    timeoutMs = 4000,
    headers,
    signal,
  }: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  return fetch(url, { headers, signal: combined, cache: "no-store" });
}
