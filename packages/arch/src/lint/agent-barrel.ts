// The agent barrel export-set pin (Phase 384, FUNC-01 / SC1).
//
// `invokeFunction` is the only dispatch this package publishes, and it always crosses the
// policy gate. The spec type (declaration PLUS implementation), the spec-level invoke, the
// registry internals seam, and the construct-from-arbitrary-specs factory are all absent
// on purpose: a surface holding any one of them could run a capability without the gate,
// or mint one the catalog never declared. That is a private power, which is exactly what
// the function layer abolishes (T-384-20).
//
// "Absent on purpose" is worth nothing as a comment and everything as an assertion, so the
// pinned set below is compared for EXACT equality — never a contains check. A contains
// check passes happily while the barrel grows a dispatch path beside the pinned names,
// which is the one drift direction SC1 exists to catch.
//
// The value and type sets are pinned SEPARATELY. A name moving between them is a real
// change of kind: a type is erased, a value is callable, and a pinned type quietly
// promoted to a value is precisely how a dispatch symbol would arrive wearing a familiar
// name.

import { parseModuleStatements, stripCodeComments } from './evaluate-pin.js'

/** The pinned barrel, repo-relative. */
export const AGENT_BARREL_FILE = 'packages/agent/src/index.ts'

/**
 * The exact VALUE exports, as finalized by plan 05 and extended by Phase 385 plan 01.
 *
 * The registry factory and the one dispatch; the layer's six caller-facing refusals; the
 * two op-level refusals a surface may legitimately catch and report; and the two masking
 * helpers, which are STAGED for Phase 386's wiring and are a no-op today — every surface
 * that phase built constructs a fresh, empty masking context, so unmasking is the identity
 * function and there is no display boundary for them to carry yet. They are pinned here
 * now so that wiring is a non-breaking change rather than a firewall widening. Neither
 * helper can resolve, gate or run anything, so publishing them opens no path around the
 * dispatch.
 *
 * 385 adds the agent job queue's two constructors and its named refusals. They are
 * safe here for the same structural reason the masking helpers are: none of them is
 * dispatch, and none of them is a host capability. The queue reaches storage only through
 * an injected `JobStorePort`, so nothing on this list can read or write a byte on its own.
 * The list deliberately does NOT carry a store implementation, a checkpoint reader, a path
 * helper, or any model accessor — `agent` is storageNeutral and providerNeutral, and an
 * arrival of that kind is precisely the drift this exact-equality pin exists to catch.
 *
 * 385 plan 04 REMOVES that refusal and adds the six real kinds. The driver now dispatches
 * every handler outcome — a retryable report is retried until the declared bound is spent and
 * a permanent one is terminal — so the class that stood in for the unbuilt path has nothing
 * left to throw, and an error nobody throws is decorative. Its departure from this list is
 * the visible edit plan 02 said it would be. The two declaration refusals that arrive in its
 * place are construction-time: a kind whose declaration is incomplete, and one whose
 * declaration is complete and still cannot be true of any kind.
 *
 * 385 plan 05 adds `recordLlmAuthorship` — and this is the one addition on this list whose
 * ABSENCE would have been the drift. It is the single audited path from a job to a model, so
 * publishing it is what lets every later handler bind one contract instead of re-deriving a
 * "author only if there is no checkpoint" conditional six times. What is still not here, and
 * must never be, is anything that could HAND someone a model: the capability crosses this
 * barrel as a type, and the only value that ever holds one is the argument the primitive gives
 * its author callback (D-11 layer 1).
 *
 * 387 plan 06 adds `AmbiguousStepAddressError`, on the same footing: one more caller-facing
 * refusal, an error CLASS and nothing else. It is here because a surface has to be able to tell
 * an ambiguous ADDRESS apart from an absent answer — the why-verb's `no-trace` arms all say
 * 'that step recorded nothing', and answering an ambiguous address that way would report two
 * steps as none. The class carries the candidate testIds so the surface can say which to choose
 * between; it opens no dispatch path, because the spec it belongs to stays inside `functions/`.
 *
 * 387 plan 01 adds `EntityNotFoundError` — one more caller-facing refusal, on the exact
 * footing as `RunNotFoundError` beside it: a surface asked for one specific address, nothing
 * was ever minted at it, and the surface needs to be able to say so. It is an error CLASS and
 * nothing else; the two `entities.*` specs it belongs to stay inside `functions/`, so the two
 * new capabilities remain reachable only through `invokeFunction` and this addition opens no
 * dispatch path.
 */
