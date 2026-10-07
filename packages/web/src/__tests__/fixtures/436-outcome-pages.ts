// Loopback fixture pages for the SC1 acceptance cells (436 D-28). Each page is a known answer:
// what an action does to the page, to the server's persisted state and to the browser's
// download and clipboard is fixed here, so a cell's verdict can be judged against it. Pages are
// served on 127.0.0.1 and opened as http://localhost:<port>/, a secure context, with
// Cache-Control: no-store, like live-stream-fixture-page.ts.

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** The bytes `/files/orders.csv` serves; the download cells hash them. */
export const ORDERS_CSV_BYTES = 'order,total\nORD-1001,42.50\nORD-1002,17.00\n'

export interface OutcomeState {
  saved: string[]
  archived: string[]
  counter: number
}

export interface OutcomePages {
  url(path: string): string
  /** The server's persisted state, read by the scripted verifiers. */
  readonly state: OutcomeState
  close(): Promise<void>
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
${body}
</body>
</html>
`
}

// "Export CSV" fetches the file through an attachment link and leaves the page as it was.
// "Prepare export" does nothing the browser or the page can observe.
const DOWNLOAD_PAGE = page('Exports', `
  <h1>Order exports</h1>
  <button id="prepare" onclick="window.prepared = true">Prepare export</button>
  <button id="export" onclick="exportCsv()">Export CSV</button>
  <script>
    function exportCsv() {
      const a = document.createElement('a')
      a.href = '/files/orders.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
  </script>`)

const PAGES: Record<string, string> = {
  '/download': DOWNLOAD_PAGE,
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
    ...extra,
  })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function startOutcomePages(): Promise<OutcomePages> {
  const state: OutcomeState = { saved: [], archived: [], counter: 0 }

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0]
      if (path === '/files/orders.csv') {
        send(res, 200, 'text/csv', ORDERS_CSV_BYTES, {
          'Content-Disposition': 'attachment; filename="orders.csv"',
        })
        return
      }
      const html = PAGES[path]
      if (req.method === 'GET' && html !== undefined) {
        send(res, 200, 'text/html; charset=utf-8', html)
        return
      }
      await readBody(req)
      send(res, 404, 'text/plain', 'not found')
    })()
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port

  return {
    url: (path: string) => `http://localhost:${String(port)}${path}`,
    state,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => { resolve() })
    }),
  }
}
