// 427 · D-03, UI-SPEC S3 — a step number that takes the reader to its step, or honest plain text.
//
// The attribute names are data-step-ref-test / data-step-ref-step on purpose: the shipped ledger
// harvest counts a different step attribute, and a reference must never be counted as a step row.

import { Fragment, type ReactNode } from "react"

import { MaskedText } from "./masked-text"
import {
  stepRefAccessibleName,
  type StepAddress,
  type StepRefContext,
  type StepRefSegment,
} from "@/lib/knowledge-view"

const CONTROL_CLASS =
  "inline rounded-sm text-primary tabular-nums underline-offset-4 hover:underline " +
  "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

export function KnowledgeStepRef({
  address,
  stepRefs,
  testName,
  children,
}: {
  address: StepAddress
  stepRefs?: StepRefContext
  testName?: string
  children: ReactNode
}) {
  if (stepRefs === undefined || !stepRefs.resolvable(address)) {
    return <span className="tabular-nums">{children}</span>
  }
  return (
    <button
      type="button"
      data-step-ref
      data-step-ref-test={String(address.testIndex)}
      data-step-ref-step={String(address.stepIndex)}
      aria-label={stepRefAccessibleName(address, testName)}
      className={CONTROL_CLASS}
      onClick={() => { stepRefs.onSelect(address) }}
    >
      {children}
    </button>
  )
}

export function KnowledgeStepRefs({
  segments,
  stepRefs,
  testNames = stepRefs?.testNames,
}: {
  segments: readonly StepRefSegment[]
  stepRefs?: StepRefContext
  testNames?: ReadonlyMap<number, string>
}) {
  // A suite's test name is a text segment rendered as masked text, never a control.
  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.kind === "text" ? (
            <MaskedText text={segment.text} />
          ) : (
            <KnowledgeStepRef
              address={segment.address}
              stepRefs={stepRefs}
              testName={testNames?.get(segment.address.testIndex)}
            >
              {segment.label}
            </KnowledgeStepRef>
          )}
        </Fragment>
      ))}
    </>
  )
}