export const EXPECTED_AGENT_BARREL_VALUE_EXPORTS: readonly string[] = [
  // 389 plan 05: the analysis read op's id, on the exact footing of the two op-id constants
  // below — a string a surface names on the wire, never a dispatch handle.
  'ANALYSIS_GET_FUNCTION_ID',
  'AmbiguousStepAddressError',
  'DuplicateFunctionIdError',
  'DuplicateJobKindError',
  'EntityNotFoundError',
  'FunctionDeniedError',
  'FunctionInputError',
  'FunctionNotBoundError',
  // 391 D-06. A caller-facing refusal a surface legitimately catches and reports, on exactly
  // the footing of its four siblings here: it is an error CLASS, not a dispatch path, so a
  // surface holding it can run nothing. It lands in SORT position rather than appended,
  // because this list is compared by exact equality against the barrel's own order.
  'FunctionOriginError',
  'FunctionScopeError',
  'IncompleteJobKindDeclarationError',
  'InconsistentJobKindDeclarationError',
  'JobCancellationNotRequestedError',
  'JobCancelledError',
  // 387 plan 08: the delegate transport must name the op it hands the leaseholder (D-18). A
  // string, not a handle — see the barrel's own note beside the export.
  'KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID',
  'MissingIdempotencyKeyError',
  // 390 plan 04: the three quarantine verb ids, on the same footing as the op-id constants
  // above and below — strings a surface names on the wire, never dispatch handles. The three
  // SPECS are deliberately NOT here: a spec carries the implementation and the live
  // validators, and two of these verbs write the committed ledger.
  'QUARANTINE_ADD_FUNCTION_ID',
  'QUARANTINE_LIST_FUNCTION_ID',
  'QUARANTINE_RELEASE_FUNCTION_ID',
  'REAL_JOB_KIND_DECLARATIONS',
  // 388 plan 03: the chip-truth op's id, on the same footing as the apply id above. Plan 04's
  // exit summary line dispatches through the registry and has to put a name on the wire; the
  // alternative is a literal in the CLI, which is a second declaration of a capability's name.
  // A string is not a dispatch handle — naming an op still buys nothing without a registry, a
  // caller and the gate.
  // 391 D-16/D-17: the per-run digest op's id, on exactly the footing of the four op-id
  // constants around it. The CLI's `digest` verb and the tail's fetch pointer both have to put
  // this name on the wire, and the alternative is a literal in the CLI — a second declaration of
  // a capability's name. A string is not a dispatch handle.
  'RUNS_DIGEST_FUNCTION_ID',
  'RUNS_POST_PROCESSING_FUNCTION_ID',
  'RunNotFoundError',
  'RunNotRecordedError',
  'StaleJobStoreEpochError',
  'StreamReplayFloorError',
  'UndeclaredJobCheckpointError',
  'UndeclaredJobSuccessorError',
  'UnknownFunctionError',
  'UnknownJobKindError',
  // 388 plan 01: the post-run chain's ONE id derivation. It joins the value list rather than
  // the type list because addressing is a computation, not a shape — the chip projection, the
  // chain-terminal check and every later reader must derive the same three job ids from a
  // runId, and a second copy of that hash input would be a second chain that reviews
  // identically. It is a pure function of a string and an injected id source: it reaches no
  // storage, holds no capability, and dispatches nothing, so publishing it opens no path.
  'chainJobIdsForRun',
  // 389 plan 05: render-time pure clustering (D-14). A total deterministic function of
  // (resolved verdicts, handoff) keyed on schema's one `failureFingerprint` vocabulary — it
  // persists nothing, reaches no storage and mints no identity (D-16), so publishing it
  // opens no path and no second problem-identity vocabulary.
  'clusterVerdicts',
  'createAgentJobQueue',
  'createFunctionRegistry',
  'createJobKindRegistry',
  'createMaskingContext',
  'createRealJobKindRegistry',
  'invokeFunction',
  'recordLlmAuthorship',
  // 391-06: the clustered BLOCK layout, relocated out of the CLI when `runs.digest` became its
  // second caller. Published on the sentence renderer's footing and for its reason — one layout,
  // imported once. A pure string fold over an op result: no storage, no capability, no dispatch.
  'renderAnalysisClusterBlock',
  // 389 plan 05: THE sentence renderer (D-05). A pure string composer over typed parts — it
  // reads no storage, holds no capability and dispatches nothing; it is published precisely so
  // plan 07's CLI print and every later surface compose sentences through ONE symbol instead of
  // spelling a second one (SC3 structural).
  'renderVerdictSentence',
  'unmaskForHumanOutput',
]

