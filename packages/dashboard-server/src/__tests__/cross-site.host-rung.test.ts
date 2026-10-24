import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'

import {
  hostnameOfHostHeader,
  NON_LOOPBACK_HOST_REFUSAL,
  refuseCrossSiteRequest,
  refuseNonLoopbackHost,
} from '../server/cross-site.js'

function requestWith(input: {
  readonly host?: string
  readonly origin?: string
  readonly secFetchSite?: string
}): IncomingMessage {
  return {
    headers: {
      ...(input.host === undefined ? {} : { host: input.host }),
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.secFetchSite === undefined ? {} : { 'sec-fetch-site': input.secFetchSite }),
    },
  } as IncomingMessage
}

describe('the claimed Host parser', () => {
  it.each([
    ['localhost:3470', 'localhost'],
    ['127.0.0.1:3470', '127.0.0.1'],
    ['[::1]:3470', '::1'],
    ['[::1]', '::1'],
    ['localhost', 'localhost'],
    ['LOCALHOST:3470', 'localhost'],
    ['  localhost:3470\t', 'localhost'],
    ['evil.example:3470', 'evil.example'],
    ['localhost.evil.example:3470', 'localhost.evil.example'],
    ['127.0.0.2:3470', '127.0.0.2'],
    [undefined, ''],
    ['', ''],
    ['localhost:not-a-port', ''],
    ['localhost:3470/path', ''],
  ] as const)('parses %s as %s', (header, expected) => {
    expect(hostnameOfHostHeader(header)).toBe(expected)
  })
})

describe('the loopback Host rung', () => {
  it.each(['localhost:3470', '127.0.0.1:3470', '[::1]:3470'])(
    'admits the frozen loopback spelling %s',
    (host) => {
      expect(refuseNonLoopbackHost(requestWith({ host }))).toBeUndefined()
    },
  )

  it.each([
    ['evil.example:3470', 'a non-loopback name'],
    ['localhost.evil.example:3470', 'a loopback-looking suffix'],
    [undefined, 'an absent Host'],
    ['localhost:not-a-port', 'an unparseable Host'],
  ] as const)('refuses %s (%s)', (host, _description) => {
    expect(refuseNonLoopbackHost(requestWith({ host }))).toBe(NON_LOOPBACK_HOST_REFUSAL)
  })

  it('refuses 127.0.0.2:3470, a loopback interface outside the frozen member set', () => {
    expect(refuseNonLoopbackHost(requestWith({ host: '127.0.0.2:3470' })))
      .toBe(NON_LOOPBACK_HOST_REFUSAL)
  })
})

describe('the composed cross-site guard', () => {
  it('refuses the rebind shape before comparing two client-chosen authorities', () => {
    const request = requestWith({
      host: 'evil.example:3470',
      origin: 'http://evil.example:3470',
      secFetchSite: 'same-origin',
    })

    expect(
      refuseCrossSiteRequest(request),
      'the rebind-shaped request must stop at the claimed Host rung',
    ).toBe(NON_LOOPBACK_HOST_REFUSAL)
  })

  it.each([
    {
      name: 'the same-origin localhost page',
      request: { host: 'localhost:3470', origin: 'http://localhost:3470', secFetchSite: 'same-origin' },
    },
    {
      name: 'the Origin-absent local client',
      request: { host: '127.0.0.1:3470' },
    },
    {
      name: 'the bracketed IPv6 page with a matching Origin',
      request: { host: '[::1]:3470', origin: 'http://[::1]:3470', secFetchSite: 'same-origin' },
    },
  ] as const)('admits $name', ({ request }) => {
    expect(refuseCrossSiteRequest(requestWith(request))).toBeUndefined()
  })
})
