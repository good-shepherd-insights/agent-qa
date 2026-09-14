import {
  maskedMarker, NETWORK_BODY_CONTENT_TYPES, NETWORK_BODY_MAX_BYTES,
  NETWORK_CREDENTIAL_HEADERS, utf8Encode,
} from '@vostride/agent-qa-schema'
import type { EvidenceDocument, MaskFn } from '@vostride/agent-qa-schema'
import type { NetworkLogEntry } from '../result.js'

type NetworkRecord = Extract<EvidenceDocument, { kind: 'network' }>['records'][number]
const credentialHeaders: ReadonlySet<string> = new Set(NETWORK_CREDENTIAL_HEADERS)
const bodyContentTypes: ReadonlySet<string> = new Set(NETWORK_BODY_CONTENT_TYPES)

function maskHeaders(headers: Record<string, string>, mask: MaskFn): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    mask(name), mask(credentialHeaders.has(name.toLowerCase()) ? maskedMarker('secret') : value),
  ]))
}

function admittedBody(body: string | undefined, headers: Record<string, string>, mask: MaskFn): string | undefined {
  const types = Object.entries(headers).filter(([name]) => name.toLowerCase() === 'content-type')
  // Duplicate case variants and combined header values are ambiguous, even when one is textual.
  if (body === undefined || types.length !== 1) return undefined
  const type = types[0][1].split(';', 1)[0].trim().toLowerCase()
  if (!bodyContentTypes.has(type) || utf8Encode(body).length > NETWORK_BODY_MAX_BYTES) return undefined
  // A textual envelope does not admit embedded static assets or binary control bytes.
  if (/(?:data:\s*(?:image\/|font\/|application\/(?:octet-stream|font|x-font|javascript)|text\/(?:javascript|css))|<\s*(?:script|style)\b|@font-face\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd])/i.test(body)) return undefined
  const masked = mask(body)
  // A short registered value can expand into a longer placeholder. The stored body obeys
  // the same byte bound as the captured input; neither arm ever manufactures a partial body.
  return utf8Encode(masked).length <= NETWORK_BODY_MAX_BYTES ? masked : undefined
}

/** Project the adapter's drained records into the persisted network document. */
export function projectNetworkEvidence(
  records: readonly (NetworkLogEntry & Pick<NetworkRecord, 'requestSize' | 'responseSize'>)[],
  mask: MaskFn,
): Extract<EvidenceDocument, { kind: 'network' }> {
  return { schemaVersion: 1, kind: 'network', records: records.map(record => {
    const requestBody = admittedBody(record.requestBody, record.requestHeaders, mask)
    const body = admittedBody(record.body, record.responseHeaders, mask)
    return {
      url: mask(record.url), method: mask(record.method), status: record.status,
      requestHeaders: maskHeaders(record.requestHeaders, mask),
      responseHeaders: maskHeaders(record.responseHeaders, mask),
      ...(requestBody === undefined ? {} : { requestBody }),
      ...(body === undefined ? {} : { body }),
      startTime: record.startTime, endTime: record.endTime,
      ...(record.timing === undefined ? {} : { timing: Object.fromEntries(
        Object.entries(record.timing).map(([name, value]) => [mask(name), value]),
      ) }),
      ...(record.requestSize === undefined ? {} : { requestSize: record.requestSize }),
      ...(record.responseSize === undefined ? {} : { responseSize: record.responseSize }),
    }
  }) }
}
