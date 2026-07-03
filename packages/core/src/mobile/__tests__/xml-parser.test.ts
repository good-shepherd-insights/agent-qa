import { describe, it, expect } from 'vitest'
import { buildScreenState } from '@vostride/agent-qa-runner'
import { parseMobileSource, buildRefEntries, deriveMobileScroll } from '../xml-parser.js'
import { normalizeRole, ANDROID_ROLE_MAP, IOS_ROLE_MAP } from '../role-map.js'

const ANDROID_LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,1920]" resource-id="" content-desc="" text="" enabled="true">
    <android.widget.LinearLayout bounds="[0,0][1080,1920]" resource-id="" content-desc="" text="" enabled="true">
      <android.widget.TextView bounds="[100,200][980,280]" resource-id="title" content-desc="" text="Welcome Back" enabled="true" />
      <android.widget.EditText bounds="[100,300][980,380]" resource-id="email" content-desc="Email" text="" enabled="true" />
      <android.widget.EditText bounds="[100,400][980,480]" resource-id="password" content-desc="Password" text="" enabled="true" />
      <android.widget.Button bounds="[100,500][980,580]" resource-id="login" content-desc="" text="Sign In" enabled="true" />
      <android.widget.Button bounds="[100,600][980,680]" resource-id="register" content-desc="" text="Sign Up" enabled="true" />
      <android.widget.ImageView bounds="[400,700][680,900]" resource-id="logo" content-desc="App Logo" enabled="true" />
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`

const IOS_LOGIN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication name="MyApp" label="MyApp">
    <XCUIElementTypeWindow x="0" y="0" width="390" height="844">
      <XCUIElementTypeOther x="0" y="0" width="390" height="844">
        <XCUIElementTypeStaticText label="Welcome Back" x="20" y="100" width="350" height="30" enabled="true" />
        <XCUIElementTypeTextField label="Email" x="20" y="150" width="350" height="40" enabled="true" />
        <XCUIElementTypeSecureTextField label="Password" x="20" y="200" width="350" height="40" enabled="true" />
        <XCUIElementTypeButton label="Sign In" x="20" y="260" width="350" height="44" enabled="true" />
        <XCUIElementTypeButton label="Sign Up" x="20" y="320" width="350" height="44" enabled="true" />
        <XCUIElementTypeImage label="App Logo" x="120" y="400" width="150" height="150" enabled="true" />
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`

