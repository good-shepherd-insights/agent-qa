import { z } from 'zod'
import { asRef, type Ref, type Surface } from '@vostride/agent-qa-schema'
import type { ToolRegistry } from '../registry.js'
import type { ToolDefinition } from '../types.js'
import { NON_EXPOSED, VERB_SURFACE } from './surface-map.js'

const CURRENT_SCREEN_REF_DESCRIPTION = 'current-screen element reference (e.g. e12), never a CSS selector or label'
const ELEMENT_DESCRIPTION_SCHEMA = z.string().optional()
  .describe('Human-readable label of the target element for disambiguation/logging; omit when the ref is unambiguous; never the sole handle — always alongside the ref/coordinates.')

export const refSchema = (description: string) =>
  z.string().transform((v): Ref => asRef(v)).describe(description)

function actionWithSurface(verb: string, surface: Surface, description: string, schema: z.ZodType): ToolDefinition {
  return {
    id: `${surface}_${verb}`,
    type: verb,
    surface,
    exposed: !NON_EXPOSED.has(verb),
    description,
    category: 'action',
    schema,
  }
}

function action(verb: string, description: string, schema: z.ZodType): ToolDefinition {
  const surface = VERB_SURFACE[verb]
  if (!surface) throw new Error(`No surface mapping for verb "${verb}"`)
  return actionWithSurface(verb, surface, description, schema)
}

export const fillSchema = z.object({
  ref: refSchema(`Input field ${CURRENT_SCREEN_REF_DESCRIPTION}`),
  text: z.string().describe('Text to enter into the field'),
  elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  clearMode: z.enum(['replace', 'append']).default('replace')
    .describe('replace = clear the field first (default); append = type at the cursor. Omit when replacing the current field value.'),
  submit: z.boolean().default(false)
    .describe('Press Enter after typing. Omit when the field should keep focus after typing.'),
}).strict()

export const scrollSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('direction'),
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Direction to scroll'),
    ref: refSchema(`Element to scroll within; ${CURRENT_SCREEN_REF_DESCRIPTION}. Omit when scrolling the whole page or screen.`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    amount: z.enum(['page', 'halfPage', 'toEnd']).default('page')
      .describe('How far to scroll in the selected direction. Omit when a normal page-sized scroll is appropriate.'),
    retryOpposite: z.boolean().default(true)
      .describe('Retry in the opposite direction if the first scroll produces no movement. Omit when retrying opposite is acceptable.'),
  }).strict(),
  z.object({
    mode: z.literal('untilVisible'),
    target: z.string().describe('Visible text or accessible name to reveal'),
    ref: refSchema(`Element or list to search within; ${CURRENT_SCREEN_REF_DESCRIPTION}. Omit when searching the whole page or screen.`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    direction: z.enum(['up', 'down', 'left', 'right']).default('down')
      .describe('Initial direction to search for the target. Omit when scrolling down is the natural direction.'),
    maxSwipes: z.number().int().min(1).max(20).default(10)
      .describe('Maximum scroll attempts before giving up. Omit when ten attempts is enough.'),
    retryOpposite: z.boolean().default(true)
      .describe('Reverse direction after maxSwipes without reveal. Omit when reverse search is acceptable.'),
  }).strict(),
])

export const waitForSchema = z.discriminatedUnion('on', [
  z.object({
    on: z.literal('text'),
    text: z.string().describe('Visible text to wait for'),
    timeoutMs: z.number().default(5000)
      .describe('Maximum wait time in milliseconds. Omit when the default 5000ms timeout is acceptable.'),
  }).strict(),
  z.object({
    on: z.literal('selector'),
    selector: z.string().describe('CSS selector to wait for'),
    timeoutMs: z.number().default(5000)
      .describe('Maximum wait time in milliseconds. Omit when the default 5000ms timeout is acceptable.'),
  }).strict(),
  z.object({
    on: z.literal('gone'),
    text: z.string().describe('Text that must disappear'),
    timeoutMs: z.number().default(5000)
      .describe('Maximum wait time in milliseconds. Omit when the default 5000ms timeout is acceptable.'),
  }).strict(),
])

const assertSchema = z.object({
  claim: z.string().describe('The condition to verify, phrased as a checkable statement'),
  kind: z.enum(['visible', 'text', 'value', 'state', 'url', 'custom']).default('visible')
    .describe('Assertion kind. Omit when checking simple visibility.'),
  expected: z.string().optional()
    .describe('Expected value for comparison. Omit when the claim is self-contained.'),
  evidence: z.enum(['screen', 'dom', 'none']).default('screen')
    .describe('screen = needs screenshot evidence; dom = DOM/a11y-tree check; none = non-visual. Omit when screen evidence is appropriate.'),
}).strict()