/**
 * The exact TYPE exports: the agent ports, the registry's options and handle, the
 * function-layer contract vocabulary, and the three injected read ports a composition
 * root implements. `FunctionDeclaration` is the capability-free VIEW of an op; the spec
 * types that carry an implementation are deliberately not here.
 *
 * 385 adds the agent job queue's contract vocabulary: the store port and its verb outcomes,
 * the per-kind declaration surface, and the engine's handle. Types are erased, so none of
 * these can carry behaviour across the barrel — what they carry is the SHAPE later phases
 * bind, and pinning them here is what makes a widening of that shape a visible edit rather
 * than an incidental one.
 *
 * 385 plan 02 REMOVES four names from this list and adds one. The enqueue request, the
 * chained request and the handler outcome now live in the schema package, because each one
 * crosses a boundary where a type is not enough — a caller in another process, bytes an
 * earlier build wrote, data a handler returned — and each therefore needs a runtime schema
 * beside it. Republishing them here would give every consumer two names for one contract and
 * no way to tell which one a later edit widened. What stays is `JobInsert`: the row the
 * engine hands the store, which never crosses a boundary and is nobody's public vocabulary.
 *
 * 385 plan 05 adds the authorship vocabulary. `JobModelCapability` is the interesting one: it
 * describes a model STRUCTURALLY so a composition root can adapt a real one onto it, which is
 * how this package stays provider-neutral while its jobs still author. A type is erased, so
 * its presence here hands nobody a model; what would be a violation is a VALUE that could
 * produce one, and the list above still has none.
 *
 * 385 plan 10 adds `RunInvocationPort`, `StartedRun` and `OptionalFunctionDepKey` — the
 * vocabulary a composition root implements to make `runs.start` bound in its host (D-16),
 * and the union naming which deps that conditional binding may hang on. All three are types,
 * so none of them hands a surface a way to start a run: the only value that could is the
 * port a COMPOSITION constructs and injects, and `invokeFunction` is still the one dispatch.
 *
 * It also adds the cancellation vocabulary. The engine verb and the two refusals are here
 * while NO surface exposes cancel in this phase, and that is deliberate: the semantics are
 * complete now because the seam a cooperative cancel is honoured at is inside the driver, and
 * a driver that shipped without it would have to be reopened with handlers already written
 * against it. Publishing the contract without a UI is the cheap half; retrofitting the check
 * is the expensive one.
 *
 * 387 plan 01 adds `EntityDirectoryPort` — the fourth REQUIRED read port on `FunctionDeps`,
 * the contract a composition root implements to make entity addresses resolvable in its host.
 * It joins for the same reason its three siblings are here: a composition has to be able to
 * NAME the thing it implements, and `entities` would otherwise be the one required port whose
 * shape a host could only satisfy by structural accident.
 *
 * It opens no dispatch path, and the reason is stronger than "types are erased". The port's
 * two verbs answer questions ABOUT entities and hand back data — a descriptor union and a
 * descriptor — with no vocabulary for a card and no way to reach the registry. Nothing on it
 * can resolve, gate or run a capability; the only value that ever implements it is the object
 * a composition constructs and injects, and `invokeFunction` remains the one dispatch. What
 * would have been a violation is publishing the card producer, and it is deliberately absent
 * from both lists: exactly one module in this package builds an `EntityCard` (ENTY-02), and
 * putting it on this barrel would have made "one producer" a convention instead of a fact.
 *
 * 387 plan 06 adds six more types and no values: `KnowledgeReviewPort` with its
 * `KnowledgeProposalRequest` and `KnowledgeApplyOutcome` vocabulary, and the step-evidence
 * read's `StepEvidenceAddress` / `StepEvidenceLookup` pair. They are here for the reason the
 * ports above are — a composition root has to be able to name what it implements, and
 * `knowledgeReview` is an OPTIONAL member, so a host that omits it is making a deliberate
 * statement rather than forgetting, and a statement is easier to make deliberately when the
 * thing being declined has a name.
 *
 * `KnowledgeReviewPort` is the first WRITE-shaped contract on this barrel, so the "opens no
 * dispatch path" argument is worth making explicitly rather than by analogy. It is a type: it
 * has no constructor here, no default, and no module in this package produces one. A surface
 * holding it can write nothing, because there is nothing to hold — the only value that ever
 * implements it is the object a composition constructs over the writer-gated knowledge entry,
 * which lives one package away behind the reader carve-out, and the only way to reach that
 * object at all is `invokeFunction` dispatching an op whose deps the registry owns. Publishing
 * the port's TYPE is what lets a host say "I do not supply this"; publishing anything that
 * could build one would have been the violation, and neither list has such a thing.
 */