describe('parseMobileSource → InterimNode[]', () => {
  describe('Android walk', () => {
    it('emits interactive/content nodes in document order (containers filtered)', () => {
      const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android')

      const roles = nodes.map(n => n.role)
      // FrameLayout/LinearLayout (group) are structural containers — never emitted.
      expect(roles).not.toContain('group')
      expect(roles).toEqual(['text', 'textbox', 'textbox', 'button', 'button', 'image'])

      const names = nodes.map(n => n.name)
      expect(names).toEqual(['Welcome Back', 'Email', 'Password', 'Sign In', 'Sign Up', 'App Logo'])
    })

    it('carries no ref, tree line, or ordinal on nodes', () => {
      const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android')
      for (const node of nodes) {
        expect(node).not.toHaveProperty('ref')
        expect(node).not.toHaveProperty('nth')
        expect(node).not.toHaveProperty('line')
      }
    })

    it('parses Android bounds correctly', () => {
      const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android')
      const email = nodes.find(n => n.name === 'Email')!
      expect(email.bounds).toEqual({ x: 100, y: 300, width: 880, height: 80 })
    })

    it('maps resource-id → labels.testId and content-desc → labels.ariaLabel', () => {
      const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android')

      const title = nodes.find(n => n.name === 'Welcome Back')!
      expect(title.labels?.testId).toBe('title')
      // content-desc was empty → ariaLabel typed-absent.
      expect(title.labels?.ariaLabel).toBeUndefined()

      const logo = nodes.find(n => n.name === 'App Logo')!
      expect(logo.labels?.testId).toBe('logo')
      expect(logo.labels?.ariaLabel).toBe('App Logo')
    })

    it('retains the raw platform attribute bag and nativeType', () => {
      const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android')
      const signIn = nodes.find(n => n.name === 'Sign In')!
      expect(signIn.nativeType).toBe('android.widget.Button')
      expect(signIn.attributes?.['resource-id']).toBe('login')
      expect(signIn.attributes?.text).toBe('Sign In')
      expect(signIn.attributes?.enabled).toBe('true')
    })

    it('lifts the full D-08 Android state signals only when the attribute is present', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.CheckBox bounds="[0,0][100,100]" text="Agree" content-desc="Accept terms" resource-id="agree" checkable="true" checked="true" selected="false" focused="true" scrollable="false" enabled="true" />
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android')
      const cb = nodes[0]

      expect(cb.role).toBe('checkbox')
      expect(cb.state?.enabled).toBe(true)
      expect(cb.state?.checked).toBe(true)
      expect(cb.state?.selected).toBe(false)
      expect(cb.state?.focused).toBe(true)
      // scrollable stays in the raw bag (scroll-derivation input), never on state.
      expect(cb.attributes?.scrollable).toBe('false')
      expect('scrollable' in (cb.state ?? {})).toBe(false)
    })

    it('leaves checked typed-absent when the widget is not checkable', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button bounds="[0,0][100,100]" text="Go" checkable="false" checked="false" enabled="true" />
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android')
      // No fabricated checked signal for a non-checkable control.
      expect('checked' in (nodes[0].state ?? {})).toBe(false)
    })

    it('derives visible=false for bounds fully outside the viewport, absent otherwise', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button bounds="[0,2000][500,2100]" text="Below" enabled="true" />
  <android.widget.Button bounds="[0,100][500,200]" text="OnScreen" enabled="true" />
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android', { width: 1080, height: 1920 })
      const below = nodes.find(n => n.name === 'Below')!
      const onScreen = nodes.find(n => n.name === 'OnScreen')!
      expect(below.state?.visible).toBe(false)
      expect('visible' in (onScreen.state ?? {})).toBe(false)
    })
  })

  describe('parentIndex nesting', () => {
    it('links children to the nearest surviving ancestor across filtered containers', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.LinearLayout bounds="[0,0][1080,1920]" text="" enabled="true">
    <android.widget.Button bounds="[0,0][500,100]" text="Outer" enabled="true">
      <android.widget.LinearLayout bounds="[0,0][500,100]" text="" enabled="true">
        <android.widget.TextView bounds="[10,10][100,40]" text="Inner" enabled="true" />
      </android.widget.LinearLayout>
    </android.widget.Button>
  </android.widget.LinearLayout>
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android')

      expect(nodes.map(n => n.name)).toEqual(['Outer', 'Inner'])
      const outer = nodes[0]
      const inner = nodes[1]
      // Outer's parent (LinearLayout) filtered → root.
      expect(outer.parentIndex).toBeUndefined()
      // Inner collapses through the skipped intermediate LinearLayout to Outer (index 0).
      expect(inner.parentIndex).toBe(0)
    })
  })

  describe('iOS walk', () => {
    it('emits interactive/content nodes with correct roles and names', () => {
      const { nodes } = parseMobileSource(IOS_LOGIN_XML, 'ios')
      const roles = nodes.map(n => n.role)
      expect(roles).toEqual(['text', 'textbox', 'textbox', 'button', 'button', 'image'])

      const names = nodes.map(n => n.name)
      expect(names).toEqual(['Welcome Back', 'Email', 'Password', 'Sign In', 'Sign Up', 'App Logo'])
    })

    it('parses iOS bounds from individual attributes', () => {
      const { nodes } = parseMobileSource(IOS_LOGIN_XML, 'ios')
      const email = nodes.find(n => n.name === 'Email')!
      expect(email.bounds).toEqual({ x: 20, y: 150, width: 350, height: 40 })
    })

    it('maps value/selected/enabled and never fabricates checked from value', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeSwitch label="Wifi" value="1" x="10" y="20" width="100" height="40" selected="true" enabled="false" />
</AppiumAUT>`
      const { nodes } = parseMobileSource(xml, 'ios')
      const sw = nodes[0]

      expect(sw.role).toBe('switch')
      expect(sw.value).toBe('1')
      expect(sw.state?.selected).toBe(true)
      expect(sw.state?.enabled).toBe(false)
      // value="1" must NOT become a checked signal — fabrication banned (D-08).
      expect('checked' in (sw.state ?? {})).toBe(false)
    })

    it('preserves native metadata for iOS picker wheel controls', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypePickerWheel value="March" x="20" y="300" width="350" height="80" enabled="true" />
</AppiumAUT>`
      const { nodes } = parseMobileSource(xml, 'ios')
      const picker = nodes[0]
      expect(['pickerwheel', 'spinbutton']).toContain(picker.role)
      expect(picker.name).toBe('March')
      expect(picker.value).toBe('March')
      expect(picker.nativeType).toBe('XCUIElementTypePickerWheel')
    })
  })

  describe('Cross-platform normalization', () => {
    it('produces the same normalized roles for equivalent screens', () => {
      const android = parseMobileSource(ANDROID_LOGIN_XML, 'android')
      const ios = parseMobileSource(IOS_LOGIN_XML, 'ios')
      expect(android.nodes.map(n => n.role).sort()).toEqual(ios.nodes.map(n => n.role).sort())
    })

    it('produces the same labels for equivalent screens', () => {
      const android = parseMobileSource(ANDROID_LOGIN_XML, 'android')
      const ios = parseMobileSource(IOS_LOGIN_XML, 'ios')
      expect(android.nodes.map(n => n.name).sort()).toEqual(ios.nodes.map(n => n.name).sort())
    })
  })

  describe('bounds parsing', () => {
    it('parses Android bounds=[x1,y1][x2,y2] correctly', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button bounds="[0,100][500,200]" text="Test" enabled="true" />
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android')
      expect(nodes[0].bounds).toEqual({ x: 0, y: 100, width: 500, height: 100 })
    })

    it('parses iOS x/y/width/height attributes correctly', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeButton label="Test" x="10" y="20" width="100" height="50" enabled="true" />
</AppiumAUT>`
      const { nodes } = parseMobileSource(xml, 'ios')
      expect(nodes[0].bounds).toEqual({ x: 10, y: 20, width: 100, height: 50 })
    })
  })

  describe('enabled mapping', () => {
    it('lifts enabled=false onto state', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button bounds="[0,0][500,100]" text="Disabled" enabled="false" />
</hierarchy>`
      const { nodes } = parseMobileSource(xml, 'android')
      expect(nodes[0].state?.enabled).toBe(false)
    })
  })
})

