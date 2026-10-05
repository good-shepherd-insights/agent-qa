function statusOf(event) {
  const { data } = event
  if (data.skip !== undefined && data.skip !== false) return 'skipped'
  if (data.todo !== undefined && data.todo !== false) return 'todo'
  if (event.type === 'test:pass') return 'passed'
  if (data.details?.error?.failureType === 'cancelledByParent') return 'cancelled'
  return 'failed'
}

export default async function* nodeTestJson(source) {
  const tests = []
  const ancestry = new Map()
  let summary = null
  for await (const event of source) {
    if (event.type === 'test:start') {
      const stack = ancestry.get(event.data.file) ?? []
      stack.length = event.data.nesting
      stack.push(event.data.name)
      ancestry.set(event.data.file, stack)
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.data.details?.type !== 'test') continue
      const ancestors = (ancestry.get(event.data.file) ?? []).slice(0, event.data.nesting)
      tests.push({
        file: event.data.file,
        name: event.data.name,
        fullName: [...ancestors, event.data.name].join(' > '),
        nesting: event.data.nesting,
        status: statusOf(event),
      })
    } else if (event.type === 'test:summary' && !event.data.file) {
      summary = event.data.counts ?? null
    }
  }
  yield `${JSON.stringify({ schemaVersion: 1, tests, summary }, null, 2)}\n`
}