export const EXPECTED_AGENT_BARREL_TYPE_EXPORTS: readonly string[] = [
  'AgentJobQueue',
  // 389 plan 05, three names. `AnalysisArtifactReaderPort` is the optional artifact-read
  // dep a composition root implements (plan 06 binds it over the run-directory analysis.json
  // + version guard) — a type, so it carries no filesystem across the barrel. The other two
  // are the cluster DTO and its member ref (D-16 — fingerprint value, count, member refs,
  // representative testIndex; deliberately NO id and NO address field, and the exact-key pin
  // in cluster.test.ts holds that shape); the value beside them is the pure function pinned
  // in the value list.
  'AnalysisArtifactReaderPort',
  'AnalysisCluster',
  'AnalysisClusterMember',
  'AuthoringReadPort',
  'BoundRecordLlmAuthorship',
  'CancelJobInput',
  // 388 plan 01. `ChainJobIds` is what the derivation above answers with; `ChainTerminalRecord`
  // is the optional argument the two terminal store verbs now accept, and `PostRunJobCapabilities`
  // is what a composition root implements to make analyze-run and curate-memory REAL rather than
  // scripted. All three are types, so none of them hands anyone a handoff reader or a curation
  // drain — the only values that implement the last one are built by a composition, which is the
  // whole point of naming it here.
  'ChainJobIds',
  'ChainTerminalRecord',
  // 388 plan 09. The optional options argument `claimNext` now accepts — a TYPE, so it hands
  // nobody a store; the exclusion it names is honoured inside the sqlite SELECT and set once
  // at queue construction (`unclaimableKinds` on `CreateAgentJobQueueOptions`, already pinned).
  'ClaimNextOptions',
  'ClockPort',
  'ConfigReaderPort',
  'CreateAgentJobQueueOptions',
  'CreateFunctionRegistryOptions',
  'EntityDirectoryPort',
  'FallbackContinuationInput',
  'FallbackContinuationProducer',
  'FunctionBindingStatus',
  'FunctionDeclaration',
  'FunctionDeps',
  'FunctionRegistry',
  'FunctionResultKind',
  'FunctionStream',
  'JobAuthorCallback',
  'JobBackoffPolicy',
  'JobCancelOutcome',
  'JobCheckpointContext',
  'JobCheckpointReadOutcome',
  'JobCheckpointRecord',
  'JobClaimOutcome',
  'JobCompleteOutcome',
  'JobEnqueueOutcome',
  'JobFailureDisposition',
  'JobHandler',
  'JobHandlerContext',
  'JobIdSource',
  'JobInsert',
  'JobKindDeclaration',
  'JobKindRegistry',
  'JobModelCapability',
  'JobModelOutput',
  'JobModelRequest',
  'JobPermanentFailureDisposition',
  'JobRecordedValueOutcome',
  'JobStoreDump',
  'JobStoreDumpRow',
  'JobStoreFence',
  'JobStorePort',
  'KnowledgeApplyOutcome',
  'KnowledgePort',
  'KnowledgeProposalRequest',
  // 387 plan 08: `propose` answers a typed target-not-found rather than throwing, and a bare
  // proposal could not carry that arm. Type-only, like every other member of this family.
  'KnowledgeProposeOutcome',
  'KnowledgeReaderPort',
  'KnowledgeReviewPort',
  'OptionalFunctionDepKey',
  'PersistencePort',
  // 388 plan 03: the durable chip-truth read port and the two shapes it answers with. Types,
  // so none of them carries a database across the barrel — the only value that implements the
  // port is built by a composition in the one package sqlite is legal in. They are here for the
  // reason the other ports are: a composition root has to be able to NAME what it supplies, and
  // `postProcessing` is an OPTIONAL member, so a host that omits it is making a statement rather
  // than forgetting.
  'PostProcessingChainState',
  'PostProcessingJobRow',
  'PostProcessingReaderPort',
  'PostRunJobCapabilities',
  'RanJobOutcomeBase',
  // 389 plan 05: the D-08 recurrence seam's vocabulary — the provider port a composition root
  // implements (389 binds it to the run-outcome projection in plan 06; 390 rebinds the same
  // seam to its fingerprint window) and the query/answer shapes it speaks. Types, so nothing
  // here carries a database or a model across the barrel.
  'RecoverAbandonedClaimsInput',
  'RecoverAbandonedClaimsOutcome',
  'RecurrenceAnswer',
  'RecurrenceLadder',
  'RecurrenceProvider',
  'RecurrenceQuery',
  'ReplayedRunEvent',
  'RunInvocationPort',
  'RunNextJobInput',
  'RunNextJobOutcome',
  'RunsReaderPort',
  'StandInJobScript',
  'StartedRun',
  'StepEvidenceAddress',
  'StepEvidenceLookup',
  'ToolsPort',
]