const pointSchema = z.object({
  x: z.number().describe('X coordinate in pixels'),
  y: z.number().describe('Y coordinate in pixels'),
}).strict()

export const swipeSchema = z.union([
  z.object({
    type: z.literal('swipe').default('swipe')
      .describe('Canonical swipe action type. Omit because the registry supplies this value.'),
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Swipe direction'),
    ref: refSchema(`Element to swipe within; ${CURRENT_SCREEN_REF_DESCRIPTION}. Omit when swiping the whole screen.`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    duration: z.number().optional()
      .describe('Swipe duration in milliseconds. Omit when the default gesture duration is acceptable.'),
    start: z.never().optional(),
    end: z.never().optional(),
  }).strict(),
  z.object({
    type: z.literal('swipe').default('swipe')
      .describe('Canonical swipe action type. Omit because the registry supplies this value.'),
    direction: z.enum(['up', 'down', 'left', 'right']).describe('Swipe direction'),
    ref: refSchema(`Element to swipe within; ${CURRENT_SCREEN_REF_DESCRIPTION}. Omit when swiping the whole screen.`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    duration: z.number().optional()
      .describe('Swipe duration in milliseconds. Omit when the default gesture duration is acceptable.'),
    start: pointSchema.describe('Start coordinate for the explicit swipe path'),
    end: pointSchema.describe('End coordinate for the explicit swipe path'),
    coordSpace: z.enum(['viewport', 'screen'])
      .describe('Coordinate space for the explicit start/end path: viewport = visible area; screen = physical device screen.'),
  }).strict(),
])

const mobileFillDefinition = actionWithSurface('fill', 'mobile', 'Fill text into an input field', fillSchema)
if (mobileFillDefinition.id !== 'mobile_fill') {
  throw new Error(`Unexpected mobile fill id "${mobileFillDefinition.id}"`)
}

const ACTION_DEFINITIONS: ToolDefinition[] = [
  action('click', 'Click an element', z.object({
    ref: refSchema(`Element to click; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    clickDelay: z.number().optional().describe('Omit when there is no requested delay. Only provide a positive value when the user explicitly asks for a delay.'),
  }).strict()),

  action('fill', 'Fill text into an input field', fillSchema),

  mobileFillDefinition,

  action('select', 'Select an option from a dropdown', z.object({
    ref: refSchema(`Select/dropdown control ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    value: z.string().describe('Option value to select'),
  }).strict()),

  action('nativeSelect', 'Select a value from a native mobile picker, picker wheel, spinner, or dropdown/list control', z.object({
    ref: refSchema(`Native picker/dropdown control ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    value: z.string().describe('Visible text/value to select'),
  }).strict()),

  action('navigate', 'Navigate to a URL', z.object({
    url: z.string().describe('URL to navigate to'),
  })),

  action('scroll', 'Scroll the page or a specific element', scrollSchema),

  action('delay', 'Pause execution for a fixed duration — use when a specific duration is requested (e.g. "wait 3 seconds"). Do NOT use for waiting on conditions (use waitFor for that).', z.object({
    ms: z.number().describe('Duration in milliseconds'),
  })),

  action('waitFor', 'Wait for text, selector presence, or text disappearance', waitForSchema),

  action('assert', 'Assert a condition on the current page state', assertSchema),

  action('keypress', 'Press one or more keyboard keys/combos in sequence', z.object({
    keys: z.array(z.string()).min(1).describe('Array of keys/combos to press in sequence. Each entry may be a single key (e.g. "Enter", "Tab", "Escape") or a combo with "+" separators (e.g. "Meta+k", "Control+Shift+T"). Use "Meta" for the Cmd/Win/Super key — on non-Mac platforms it is automatically converted to "Control" when convertPlatformKeys is true. On mobile, only single special keys from the KEY_MAP work meaningfully; combos are a no-op.'),
    convertPlatformKeys: z.boolean().optional().default(true).describe('When true (default), replaces "Meta" with "Control" in each key string on non-Mac platforms so that "Meta+k" works as Cmd+K on Mac and Ctrl+K on Windows/Linux. Set to false to pass keys through unchanged. No-op on mobile.'),
  })),

  action('hover', 'Hover over an element', z.object({
    ref: refSchema(`Element to hover over; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('paste', 'Paste text into an element via clipboard paste event', z.object({
    ref: refSchema(`Paste target ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    value: z.string().describe('Text value to paste'),
  }).strict()),

  action('keyDown', 'Hold down a key (for modifier combos like Shift+Click)', z.object({
    key: z.string().describe('Key to hold down (e.g., Shift, Control, Alt, Meta)'),
  })),

  action('keyUp', 'Release a held key', z.object({
    key: z.string().describe('Key to release (e.g., Shift, Control, Alt, Meta)'),
  })),

  action('refresh', 'Refresh the current page', z.object({})),

  action('navigateHistory', 'Navigate browser history (back or forward)', z.object({
    direction: z.enum(['back', 'forward']).describe('Navigation direction in browser history'),
  })),

  action('readConsoleLogs', 'Read console log entries from the browser', z.object({
    level: z.enum(['log', 'info', 'warn', 'error']).optional()
      .describe('Filter by log level. Omit to get all levels.'),
    tab: z.object({
      index: z.number().optional().describe('0-based tab index'),
      title: z.string().optional().describe('Substring match on page title'),
      url: z.string().optional().describe('Substring match on page URL'),
    }).optional()
      .describe('Target a specific tab. Omit to read logs from all tabs.'),
  })),

  action('readNetworkLogs', 'Read network request/response log entries', z.object({
    urlPattern: z.string().optional()
      .describe('Filter by URL substring match. Omit to get all requests.'),
    tab: z.object({
      index: z.number().optional().describe('0-based tab index'),
      title: z.string().optional().describe('Substring match on page title'),
      url: z.string().optional().describe('Substring match on page URL'),
    }).optional()
      .describe('Target a specific tab. Omit to read logs from all tabs.'),
  })),

  action('readCookies', 'Read browser cookies', z.object({
    name: z.string().optional()
      .describe('Cookie name to read. Omit to get all cookies.'),
  })),

  action('setCookies', 'Set browser cookies', z.object({
    cookies: z.array(z.object({
      name: z.string().describe('Cookie name'),
      value: z.string().describe('Cookie value'),
      domain: z.string().optional().describe('Cookie domain'),
      path: z.string().optional().describe('Cookie path'),
      httpOnly: z.boolean().optional().describe('HTTP only flag'),
      secure: z.boolean().optional().describe('Secure flag'),
      sameSite: z.enum(['Strict', 'Lax', 'None']).optional().describe('SameSite attribute'),
      expires: z.number().optional().describe('Expiry as Unix timestamp in seconds'),
    })).describe('Array of cookies to set'),
  })),

  action('readLocalStorage', 'Read local storage entries', z.object({
    key: z.string().optional()
      .describe('Storage key to read. Omit to get all entries.'),
  })),

  action('setLocalStorage', 'Set local storage entries', z.object({
    entries: z.array(z.object({
      key: z.string().describe('Storage key'),
      value: z.string().describe('Storage value'),
    })).describe('Array of key-value pairs to set'),
  })),

  action('tap', 'Tap an element on a mobile device', z.object({
    ref: refSchema(`Element to tap; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('swipe', 'Swipe gesture on a mobile device', swipeSchema),

  action('longpress', 'Long-press an element on a mobile device', z.object({
    ref: refSchema(`Element to long-press; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    duration: z.number().optional().describe('Long-press duration in ms'),
  }).strict()),

  action('hideKeyboard', 'Dismiss the on-screen keyboard (mobile only, no-op on web)', z.object({})),

  action('clearText', 'Clear all text from an input field without typing new text', z.object({
    ref: refSchema(`Input field to clear; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('openLink', 'Open a deep link in a mobile app — use navigate for web URLs', z.object({
    url: z.string().describe('Deep link URL to open (e.g. myapp://screen, intent://...)'),
    appId: z.string().optional().describe('Generic mobile app identifier. Android uses package name; iOS uses bundle ID.'),
    bundleId: z.string().optional().describe('iOS bundle ID to open the link in'),
    appPackage: z.string().optional().describe('Android package name to open the link in'),
    waitForLaunch: z.boolean().optional().describe('Whether to wait for the app to launch after opening the link'),
  })),

  action('drag', 'Drag an element to another element (reorder lists, sliders)', z.object({
    fromRef: refSchema(`Drag source ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    toRef: refSchema(`Drop target ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    fromDescription: z.string().optional()
      .describe('Human-readable label of the drag source. Omit when fromRef is unambiguous.'),
    toDescription: z.string().optional()
      .describe('Human-readable label of the drop target. Omit when toRef is unambiguous.'),
  }).strict()),

  action('doubleTap', 'Double-tap an element (text selection, zoom)', z.object({
    ref: refSchema(`Element to double-tap; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('setOrientation', 'Set the device orientation (mobile only)', z.object({
    orientation: z.enum(['portrait', 'landscape']).describe('Device orientation'),
  })),

  action('pinch', 'Pinch zoom gesture on a mobile device (mobile only)', z.object({
    scale: z.number().describe('Scale factor: >1 to zoom in (spread fingers), <1 to zoom out (pinch fingers)'),
    x: z.number().optional().describe('Center X coordinate for pinch gesture'),
    y: z.number().optional().describe('Center Y coordinate for pinch gesture'),
    ref: refSchema(`Optional element to center the pinch on; ${CURRENT_SCREEN_REF_DESCRIPTION}`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('multiTap', 'Multi-finger tap gesture on a mobile device (mobile only)', z.object({
    fingers: z.number().describe('Number of fingers (2 or 3)'),
    x: z.number().optional().describe('Center X coordinate for multi-finger tap'),
    y: z.number().optional().describe('Center Y coordinate for multi-finger tap'),
    ref: refSchema(`Optional element to center the tap on; ${CURRENT_SCREEN_REF_DESCRIPTION}`).optional(),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('tapCoordinate', 'Tap at specific pixel coordinates — use when target element has no ref in accessibility tree', z.object({
    x: z.number().describe('X coordinate in pixels'),
    y: z.number().describe('Y coordinate in pixels'),
    coordSpace: z.enum(['viewport', 'content', 'screen'])
      .describe('Which coordinate space x/y are in: viewport = visible area; content = full scrollable page; screen = physical device screen. Read it from the [Viewport: WxH] observation header.'),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),

  action('setVariable', 'Set a runtime environment variable for use in subsequent steps', z.object({
    name: z.string().describe('Variable name (will be accessible via {{env:varName}})'),
    value: z.string().describe('Variable value to store'),
  })),

  action('newTab', 'Open a URL in a new browser tab and switch to it', z.object({
    url: z.string().describe('URL to open in the new tab'),
  })),

  action('switchTab', 'Switch to an open browser tab', z.object({
    index: z.number().optional().describe('0-based tab index to switch to'),
    title: z.string().optional().describe('Substring match on page title'),
    url: z.string().optional().describe('Substring match on page URL'),
  })),

  action('doubleClick', 'Double-click an element (text selection, expand, web-only)', z.object({
    ref: refSchema(`Element to double-click; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    relativePosition: z.object({
      x: z.number().describe('X offset in pixels from element top-left'),
      y: z.number().describe('Y offset in pixels from element top-left'),
    }).strict().optional().describe('Omit for normal element-center interaction. Only provide when the user explicitly asks for an offset. Do not use { x: 0, y: 0 } for a normal button double-click/right-click; top-left is often intercepted.'),
    clickDelay: z.number().optional().describe('Omit when there is no requested delay. Only provide a positive value when the user explicitly asks for a delay.'),
  }).strict()),

  action('rightClick', 'Right-click an element to open context menu (web-only)', z.object({
    ref: refSchema(`Element to right-click; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    relativePosition: z.object({
      x: z.number().describe('X offset in pixels from element top-left'),
      y: z.number().describe('Y offset in pixels from element top-left'),
    }).strict().optional().describe('Omit for normal element-center interaction. Only provide when the user explicitly asks for an offset. Do not use { x: 0, y: 0 } for a normal button double-click/right-click; top-left is often intercepted.'),
    clickDelay: z.number().optional().describe('Omit when there is no requested delay. Only provide a positive value when the user explicitly asks for a delay.'),
  }).strict()),

  action('waitForUrl', 'Wait for the page URL to match a glob pattern (web only)', z.object({
    pattern: z.string().describe('URL glob pattern. Use "**" for substring matching (e.g., "**/dashboard**"). Plain strings WITHOUT wildcards require EXACT URL match, not substring.'),
  })),

  action('fileUpload', 'Upload one or more files to a file input element (web only)', z.object({
    ref: refSchema(`File input ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
    files: z.array(z.string()).min(1).describe('Paths to files — relative to the test YAML file, or absolute paths. Missing files fail the action.'),
  }).strict()),

  action('copy', 'Copy the text content of an element to the system clipboard (web only, chromium only)', z.object({
    ref: refSchema(`Element whose text content to copy; ${CURRENT_SCREEN_REF_DESCRIPTION}`),
    elementDescription: ELEMENT_DESCRIPTION_SCHEMA,
  }).strict()),
]

export function registerAllActions(registry: ToolRegistry): void {
  for (const def of ACTION_DEFINITIONS) {
    registry.register(def)
  }
}
