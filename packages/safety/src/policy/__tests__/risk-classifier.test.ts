import { describe, expect, it } from 'vitest'

import type { RiskActionDescriptor, RiskTier } from '@vostride/agent-qa-schema'
import { classifyRisk, TIER_ORDER } from '../risk-classifier'

interface ClassifierCase {
  name: string
  action: RiskActionDescriptor
  expectedTier: RiskTier
  reasonFragment: string
}

describe('classifyRisk', () => {
  const cases: ClassifierCase[] = [
    {
      name: 'uses readOnly advisory signal',
      action: { name: 'assert_visible', recognized: true, readOnly: true },
      expectedTier: 'read-only',
      reasonFragment: 'readOnly',
    },
    {
      name: 'treats destructive advisory flag as mutating-local only',
      action: { name: 'web_fill', recognized: true, destructive: true },
      expectedTier: 'mutating-local',
      reasonFragment: 'recognized',
    },
    {
      name: 'floors recognized flagless actions to mutating-local',
      action: { name: 'web_click', recognized: true },
      expectedTier: 'mutating-local',
      reasonFragment: 'recognized',
    },
    {
      name: 'raises soft lexicon hits to destructive',
      action: { name: 'delete_record', recognized: true },
      expectedTier: 'destructive',
      reasonFragment: 'soft destructive lexicon',
    },
    // RE-SPELLED 2026-10-01 (432-19, D-16) from 'raises hard lexicon hits to restricted', which
    // classified the shell COMMAND `rm -rf /`. The command-pattern list is deleted; a hard NAME verb
    // is the signal that survives, and it still raises to restricted.
    {
      name: 'raises hard lexicon hits to restricted',
      action: { name: 'sudo_reboot', recognized: true },
      expectedTier: 'restricted',
      reasonFragment: 'hard destructive lexicon',
    },
    {
      name: 'respects declared mutating-shared floor',
      action: { name: 'push_to_remote', recognized: true, declaredTier: 'mutating-shared' },
      expectedTier: 'mutating-shared',
      reasonFragment: 'declared',
    },
    // RE-SPELLED 2026-10-01 (432-19, D-16) from a `command: 'sudo dd'` raise. The same claim —
    // the lexicon outranks a declared tier — measured on the name signal.
    {
      name: 'lets hard lexicon raise a declared tier',
      action: {
        name: 'kill_session',
        recognized: true,
        declaredTier: 'mutating-shared',
      },
      expectedTier: 'restricted',
      reasonFragment: 'hard destructive lexicon',
    },
    {
      name: 'defaults unrecognized actions to restricted',
      action: { name: 'totally_unknown', recognized: false },
      expectedTier: 'restricted',
      reasonFragment: 'unrecognized',
    },
  ]

  it.each(cases)('$name', ({ action, expectedTier, reasonFragment }) => {
    const result = classifyRisk(action)

    expect(result.riskTier).toBe(expectedTier)
    expect(result.reason).toContain(reasonFragment)
    expect(result.reason.length).toBeGreaterThan(0)
    expect(Object.keys(result).sort()).toEqual(['reason', 'riskTier'])
    expect('verdict' in result).toBe(false)
  })
})

// C432-EVAL-RISK-PARITY (432-19, D-16). Eval scores a candidate's side effect by comparing
// `classifyRisk` tiers through `TIER_ORDER` (`eval/src/match/risk.ts`), so deleting the command
// patterns must not move any score. The corpus below was MEASURED on the pre-432-19 build
// (agent-qa fbb404334): every action the runner registers, as `projectRiskAction` projects it (the
// exact descriptor eval classifies), plus lexicon names in both recognition states. Each row is
// that build's tier and reason, transcribed from the measurement rather than recomputed here.
type MeasuredCase = readonly [RiskActionDescriptor, RiskTier, string]

