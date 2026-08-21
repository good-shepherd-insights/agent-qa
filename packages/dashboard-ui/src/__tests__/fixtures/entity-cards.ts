// Entity cards PRODUCED BY THE SHIPPED PRODUCER, committed verbatim (400-08, DASH-03).
//
// EVERY OBJECT BELOW IS `produceEntityCard`'s OUTPUT, not a shape somebody typed. It was generated
// by driving `packages/agent/src/functions/entity-cards/produce-card.ts` over one descriptor per
// kind and pasting what came back — the 390-03 produced-not-literal law, applied where the
// producer's package is not reachable: `dashboard-ui` is a surface and does not depend on `agent`,
// so a fixture here cannot CALL the producer, and a hand-typed card would be free to pin an input
// no producer can emit. `EntityCardSchema.parse` runs over each one at module load, so a fixture
// that stopped being a legal card is a RED at import rather than a cell that renders nonsense.
//
// THE `withUrl` VARIANTS carry a `url` composed against `http://127.0.0.1:3470` + workspace `demo`,
// which is what 400-01's D-16 overlay supplies to a dashboard serving its own conversation.
// `TST_NO_URL` is the SAME card produced with no configured base — the v52 default and the arm the
// url-absent honesty cell drives.

import { EntityCardSchema, type EntityCard } from "@vostride/agent-qa-schema"

/** Parse at module load: a fixture that is not a producible card must not reach a render. */
function card(value: unknown): EntityCard {
  return EntityCardSchema.parse(value) as EntityCard
}

/** A routed kind with a configured dashboard base — the happy path. */
export const TST_CARD: EntityCard = card({
  "kind": "TST",
  "status": "active",
  "id": "TST-001",
  "uri": "agentqa://test/TST-001",
  "title": "checkout rejects an expired card",
  "url": "http://127.0.0.1:3470/t/demo/test/TST-001/checkout-rejects-an-expired-card",
  "keyFacts": [
    {
      "label": "test id",
      "value": "t-irish-vise-s"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "TST-001"
      }
    },
    {
      "functionId": "runs.start",
      "label": "Run this test",
      "inputSeed": {
        "patterns": [
          "t-irish-vise-s"
        ]
      }
    }
  ]
})

/** The same test under an open quarantine window: four key facts, the status the ledger decided. */
export const TST_QUARANTINED_CARD: EntityCard = card({
  "kind": "TST",
  "status": "quarantined",
  "id": "TST-001",
  "uri": "agentqa://test/TST-001",
  "title": "checkout rejects an expired card",
  "url": "http://127.0.0.1:3470/t/demo/test/TST-001/checkout-rejects-an-expired-card",
  "keyFacts": [
    {
      "label": "test id",
      "value": "t-irish-vise-s"
    },
    {
      "label": "quarantine owner",
      "value": "payments-team"
    },
    {
      "label": "quarantine expires",
      "value": "2026-09-04T00:00:00.000Z"
    },
    {
      "label": "quarantine occurrence",
      "value": "timeout failures recurring; 4 quarantine windows since 2026-06-01T00:00:00.000Z; current window since 2026-08-05T00:00:00.000Z"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "TST-001"
      }
    },
    {
      "functionId": "runs.start",
      "label": "Run this test",
      "inputSeed": {
        "patterns": [
          "t-irish-vise-s"
        ]
      }
    }
  ]
})

/** The same test produced with NO configured base — `url` is absent, the v52 default. */
export const TST_NO_URL_CARD: EntityCard = card({
  "kind": "TST",
  "status": "active",
  "id": "TST-001",
  "uri": "agentqa://test/TST-001",
  "title": "checkout rejects an expired card",
  "keyFacts": [
    {
      "label": "test id",
      "value": "t-irish-vise-s"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "TST-001"
      }
    },
    {
      "functionId": "runs.start",
      "label": "Run this test",
      "inputSeed": {
        "patterns": [
          "t-irish-vise-s"
        ]
      }
    }
  ]
})

