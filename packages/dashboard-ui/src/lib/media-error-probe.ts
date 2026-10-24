export async function probeMediaError(url: string, signal: AbortSignal) {
  try {
    // Both artifact doors route GET. A single byte checks presence without downloading
    // a recording; even a server that ignores Range has its response body cancelled.
    const response = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal })
    try { await response.body?.cancel() } catch { /* The status still classifies the read. */ }
    return { status: response.status }
  } catch {
    return {}
  }
}
