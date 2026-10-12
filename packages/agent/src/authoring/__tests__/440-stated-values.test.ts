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

// 2026-10-12 (440-07, D-02/D-03; CR-01): list markers are not stated values.
describe('C440-FALSE-REFUSAL', () => {
  it('a numbered list written inline states no list number', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues(
      '1. open the shop 2. click the "Add to cart" button 3. check the cart',
    )
    expect(values).toEqual(['Add to cart'])
    expect(
      missingStatedValues(values, [
        'Open the shop',
        'Click the "Add to cart" button',
        'Verify the cart is shown',
      ]),
    ).toEqual([])
  })

  it('a numbered list written one item per line states no list number', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues(
        '1. open the products page\n2. click the first product\n3. check the "Add to cart" button is shown',
      ),
    ).toEqual(['Add to cart'])
    expect(extractStatedValues('1. open the shop\r\n2. add 3 items\r\n3. check the cart')).toEqual([
      '3',
    ])
    expect(extractStatedValues('Test checkout\n1. open the shop\n2. add 2 items')).toEqual(['2'])
  })

  it('a list numbered with closing parentheses states no list number', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues('1) open the shop 2) add 2 items 3) check the total is $20'),
    ).toEqual(['2', '$20'])
    expect(
      extractStatedValues('1) open the shop\n2) add 2 items\n3) check the total is $20'),
    ).toEqual(['2', '$20'])
  })

  it('a list numbered in parentheses states no list number', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues(
      '(1) open the shop (2) click the "Add to cart" button (3) check the cart',
    )
    expect(values).toEqual(['Add to cart'])
    expect(
      missingStatedValues(values, [
        'Open the shop',
        'Click the "Add to cart" button',
        'Verify the cart is shown',
      ]),
    ).toEqual([])
    expect(
      extractStatedValues('(1) open the shop\n(2) add 2 items\n(3) check the total is $20'),
    ).toEqual(['2', '$20'])
    expect(extractStatedValues('Checkout test: (1) open the shop (2) add 2 items')).toEqual(['2'])
  })

  it('a numbered list after a colon or a sentence states no list number', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues('Checkout test: 1. open the shop 2. add 2 items 3. check "Add to cart"'),
    ).toEqual(['2', 'Add to cart'])
    expect(extractStatedValues('Test the cart. 1. add 2 items 2. check the total is $20')).toEqual([
      '2',
      '$20',
    ])
  })

  it('a step-labelled request states no step number', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues(
        'Step 1: open the products page. Step 2: check the heading says "All Products"',
      ),
    ).toEqual(['All Products'])
    expect(extractStatedValues('Step 1 - open the shop Step 2 - add 2 items')).toEqual(['2'])
    expect(extractStatedValues('step 1 – open the shop step 2 — add 2 items')).toEqual(['2'])
    expect(extractStatedValues('Step 1) open the shop. Step 2. add 2 items')).toEqual(['2'])
  })
})

describe('C440-STATED-VALUES', () => {
  it('a number, price or quoted value inside a list item is still a stated value', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues('1. open the shop 2. add 2 items 3. check the total is $20')
    expect(values).toEqual(['2', '$20'])
    expect(
      missingStatedValues(values, [
        'Open the shop',
        'Add items to the cart',
        'Verify the total is shown',
      ]),
    ).toEqual(['2', '$20'])
    expect(
      missingStatedValues(extractStatedValues('1. open the shop 2. click "Add to cart"'), [
        'Open the shop',
        'Click the cart button',
      ]),
    ).toEqual(['Add to cart'])
  })

  it('a list marker inside a quoted value is kept as typed', async () => {
    const { extractStatedValues } = await load()
    expect(
      extractStatedValues('1. check the heading says "Step 1: Cart" 2. click "2. Next"'),
    ).toEqual(['Step 1: Cart', '2. Next'])
    expect(extractStatedValues('(1) check the heading says "(2) Payment"')).toEqual(['(2) Payment'])
  })

  it('a list starts only at 1, at the start of the request, a line, a colon or a sentence', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('3. open the shop 4. click the cart')).toEqual(['3', '4'])
    expect(extractStatedValues('1 open the shop 2 click the cart')).toEqual(['1', '2'])
    expect(extractStatedValues('set the quantity to 2. Then check the cart')).toEqual(['2'])
    expect(extractStatedValues('Set the quantity to 1. Then set it to 2. Check the cart')).toEqual([
      '1',
      '2',
    ])
    expect(extractStatedValues('1. set the quantity to 3. 2. check the cart shows 3')).toEqual([
      '3',
    ])
    expect(extractStatedValues('(3) open the shop (4) click the cart')).toEqual(['3', '4'])
    expect(extractStatedValues('check the cart shows (1) item')).toEqual(['1'])
    expect(extractStatedValues('(1) open the shop (2) check the total (3000) is shown')).toEqual([
      '3000',
    ])
    expect(extractStatedValues('1. open the shop (2) add 3 items')).toEqual(['2', '3'])
  })

  it('a number written where the next list marker would go is read as that marker, the known leftover', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues('1. set the quantity to 2. Then check the cart')
    expect(values).toEqual([])
    expect(missingStatedValues(values, ['Set the quantity', 'Verify the cart is shown'])).toEqual(
      [],
    )
    expect(extractStatedValues('(1) set the quantity to (2) then check the cart')).toEqual([])
    expect(extractStatedValues('1. set the quantity to 2, then check the cart')).toEqual(['2'])
    expect(extractStatedValues('1. set the quantity to 2) then check the cart')).toEqual(['2'])
    expect(extractStatedValues('1. open the shop and set the quantity to 2.')).toEqual(['2'])
  })

  it('a step number with no label delimiter is a stated value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check step 2 of the wizard is shown')).toEqual(['2'])
    expect(extractStatedValues('check Step 2 of 3 is shown')).toEqual(['2', '3'])
    expect(extractStatedValues('check Step 1.5: the label')).toEqual(['1.5'])
    expect(extractStatedValues('check the heading says "Step 2: Payment"')).toEqual([
      'Step 2: Payment',
    ])
  })

  it('a long run of list markers and step labels is checked in linear time', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    for (const unit of ['1. 2. 3. ', 'Step 1: ', '\n1.\n', '1) a ', '(1) (2) (3) ']) {
      const request = unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000)
      expect(request).toHaveLength(200_000)

      const started = performance.now()
      const values = extractStatedValues(request)
      missingStatedValues([...values, '1'], [request])
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })
})