/** Both pinned sets as one sorted list, for membership questions that ignore kind. */
export const EXPECTED_AGENT_BARREL_EXPORTS: readonly string[] = [
  ...EXPECTED_AGENT_BARREL_VALUE_EXPORTS,
  ...EXPECTED_AGENT_BARREL_TYPE_EXPORTS,
].sort()

export interface AgentBarrelExports {
  values: string[]
  types: string[]
}

const LOCAL_DECLARATION_RE =
  /^export\s+(?:declare\s+)?(const|let|var|function|async\s+function|class|abstract\s+class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm

const TYPE_DECLARATION_KEYWORDS = new Set(['interface', 'type'])

/**
 * The names a barrel publishes, split by kind.
 *
 * Re-export statements are read through the shared module-statement parser, so a clause
 * spread over several lines is one statement rather than several partial ones. The
 * EXPORTED name is the right-hand side of an alias: renaming on the way out changes what
 * a consumer can reach, which is the thing being pinned.
 */
export function readAgentBarrelExports(source: string): AgentBarrelExports {
  const values = new Set<string>()
  const types = new Set<string>()

  for (const statement of parseModuleStatements(source)) {
    if (statement.keyword !== 'export') continue

    const clause = statement.clause
    const statementIsTypeOnly = /^type\b/.test(clause)
    const braced = /\{([\s\S]*)\}/.exec(clause)

    if (braced === null) {
      // `export * from ...` republishes an unknown set. The barrel does not do this, and
      // a pin cannot describe what it cannot enumerate, so it is reported as its own name.
      values.add(clause.trim() === '' ? 'default' : clause.trim())
      continue
    }

    for (const raw of (braced[1] ?? '').split(',')) {
      const entry = raw.trim()
      if (entry === '') continue
      const entryIsTypeOnly = /^type\b/.test(entry)
      const withoutModifier = entry.replace(/^type\s+/, '')
      const parts = withoutModifier.split(/\s+as\s+/)
      const exported = (parts[parts.length - 1] ?? withoutModifier).trim()
      if (exported === '') continue
      if (statementIsTypeOnly || entryIsTypeOnly) types.add(exported)
      else values.add(exported)
    }
  }

  for (const match of stripCodeComments(source).matchAll(LOCAL_DECLARATION_RE)) {
    const keyword = (match[1] ?? '').trim()
    const name = match[2]
    if (name === undefined) continue
    if (TYPE_DECLARATION_KEYWORDS.has(keyword)) types.add(name)
    else values.add(name)
  }

  if (/^export\s+default\b/m.test(stripCodeComments(source))) {
    values.add('default')
  }

  return { values: [...values].sort(), types: [...types].sort() }
}

function setDrift(
  kind: 'value' | 'type',
  actual: readonly string[],
  expected: readonly string[],
): string[] {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)

  return [
    ...[...actualSet]
      .filter(name => !expectedSet.has(name))
      .sort()
      .map(name => `agent-barrel: unexpected ${kind} export ${name}`),
    ...[...expectedSet]
      .filter(name => !actualSet.has(name))
      .sort()
      .map(name => `agent-barrel: missing ${kind} export ${name}`),
  ]
}

/**
 * FUNC-01: the barrel's published set equals the pinned set exactly, in both kinds.
 *
 * Arrival and departure are separate offenders with distinct wording, so the failure names
 * which mistake was made rather than printing two sets and leaving a reader to diff them.
 */
export function findAgentBarrelOffenders(source: string): string[] {
  const actual = readAgentBarrelExports(source)

  return [
    ...setDrift('value', actual.values, EXPECTED_AGENT_BARREL_VALUE_EXPORTS),
    ...setDrift('type', actual.types, EXPECTED_AGENT_BARREL_TYPE_EXPORTS),
  ]
}