const DUP_BUTTONS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.LinearLayout bounds="[0,0][1080,1920]" text="" content-desc="" enabled="true">
    <android.widget.Button bounds="[0,0][500,100]" text="Submit" content-desc="" enabled="true" />
    <android.widget.Button bounds="[0,100][500,200]" text="Submit" content-desc="" enabled="true" />
    <android.widget.Button bounds="[0,200][500,300]" text="Cancel" content-desc="" enabled="true" />
  </android.widget.LinearLayout>
</hierarchy>`

describe('buildRefEntries (execute-time lastRefs reconstruction)', () => {
  it('reconstructs role/name/nth/bounds from nodes + the builder binding', () => {
    const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android', { width: 1080, height: 1920 })
    const { state, binding } = buildScreenState({
      platform: 'android',
      nodes,
      viewport: { width: 1080, height: 1920 },
      scroll: deriveMobileScroll(nodes, { width: 1080, height: 1920 }),
      coordSpace: 'viewport',
      timestamp: 0,
    })

    const entries = buildRefEntries(nodes, binding)

    // One entry per minted ref, keys aligned with the builder-minted refs.
    expect(Object.keys(entries).sort()).toEqual(Object.keys(binding).sort())

    // Resolve the Email textbox through its minted ref and check the v1 lastRefs shape.
    const emailEl = state.elements.find(e => e.name === 'Email')!
    const emailEntry = entries[emailEl.ref]
    expect(emailEntry.role).toBe('textbox')
    expect(emailEntry.name).toBe('Email')
    expect(emailEntry.nth).toBe(0)
    expect(emailEntry.bounds).toEqual({ x: 100, y: 300, width: 880, height: 80 })
    expect(emailEntry.nativeType).toBe('android.widget.EditText')
  })

  it('carries the same-screen nth ordinal for duplicate role+name pairs', () => {
    const { nodes } = parseMobileSource(DUP_BUTTONS_XML, 'android')
    const { state, binding } = buildScreenState({
      platform: 'android',
      nodes,
      viewport: { width: 1080, height: 1920 },
      scroll: deriveMobileScroll(nodes, { width: 1080, height: 1920 }),
      coordSpace: 'viewport',
      timestamp: 0,
    })

    const entries = buildRefEntries(nodes, binding)
    const submitRefs = state.elements.filter(e => e.name === 'Submit').map(e => e.ref)
    expect(submitRefs).toHaveLength(2)
    expect(entries[submitRefs[0]].nth).toBe(0)
    expect(entries[submitRefs[1]].nth).toBe(1)

    const cancelRef = state.elements.find(e => e.name === 'Cancel')!.ref
    expect(entries[cancelRef].nth).toBe(0)
  })
})

describe('deriveMobileScroll (best-effort D-10 approximation)', () => {
  it('returns max element extent as content size and zero offsets', () => {
    const { nodes } = parseMobileSource(ANDROID_LOGIN_XML, 'android', { width: 1080, height: 1920 })
    const scroll = deriveMobileScroll(nodes, { width: 1080, height: 1920 })
    // Tallest element bottom is the ImageView at y=700 h=200 → 900; viewport is taller.
    expect(scroll.offsetX).toBe(0)
    expect(scroll.offsetY).toBe(0)
    expect(scroll.contentWidth).toBe(1080)
    expect(scroll.contentHeight).toBe(1920)
  })

  it('grows content size past the viewport when bounds extend beyond it', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.Button bounds="[0,0][500,100]" text="Top" enabled="true" />
  <android.widget.Button bounds="[0,2500][500,2600]" text="Deep" enabled="true" />
</hierarchy>`
    const { nodes } = parseMobileSource(xml, 'android', { width: 1080, height: 1920 })
    const scroll = deriveMobileScroll(nodes, { width: 1080, height: 1920 })
    expect(scroll.contentHeight).toBe(2600)
  })

  it('falls back to the viewport dimensions when no node carries bounds', () => {
    const scroll = deriveMobileScroll([{ role: 'text', name: 'x' }], { width: 390, height: 844 })
    expect(scroll).toEqual({ offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 844 })
  })
})

