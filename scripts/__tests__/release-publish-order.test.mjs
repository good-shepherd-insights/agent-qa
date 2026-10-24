import assert from 'node:assert/strict'
import test from 'node:test'
import { derivePublishOrder, getPublicPackages, publicPackageNames } from '../release/packages.mjs'

test('publish order equals the real public manifests and puts every internal dependency first', () => {
  const records = getPublicPackages()
  assert.deepEqual(records.map(record => record.pkg.name), publicPackageNames)
  const position = new Map(publicPackageNames.map((name, index) => [name, index]))
  for (const record of records) {
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const dep of Object.keys(record.pkg[field] ?? {})) {
        if (!position.has(dep)) continue
        assert.ok(
          position.get(dep) < position.get(record.pkg.name),
          `${record.pkg.name} publishes before ${dep}`,
        )
      }
    }
  }
})

test('rejects missing, duplicate, private, or extra public package records', () => {
  assert.throws(() => derivePublishOrder([]), /missing public package/)
  assert.throws(
    () => derivePublishOrder([
      ...publicPackageNames.map(name => ({ pkg: { name, private: false } })),
      { pkg: { name: 'agent-qa', private: false } },
    ]),
    /duplicate public package/,
  )
  assert.throws(
    () => derivePublishOrder(publicPackageNames.map(name => ({ pkg: { name, private: name === 'agent-qa' } }))),
    /private public package/,
  )
  assert.throws(
    () => derivePublishOrder([
      ...publicPackageNames.map(name => ({ pkg: { name, private: false } })),
      { pkg: { name: '@vostride/agent-qa-extra', private: false } },
    ]),
    /extra public package/,
  )
})