// 2026-10-12 (440-08, D-02/D-03; WR-01, WR-03): inch marks, in-word apostrophes and addresses state nothing.
describe('C440-FALSE-REFUSAL', () => {
  it('an inch mark opens no quoted value', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues('check the 15" laptop and the 13" laptop are listed')
    expect(values).toEqual(['15', '13'])
    expect(
      missingStatedValues(values, ['Verify the 15-inch and the 13-inch laptops are listed']),
    ).toEqual([])
  })

  it('an in-word apostrophe opens no quoted value', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    expect(extractStatedValues("check the '90s collection shows the 'Sale' banner")).toEqual([
      'Sale',
    ])
    expect(extractStatedValues("check the '90s collection and the users' cart")).toEqual([])
    const values = extractStatedValues('check the rock \'n\' roll page says "Top Hits"')
    expect(values).toEqual(['Top Hits'])
    expect(missingStatedValues(values, ['Verify the rock and roll page says "Top Hits"'])).toEqual(
      [],
    )
  })

  it('an IP address, with or without a port and path, states nothing', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('open 192.168.1.10 and check it')).toEqual([])
    expect(extractStatedValues('go to 127.0.0.1:3000/products and check 3 items')).toEqual(['3'])
    expect(extractStatedValues('open 192.168.1.10. Then check 4 items')).toEqual(['4'])
  })

  it('a bracketed IPv6 host and port states nothing', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('open the site at [::1]:3000 and check it')).toEqual([])
    expect(extractStatedValues('open [::1]:3000/cart and check 2 items')).toEqual(['2'])
  })

  it('a host and port in parentheses states nothing', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('open the app (localhost:3000) and check 2 items')).toEqual(['2'])
    expect(extractStatedValues('open the app (127.0.0.1:3000) and check 2 items')).toEqual(['2'])
  })
})

describe('C440-STATED-VALUES', () => {
  it('a quoted value next to an inch mark stays protected', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const values = extractStatedValues('check the 15" laptop shows "In Stock"')
    expect(values).toEqual(['15', 'In Stock'])
    expect(missingStatedValues(values, ['Verify the 15-inch laptop shows "Out of Stock"'])).toEqual(
      ['In Stock'],
    )
    expect(extractStatedValues('check the 5\'10" model and the "Sale" banner')).toEqual([
      '5',
      '10',
      'Sale',
    ])
  })

  it('a straight double quote opens after anything but a letter or number', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('check it says:"Sale"')).toEqual(['Sale'])
    expect(extractStatedValues('check it says ("Sale")')).toEqual(['Sale'])
  })

  it('a single-quoted value that starts with a number or is one capital letter is still a value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues("check the '2024 Sale' banner")).toEqual(['2024 Sale'])
    expect(extractStatedValues("check the '20% off' badge")).toEqual(['20% off'])
    expect(extractStatedValues("check size 'M' is selected")).toEqual(['M'])
  })

  it('a number shaped like part of an address is still a stated value', async () => {
    const { extractStatedValues } = await load()
    expect(extractStatedValues('book it (10:30) for 2 people')).toEqual(['10:30', '2'])
    expect(extractStatedValues('check the 16:9 player')).toEqual(['16:9'])
    expect(extractStatedValues('check version 1.2.3 is shown')).toEqual(['1.2.3'])
    expect(extractStatedValues('check the date 12.10.2026')).toEqual(['12.10.2026'])
    expect(extractStatedValues('check footnote [2] and (3000)')).toEqual(['2', '3000'])
  })

  it('a long request of inch marks, apostrophes and addresses is checked in linear time', async () => {
    const { extractStatedValues, missingStatedValues } = await load()
    const units = ['15" ', "a 'n' ", '[::1]:', '(127.0.0.1:3000 ', "'1a "]
    const requests = units.map((unit) =>
      unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000),
    )
    requests.push(`'${'1'.repeat(199_998)}a`)
    for (const request of requests) {
      expect(request).toHaveLength(200_000)

      const started = performance.now()
      const values = extractStatedValues(request)
      missingStatedValues([...values, '1'], [request])
      expect(performance.now() - started).toBeLessThan(2000)
    }
  })
})