const MEASURED_CORPUS: readonly MeasuredCase[] = [
  [{ name: 'assertAI', recognized: true, surface: 'common', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'assertValue', recognized: true, surface: 'common', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'clearText', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'click', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'copy', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'delay', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'doubleClick', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'doubleTap', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'drag', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'extractAI', recognized: true, surface: 'common', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'fileUpload', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'fill', recognized: true, destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'focus', recognized: true, surface: 'web', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'handleDialog', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'hideKeyboard', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'hover', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'inspect', recognized: true, surface: 'web', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'intent', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'keyevent', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'keypress', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'longpress', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'multiTap', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'nativeSelect', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'navigate', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'networkState', recognized: true, surface: 'web', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'openApp', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'openNotifications', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'openQuickSettings', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'openUniversalLink', recognized: true, surface: 'ios', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'paste', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pickerSelect', recognized: true, surface: 'ios', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pinch', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pressBack', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pressButton', recognized: true, surface: 'ios', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pressHome', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'pressRecent', recognized: true, surface: 'android', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'reportValue', recognized: true, surface: 'common', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'rightClick', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'route', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'scroll', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'select', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'setCookies', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'setLocalStorage', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'setOrientation', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'setVariable', recognized: true, surface: 'common' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'storageState', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'swipe', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'swipeFromEdge', recognized: true, surface: 'ios', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'tab', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'tap', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'tapCoordinate', recognized: true, surface: 'mobile' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'uniqueValue', recognized: true, surface: 'web', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'unroute', recognized: true, surface: 'web', destructive: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'waitFor', recognized: true, surface: 'common', readOnly: true }, 'read-only', 'readOnly advisory flag'],
  [{ name: 'waitForUrl', recognized: true, surface: 'web' }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'delete_record', recognized: true }, 'destructive', 'soft destructive lexicon: delete_record'],
  [{ name: 'delete_record', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'drop_table', recognized: true }, 'destructive', 'soft destructive lexicon: drop_table'],
  [{ name: 'drop_table', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'sudo_reboot', recognized: true }, 'restricted', 'hard destructive lexicon: sudo_reboot'],
  [{ name: 'sudo_reboot', recognized: false }, 'restricted', 'hard destructive lexicon: sudo_reboot'],
  [{ name: 'kill_session', recognized: true }, 'restricted', 'hard destructive lexicon: kill_session'],
  [{ name: 'kill_session', recognized: false }, 'restricted', 'hard destructive lexicon: kill_session'],
  [{ name: 'killall', recognized: true }, 'restricted', 'hard destructive lexicon: killall'],
  [{ name: 'killall', recognized: false }, 'restricted', 'hard destructive lexicon: killall'],
  [{ name: 'mkfs', recognized: true }, 'restricted', 'hard destructive lexicon: mkfs'],
  [{ name: 'mkfs', recognized: false }, 'restricted', 'hard destructive lexicon: mkfs'],
  [{ name: 'shutdown', recognized: true }, 'restricted', 'hard destructive lexicon: shutdown'],
  [{ name: 'shutdown', recognized: false }, 'restricted', 'hard destructive lexicon: shutdown'],
  [{ name: 'reboot', recognized: true }, 'restricted', 'hard destructive lexicon: reboot'],
  [{ name: 'reboot', recognized: false }, 'restricted', 'hard destructive lexicon: reboot'],
  [{ name: 'dd', recognized: true }, 'restricted', 'hard destructive lexicon: dd'],
  [{ name: 'dd', recognized: false }, 'restricted', 'hard destructive lexicon: dd'],
  [{ name: 'remove_item', recognized: true }, 'destructive', 'soft destructive lexicon: remove_item'],
  [{ name: 'remove_item', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'purge_cache', recognized: true }, 'destructive', 'soft destructive lexicon: purge_cache'],
  [{ name: 'purge_cache', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'submit-payment', recognized: true }, 'destructive', 'soft destructive lexicon: submit-payment'],
  [{ name: 'submit-payment', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'teardown_env', recognized: true }, 'destructive', 'soft destructive lexicon: teardown_env'],
  [{ name: 'teardown_env', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'reset_password', recognized: true }, 'destructive', 'soft destructive lexicon: reset_password'],
  [{ name: 'reset_password', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'unknown_verb', recognized: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'unknown_verb', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'revoke_token', recognized: true }, 'destructive', 'soft destructive lexicon: revoke_token'],
  [{ name: 'revoke_token', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'deploy_app', recognized: true }, 'destructive', 'soft destructive lexicon: deploy_app'],
  [{ name: 'deploy_app', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'wipe', recognized: true }, 'destructive', 'soft destructive lexicon: wipe'],
  [{ name: 'wipe', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'destroy', recognized: true }, 'destructive', 'soft destructive lexicon: destroy'],
  [{ name: 'destroy', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'truncate', recognized: true }, 'destructive', 'soft destructive lexicon: truncate'],
  [{ name: 'truncate', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'run_shell', recognized: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'run_shell', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
  [{ name: 'setVariable', recognized: true }, 'mutating-local', 'recognized mutating action floor'],
  [{ name: 'setVariable', recognized: false }, 'restricted', 'unrecognized action fail-safe'],
]

describe('C432-EVAL-RISK-PARITY: name-based risk scores are unchanged by the command-pattern deletion', () => {
  it('C432-EVAL-RISK-PARITY: every measured descriptor keeps its tier and reason', () => {
    expect(MEASURED_CORPUS).toHaveLength(99)
    const drift = MEASURED_CORPUS.flatMap(([action, tier, reason]) => {
      const now = classifyRisk(action)
      return now.riskTier === tier && now.reason === reason
        ? []
        : [`${action.name}/${String(action.recognized)}: ${tier} (${reason}) -> ${now.riskTier} (${now.reason})`]
    })
    expect(drift).toEqual([])
  })

  it('C432-EVAL-RISK-PARITY: the tier order eval compares through is unchanged', () => {
    expect(TIER_ORDER).toEqual(['read-only', 'mutating-local', 'mutating-shared', 'destructive', 'restricted'])
  })

  it('C432-EVAL-RISK-PARITY: a command no longer moves a tier in either direction (D-16)', () => {
    // The only behaviour the deletion changes, stated: the command string is not read at all.
    for (const [action] of MEASURED_CORPUS) {
      for (const command of ['rm -rf /', 'sudo dd', 'delete everything', 'echo ok']) {
        expect(classifyRisk({ ...action, command }), `${action.name} + ${command}`).toEqual(classifyRisk(action))
      }
    }
  })
})
