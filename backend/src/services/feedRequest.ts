class FeedRequestError extends Error {}

/** Bound both headers and body reads; never propagate credential-bearing URLs. */
export async function requestFeed(
  url: string,
  token: string,
  timeoutMs: number,
  maxBytes: number
): Promise<Uint8Array> {
  let requestUrl: URL;
  try {
    requestUrl = new URL(url);
    if (!['http:', 'https:'].includes(requestUrl.protocol) || requestUrl.username || requestUrl.password) {
      throw new Error();
    }
    if (token) requestUrl.searchParams.set('acl:consumerKey', token);
    requestUrl.hash = '';
  } catch {
    throw new FeedRequestError('Invalid feed URL');
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(requestUrl.toString(), { signal, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FeedRequestError(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new FeedRequestError('Feed exceeds size limit');
    }
    if (!response.body) throw new FeedRequestError('Empty feed response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new FeedRequestError('Feed exceeds size limit');
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (error instanceof FeedRequestError) throw error;
    throw new FeedRequestError(signal.aborted ? 'Feed request timed out' : 'Feed request failed');
  }
}
