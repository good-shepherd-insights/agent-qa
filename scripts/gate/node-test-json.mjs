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
  let summary = null
  for await (const event of source) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.data.details?.type !== 'test') continue
      tests.push({
        file: event.data.file,
        name: event.data.name,
        nesting: event.data.nesting,
        status: statusOf(event),
      })
    } else if (event.type === 'test:summary' && !event.data.file) {
      summary = event.data.counts ?? null
    }
  }
  yield `${JSON.stringify({ schemaVersion: 1, tests, summary }, null, 2)}\n`
}
