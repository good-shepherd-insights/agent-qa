// 2026-10-12 (440-01, D-03/D-02): the stated-value check, model-free, with its false-refusal
// controls. The subject is imported inside each cell so a missing module reds every row by name.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

async function load() {
  return await import('../stated-values.js')
}

const HISTORICAL_REQUEST = 'open the products page and check it says "Kitchen Appliances"'

describe('C440-STATED-VALUES', () => {
  it('a double-quoted string is one stated value, kept as typed', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check it says "Kitchen Appliances"')).toEqual([
      'Kitchen Appliances',
    ])
  })

  it('curly double quotes and word-bounded single quotes delimit a stated value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check it says “Sale”')).toEqual(['Sale'])
    expect(extractStatedValues("check it says 'Sale'")).toEqual(['Sale'])
  })

  it('an apostrophe inside a word opens no quote', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues("check the user's cart and don't skip it")).toEqual([])
  })

  it('numbers, prices, percentages and numeric dates are one value each', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues('add 2 items at $1,299.00 with 15% off on 2026-10-12 or 12/10/2026'),
    ).toEqual(['2', '$1,299.00', '15%', '2026-10-12', '12/10/2026'])
  })

  it('a month-name date is one value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('book it for October 12, 2026')).toEqual(['October 12, 2026'])
    expect(extractStatedValues('book it for 12 October 2026')).toEqual(['12 October 2026'])
  })

  it('a digit glued to a letter is not a stated value', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues('sign in with 2FA, check the h1 on the 3rd tab and open build 1.5a'),
    ).toEqual([])
  })

  it('a number in a URL or a host and port is not a stated value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('write a test for http://localhost:3000')).toEqual([])
    expect(extractStatedValues('open localhost:3000/products')).toEqual([])
    expect(extractStatedValues('at 10:30')).toEqual(['10:30'])
  })

  it('a number inside a quoted value is not listed again', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check it says "Total: $20"')).toEqual(['Total: $20'])
  })

  it('a value stated twice is listed once, in order of first appearance', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('"A" then 2 then "A"')).toEqual(['A', '2'])
    expect(extractStatedValues('"A""B"')).toEqual(['A', 'B'])
  })

  it('an empty or unclosed quote states nothing', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check it says ""')).toEqual([])
    expect(extractStatedValues('check it says "Kitchen Appliances')).toEqual([])
  })

  it('whitespace runs inside a quoted value are tidied', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('"Kitchen   Appliances"')).toEqual(['Kitchen Appliances'])
  })

  it('a value present word for word in a step is carried', async () => {
    const { missingStatedValues } = await load()
    expect(
      missingStatedValues(
        ['Kitchen Appliances'],
        ['Open the products page', 'Verify the products page says "Kitchen Appliances"'],
      ),
    ).toEqual([])
  })

  it('the historical substitution loses its value', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const steps = [
      'Open the Automation Exercise home page',
      'Click the " products" link',
      'Verify the products page says "All Products"',
    ]
    expect(missingStatedValues(extractStatedValues(HISTORICAL_REQUEST), steps)).toEqual([
      'Kitchen Appliances',
    ])
  })

  it('a case change is missing', async () => {
    const { missingStatedValues } = await load()
    expect(
      missingStatedValues(['Kitchen Appliances'], ['Verify the heading says "Kitchen appliances"']),
    ).toEqual(['Kitchen Appliances'])
  })

  it('a singular, plural or trimmed value is missing', async () => {
    const { missingStatedValues } = await load()
    expect(
      missingStatedValues(['Kitchen Appliance'], ['Verify "Kitchen Appliances" is shown']),
    ).toEqual(['Kitchen Appliance'])
    expect(
      missingStatedValues(['Kitchen Appliances'], ['Verify "Kitchen Appliance" is shown']),
    ).toEqual(['Kitchen Appliances'])
    expect(missingStatedValues(['Kitchen Appliances'], ['Verify "Kitchen" is shown'])).toEqual([
      'Kitchen Appliances',
    ])
    expect(missingStatedValues(['Sale'], ['Verify the Wholesale banner is shown'])).toEqual([
      'Sale',
    ])
  })

  it('a number is missing inside a longer number', async () => {
    const { missingStatedValues } = await load()
    expect(missingStatedValues(['1'], ['Set the quantity to 1.5'])).toEqual(['1'])
    expect(missingStatedValues(['1'], ['Set the quantity to 10'])).toEqual(['1'])
    expect(missingStatedValues(['5'], ['Set the quantity to 1.5'])).toEqual(['5'])
    expect(missingStatedValues(['$20'], ['Verify the total says $20.00'])).toEqual(['$20'])
    expect(missingStatedValues(['50'], ['Verify the discount says 50%'])).toEqual([])
  })

  it('whitespace and canonical Unicode are tidied, compatibility forms are not', async () => {
    const { missingStatedValues } = await load()
    expect(
      missingStatedValues(
        ['Kitchen Appliances'],
        ['Verify the heading says "Kitchen  Appliances"'],
      ),
    ).toEqual([])
    expect(missingStatedValues(['Café'], ['Open the Café menu'])).toEqual([])
    expect(missingStatedValues(['12'], ['Set the quantity to １２'])).toEqual(['12'])
  })

  it('numbers are compared as text', async () => {
    const { missingStatedValues } = await load()
    expect(missingStatedValues(['1.50'], ['Verify the price is 1.5'])).toEqual(['1.50'])
    expect(missingStatedValues(['$1,299.00'], ['Verify the price is $1299'])).toEqual(['$1,299.00'])
    expect(missingStatedValues(['2026-10-12'], ['Verify the date is 12/10/2026'])).toEqual([
      '2026-10-12',
    ])
  })

  it('only steps are searched', async () => {
    const { missingStatedValues } = await load()
    const draft = {
      testName: 'Confirm the Sale banner',
      context: 'The home page shows a "Sale" banner',
      target: 'Sale',
      steps: ['Open the home page', 'Verify the banner is shown'],
    }
    expect(missingStatedValues(['Sale'], draft.steps)).toEqual(['Sale'])
    expect(
      missingStatedValues(['Kitchen Appliances'], ['Verify Kitchen', 'Appliances is shown']),
    ).toEqual(['Kitchen Appliances'])
  })

  it("missing values keep the request's order", async () => {
    const { missingStatedValues, statedValuesMissingReason } = await load()
    expect(
      missingStatedValues(['Sale', '$20', 'Kitchen Appliances'], ['Verify the "Sale" banner']),
    ).toEqual(['$20', 'Kitchen Appliances'])
    expect(statedValuesMissingReason(['$20'])).toBe(
      'the request\'s stated values are missing: "$20"',
    )
  })

  it('a long adversarial request is checked in linear time', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const digits = `${'1.'.repeat(99_999)}1a`
    const quotes = "“a 'b ".repeat(40_000).slice(0, 200_000)
    expect(digits).toHaveLength(200_000)
    expect(quotes).toHaveLength(200_000)

    for (const request of [digits, quotes]) {
      const started = performance.now()
      const values = extractStatedValues(request)
      missingStatedValues([...values, '1', '1.1', 'a', 'b'], [request])
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })

  it('the module is pure', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../stated-values.ts', import.meta.url)),
      'utf8',
    )
    expect(source).not.toMatch(/^(import|export \* from)/m)
    expect(source).not.toMatch(/^(let|var) /m)
  })
})

describe('C440-FALSE-REFUSAL', () => {
  it('reworded unquoted words are kept', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    expect(
      missingStatedValues(extractStatedValues(HISTORICAL_REQUEST), [
        'Navigate to the catalogue',
        'Confirm the heading reads "Kitchen Appliances"',
      ]),
    ).toEqual([])
  })

  it('added steps and added checks are kept', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    expect(
      missingStatedValues(extractStatedValues(HISTORICAL_REQUEST), [
        'Sign in as the "shopper" user',
        'Open the products page',
        'Verify the products page says "Kitchen Appliances"',
        'Verify at least one product card is shown',
      ]),
    ).toEqual([])
  })

  it('a vague request is kept whatever the draft says', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues('test the products page')
    expect(values).toEqual([])
    expect(
      missingStatedValues(values, ['Open the home page', 'Verify "All Products" is shown']),
    ).toEqual([])
    expect(missingStatedValues([], [])).toEqual([])
  })

  it('a value inside a longer step phrase is kept', async () => {
    const { missingStatedValues } = await load()
    expect(
      missingStatedValues(
        ['Kitchen Appliances'],
        ['Verify the banner says "Kitchen Appliances Sale"'],
      ),
    ).toEqual([])
  })
})
