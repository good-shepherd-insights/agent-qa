// 2026-10-12 (440-01, D-03): the request's stated values and the draft steps that lose them. Pure,
// linear and model-free, because the request is untrusted text from any caller.

type QuoteKind = 'double' | 'curly' | 'single'
type ListRun = { next: number; delimiter: string }

const CURRENCY_SYMBOLS = '$€£¥₹'
const NUMBER_SEPARATORS = '.,:/-'
const SINGLE_QUOTE_OPENS_AFTER = ' ([\n'
const SINGLE_QUOTE_CLOSES_BEFORE = ' .,;:!?)]\n'
const LINE_BREAKS = '\n\r  '
const LIST_RUN_STARTS_AFTER = ':.!?'

const MONTH =
  '(?:January|February|March|April|May|June|July|August|September|October|November|December' +
  '|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\.?'
const DAY = '\\d{1,2}(?:st|nd|rd|th)?'
const MONTH_NAME_DATE =
  `(?<![\\p{L}\\p{N}])(?:${MONTH} ${DAY}(?:,? \\d{4})?|${DAY} ${MONTH}(?: \\d{4})?)` +
  '(?![\\p{L}\\p{N}])'
const STEP_LABEL = '(?<![\\p{L}\\p{N}])(?:Step|step|STEP) ([0-9]+)(?=[:)]|\\.(?:\\s|$)| [-–—])'

const HOST_AND_PORT = /^[A-Za-z][A-Za-z0-9.-]*:\d+(?:\/\S*)?[.,;!?)\]]*$/
const LEADING_LETTER_OR_NUMBER = /^[\p{L}\p{N}]/u
const TRAILING_LETTER_OR_NUMBER = /[\p{L}\p{N}]$/u

function tidy(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

function isSeparator(char: string | undefined): boolean {
  return char !== undefined && char.length === 1 && NUMBER_SEPARATORS.includes(char)
}

function letterOrNumberBefore(text: string, index: number): boolean {
  return TRAILING_LETTER_OR_NUMBER.test(text.slice(Math.max(0, index - 2), index))
}

function letterOrNumberAt(text: string, index: number): boolean {
  return LEADING_LETTER_OR_NUMBER.test(text.slice(index, index + 2))
}

function openerAt(text: string, index: number): QuoteKind | undefined {
  const char = text[index]
  if (char === '"') return 'double'
  if (char === '“') return 'curly'
  if (char !== "'" && char !== '‘') return undefined
  const before = text[index - 1]
  return before === undefined || SINGLE_QUOTE_OPENS_AFTER.includes(before) ? 'single' : undefined
}

function closerOf(text: string, kind: QuoteKind, from: number): number {
  if (kind === 'double') return text.indexOf('"', from)
  if (kind === 'curly') return text.indexOf('”', from)
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]
    if (char !== "'" && char !== '’') continue
    const after = text[index + 1]
    if (after === undefined || SINGLE_QUOTE_CLOSES_BEFORE.includes(after)) return index
  }
  return -1
}

function isAddress(chunk: string): boolean {
  return chunk.includes('://') || chunk.startsWith('www.') || HOST_AND_PORT.test(chunk)
}

function collapsedSpace(space: string): string {
  return [...space].some((char) => LINE_BREAKS.includes(char)) ? '\n' : ' '
}

function isSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\n'
}

function blankStepLabels(segment: string): string {
  return segment.replace(new RegExp(STEP_LABEL, 'gu'), (label: string, digits: string) => {
    return label.slice(0, label.length - digits.length) + ' '.repeat(digits.length)
  })
}

function listRunStartsAt(text: string, index: number, atTextStart: boolean): boolean {
  if (atTextStart && (index === 0 || (index === 1 && isSpace(text[0])))) return true
  const before = text[index - 1]
  if (before === '\n') return true
  return before === ' ' && LIST_RUN_STARTS_AFTER.includes(text[index - 2] ?? ' ')
}

// 2026-10-12 (440-07, CR-01): a list counts from 1 at a line, sentence or colon start, and each
// next number with the same delimiter continues it.
function blankListMarkers(segment: string, run: ListRun, atTextStart: boolean): string {
  const pieces: string[] = []
  let cursor = 0
  let index = 0
  while (index < segment.length) {
    const tokenStarts = index === 0 ? atTextStart : isSpace(segment[index - 1])
    const opens = segment[index] === '('
    const digitsStart = opens ? index + 1 : index
    let end = digitsStart
    while (tokenStarts && isDigit(segment[end])) end += 1
    if (end === digitsStart) {
      index += 1
      continue
    }
    const closer = segment[end]
    let delimiter: string | undefined
    if (opens) delimiter = closer === ')' ? '()' : undefined
    else if (closer === '.' || closer === ')') delimiter = closer
    const tokenEnd = end + 1
    if (delimiter === undefined || !isSpace(segment[tokenEnd])) {
      index = end
      continue
    }
    const digits = segment.slice(digitsStart, end)
    if (digits === '1' && listRunStartsAt(segment, index, atTextStart)) {
      run.next = 2
      run.delimiter = delimiter
    } else if (delimiter === run.delimiter && digits === String(run.next)) {
      run.next += 1
    } else {
      index = tokenEnd
      continue
    }
    pieces.push(segment.slice(cursor, index), ' '.repeat(tokenEnd - index))
    cursor = tokenEnd
    index = tokenEnd
  }
  pieces.push(segment.slice(cursor))
  return pieces.join('')
}