describe('buildScreenState integration (typed-absence survives the builder)', () => {
  it('derives documented state defaults and preserves real signals from the walk', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <android.widget.CheckBox bounds="[0,0][100,100]" text="Agree" content-desc="Accept" resource-id="agree" checkable="true" checked="true" enabled="true" />
</hierarchy>`
    const { nodes } = parseMobileSource(xml, 'android', { width: 1080, height: 1920 })
    const { state } = buildScreenState({
      platform: 'android',
      nodes,
      viewport: { width: 1080, height: 1920 },
      scroll: deriveMobileScroll(nodes, { width: 1080, height: 1920 }),
      coordSpace: 'viewport',
      timestamp: 0,
    })

    const cb = state.elements[0]
    // Real signal preserved through the builder.
    expect(cb.state.checked).toBe(true)
    expect(cb.state.enabled).toBe(true)
    // Never-supplied signals: builder defaults, and selected stays typed-absent.
    expect(cb.state.focused).toBe(false)
    expect(cb.state.visible).toBe(true)
    expect('selected' in cb.state).toBe(false)
    // resource-id/content-desc rode through to schema labels.
    expect(cb.labels.testId).toBe('agree')
    expect(cb.labels.ariaLabel).toBe('Accept')
  })
})

describe('normalizeRole', () => {
  it('maps known Android types', () => {
    expect(normalizeRole('android.widget.Button', 'android')).toBe('button')
    expect(normalizeRole('android.widget.EditText', 'android')).toBe('textbox')
    expect(normalizeRole('android.widget.TextView', 'android')).toBe('text')
    expect(normalizeRole('android.widget.CheckBox', 'android')).toBe('checkbox')
  })

  it('maps known iOS types', () => {
    expect(normalizeRole('XCUIElementTypeButton', 'ios')).toBe('button')
    expect(normalizeRole('XCUIElementTypeTextField', 'ios')).toBe('textbox')
    expect(normalizeRole('XCUIElementTypeStaticText', 'ios')).toBe('text')
    expect(normalizeRole('XCUIElementTypeSwitch', 'ios')).toBe('switch')
  })

  it('falls back to stripped lowercase for unknown Android types', () => {
    expect(normalizeRole('android.widget.CustomView', 'android')).toBe('customview')
    expect(normalizeRole('com.google.android.material.chip.Chip', 'android')).toBe('button')
  })

  it('falls back to stripped lowercase for unknown iOS types', () => {
    expect(normalizeRole('XCUIElementTypePageIndicator', 'ios')).toBe('pageindicator')
  })

  it('handles fully unknown types gracefully', () => {
    expect(normalizeRole('SomeRandomType', 'android')).toBe('somerandomtype')
    expect(normalizeRole('SomeRandomType', 'ios')).toBe('somerandomtype')
  })

  it('returns element for empty type', () => {
    expect(normalizeRole('', 'android')).toBe('element')
    expect(normalizeRole('', 'ios')).toBe('element')
  })

  it('has comprehensive Android role map', () => {
    expect(Object.keys(ANDROID_ROLE_MAP).length).toBeGreaterThanOrEqual(15)
  })

  it('has comprehensive iOS role map', () => {
    expect(Object.keys(IOS_ROLE_MAP).length).toBeGreaterThanOrEqual(15)
  })
})
