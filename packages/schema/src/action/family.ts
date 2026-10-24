import { z } from 'zod'
import type { Action } from './index'

export type ActionFamily =
  | 'pointer'
  | 'input'
  | 'gesture'
  | 'navigate'
  | 'verify'
  | 'extract'
  | 'wait'
  | 'device'
  | 'environment'
  | 'script'

export const ACTION_FAMILIES = [
  'pointer', 'input', 'gesture', 'navigate', 'verify', 'extract', 'wait', 'device',
  'environment', 'script',
] as const satisfies readonly ActionFamily[]

export const ActionFamilySchema = z.enum(ACTION_FAMILIES)

export const ACTION_FAMILY_BY_TYPE = {
  click: 'pointer',
  doubleClick: 'pointer',
  rightClick: 'pointer',
  hover: 'pointer',
  focus: 'pointer',
  tap: 'pointer',
  doubleTap: 'pointer',
  multiTap: 'pointer',
  longpress: 'pointer',
  tapCoordinate: 'pointer',
  fill: 'input',
  paste: 'input',
  copy: 'input',
  clearText: 'input',
  keypress: 'input',
  keyevent: 'input',
  select: 'input',
  nativeSelect: 'input',
  pickerSelect: 'input',
  fileUpload: 'input',
  scroll: 'gesture',
  swipe: 'gesture',
  drag: 'gesture',
  pinch: 'gesture',
  swipeFromEdge: 'gesture',
  navigate: 'navigate',
  tab: 'navigate',
  openUniversalLink: 'navigate',
  assertAI: 'verify',
  assertValue: 'verify',
  extractAI: 'extract',
  inspect: 'extract',
  reportValue: 'extract',
  setVariable: 'extract',
  uniqueValue: 'extract',
  waitFor: 'wait',
  waitForUrl: 'wait',
  delay: 'wait',
  pressBack: 'device',
  pressHome: 'device',
  pressRecent: 'device',
  pressButton: 'device',
  hideKeyboard: 'device',
  setOrientation: 'device',
  openApp: 'device',
  stopApp: 'device',
  openNotifications: 'device',
  openQuickSettings: 'device',
  intent: 'device',
  setCookies: 'environment',
  setLocalStorage: 'environment',
  storageState: 'environment',
  route: 'environment',
  unroute: 'environment',
  networkState: 'environment',
  handleDialog: 'environment',
  executeScript: 'script',
} as const satisfies Record<Action['type'], ActionFamily>

export function actionFamilyOf(type: Action['type']): ActionFamily {
  return ACTION_FAMILY_BY_TYPE[type]
}