function unquotedValues(segment: string, run: ListRun, atTextStart: boolean): string[] {
  const found: { readonly at: number; readonly value: string }[] = []
  let text = blankListMarkers(blankStepLabels(segment), run, atTextStart)
    .replaceAll('\n', ' ')
    .split(' ')
    .map((chunk) => (isAddress(chunk) ? ' '.repeat(chunk.length) : chunk))
    .join(' ')

  const dates = [...text.matchAll(new RegExp(MONTH_NAME_DATE, 'gu'))]
  for (const match of dates) found.push({ at: match.index, value: match[0] })
  const pieces: string[] = []
  let cursor = 0
  for (const match of dates) {
    pieces.push(text.slice(cursor, match.index), ' '.repeat(match[0].length))
    cursor = match.index + match[0].length
  }
  pieces.push(text.slice(cursor))
  text = pieces.join('')

  let index = 0
  while (index < text.length) {
    if (!isDigit(text[index])) {
      index += 1
      continue
    }
    let start = index
    if (text[start - 1] === '-' && (start === 1 || ' ('.includes(text[start - 2] ?? '-'))) {
      start -= 1
    } else if (start > 0 && CURRENCY_SYMBOLS.includes(text[start - 1] ?? '-')) {
      start -= 1
    }
    let end = index
    while (isDigit(text[end])) end += 1
    while (isSeparator(text[end]) && isDigit(text[end + 1])) {
      end += 1
      while (isDigit(text[end])) end += 1
    }
    if (text[end] === '%') end += 1

    const startHolds =
      !letterOrNumberBefore(text, start) &&
      !(isSeparator(text[start - 1]) && isDigit(text[start - 2]))
    const endHolds =
      !letterOrNumberAt(text, end) && !(isSeparator(text[end]) && isDigit(text[end + 1]))
    if (startHolds && endHolds) found.push({ at: start, value: text.slice(start, end) })
    index = end
  }

  return found.sort((left, right) => left.at - right.at).map((entry) => entry.value)
}

export function extractStatedValues(request: string): readonly string[] {
  const text = request.normalize('NFC').replace(/\s+/g, collapsedSpace)
  const run: ListRun = { next: 0, delimiter: '' }
  const values: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    if (value === '' || seen.has(value)) return
    seen.add(value)
    values.push(value)
  }
  // An opener with no closer has none at any later index either, so its kind stops searching.
  const unclosed = new Set<QuoteKind>()

  let segmentStart = 0
  let index = 0
  while (index < text.length) {
    const kind = openerAt(text, index)
    if (kind !== undefined && !unclosed.has(kind)) {
      const close = closerOf(text, kind, index + 1)
      if (close === -1) {
        unclosed.add(kind)
      } else {
        const segment = text.slice(segmentStart, index)
        for (const value of unquotedValues(segment, run, segmentStart === 0)) add(value)
        add(tidy(text.slice(index + 1, close)))
        index = close + 1
        segmentStart = index
        continue
      }
    }
    index += 1
  }
  for (const value of unquotedValues(text.slice(segmentStart), run, segmentStart === 0)) add(value)
  return values
}

function startEdgeHolds(step: string, at: number, value: string): boolean {
  if (!LEADING_LETTER_OR_NUMBER.test(value)) return true
  if (letterOrNumberBefore(step, at)) return false
  return !(isDigit(value[0]) && isSeparator(step[at - 1]) && isDigit(step[at - 2]))
}

function endEdgeHolds(step: string, end: number, value: string): boolean {
  if (!TRAILING_LETTER_OR_NUMBER.test(value)) return true
  if (letterOrNumberAt(step, end)) return false
  return !(isDigit(value.at(-1)) && isSeparator(step[end]) && isDigit(step[end + 1]))
}

function carries(step: string, value: string): boolean {
  let from = 0
  while (from <= step.length) {
    const at = step.indexOf(value, from)
    if (at === -1) return false
    if (startEdgeHolds(step, at, value) && endEdgeHolds(step, at + value.length, value)) return true
    from = at + 1
  }
  return false
}

export function missingStatedValues(
  values: readonly string[],
  steps: readonly string[],
): readonly string[] {
  const tidiedSteps = steps.map(tidy)
  return values.filter((value) => {
    const wanted = tidy(value)
    return !tidiedSteps.some((step) => carries(step, wanted))
  })
}

export function statedValuesMissingReason(missing: readonly string[]): string {
  const listed = missing.map((value) => JSON.stringify(value)).join(', ')
  return `the request's stated values are missing: ${listed}`
}