/** A routed kind whose card links into run-detail. */
export const RUN_CARD: EntityCard = card({
  "kind": "RUN",
  "status": "failed",
  "id": "RUN-001",
  "uri": "agentqa://run/RUN-001",
  "title": "nightly regression, build 4120",
  "url": "http://127.0.0.1:3470/t/demo/run/RUN-001/nightly-regression--build-4120",
  "keyFacts": [
    {
      "label": "run id",
      "value": "run-alpha"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "RUN-001"
      }
    },
    {
      "functionId": "runs.get",
      "label": "Open run",
      "inputSeed": {
        "runId": "run-alpha"
      }
    },
    {
      "functionId": "knowledge.brief.why",
      "label": "Explain a step",
      "inputSeed": {
        "runId": "run-alpha"
      }
    }
  ]
})

/** A reserved family (D-03): no actions, and no dashboard route. */
export const BUG_CARD: EntityCard = card({
  "kind": "BUG",
  "status": "reserved",
  "id": "BUG-001",
  "uri": "agentqa://bug/BUG-001",
  "title": "reserved address",
  "url": "http://127.0.0.1:3470/t/demo/bug/BUG-001/reserved-address",
  "keyFacts": [
    {
      "label": "reserved address",
      "value": "bug-reserved-001"
    }
  ],
  "actions": []
})

/** The only kind any shipped composition mints today — and an UNROUTED one. */
export const MEM_CARD: EntityCard = card({
  "kind": "MEM",
  "status": "active",
  "id": "MEM-001",
  "uri": "agentqa://memory/MEM-001",
  "title": "checkout flow sightings",
  "url": "http://127.0.0.1:3470/t/demo/memory/MEM-001/checkout-flow-sightings",
  "keyFacts": [
    {
      "label": "bundle id",
      "value": "bundle-checkout-flow"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "MEM-001"
      }
    },
    {
      "functionId": "knowledge.record.show",
      "label": "Show record",
      "inputSeed": {
        "recordId": "bundle-checkout-flow"
      }
    },
    {
      "functionId": "knowledge.forget.propose",
      "label": "Preview forgetting this",
      "inputSeed": {
        "target": {
          "grain": "record",
          "recordId": "bundle-checkout-flow"
        }
      }
    }
  ]
})

/** An unrouted kind that does have actions. */
export const POL_CARD: EntityCard = card({
  "kind": "POL",
  "status": "active",
  "id": "POL-001",
  "uri": "agentqa://policy/POL-001",
  "title": "default gate policy",
  "url": "http://127.0.0.1:3470/t/demo/policy/POL-001/default-gate-policy",
  "keyFacts": [
    {
      "label": "policy id",
      "value": "policy-default"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "POL-001"
      }
    }
  ]
})

/** The slug-addressed kind, routed at `/config`. */
export const TGT_CARD: EntityCard = card({
  "kind": "TGT",
  "status": "active",
  "id": "TGT-checkout",
  "uri": "agentqa://target/TGT-checkout",
  "title": "checkout web target",
  "url": "http://127.0.0.1:3470/t/demo/target/TGT-checkout/checkout-web-target",
  "keyFacts": [
    {
      "label": "target name",
      "value": "checkout"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "TGT-checkout"
      }
    }
  ]
})

/** A rename, whose second key fact carries an `agentqa://` ref to the successor. */
export const TGT_RENAMED_CARD: EntityCard = card({
  "kind": "TGT",
  "status": "renamed",
  "id": "TGT-checkout",
  "uri": "agentqa://target/TGT-checkout",
  "title": "checkout web target",
  "url": "http://127.0.0.1:3470/t/demo/target/TGT-checkout/checkout-web-target",
  "keyFacts": [
    {
      "label": "target name",
      "value": "checkout"
    },
    {
      "label": "renamed to",
      "value": "checkout-v2",
      "ref": "agentqa://target/TGT-checkout-v2"
    }
  ],
  "actions": [
    {
      "functionId": "entities.get",
      "label": "Open card",
      "inputSeed": {
        "ref": "TGT-checkout"
      }
    }
  ]
})

/** Every fixture, so a cell can walk the complete set rather than the kinds it remembered. */
export const PRODUCED_ENTITY_CARDS = {
  TST: TST_CARD,
  TST_QUARANTINED: TST_QUARANTINED_CARD,
  TST_NO_URL: TST_NO_URL_CARD,
  RUN: RUN_CARD,
  BUG: BUG_CARD,
  MEM: MEM_CARD,
  POL: POL_CARD,
  TGT: TGT_CARD,
  TGT_RENAMED: TGT_RENAMED_CARD,
} as const
