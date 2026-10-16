import test from 'node:test'
import assert from 'node:assert/strict'
import { createRepoService } from './service.mjs'
import { ApiError } from './github.mjs'

const user = { id: 7, login: 'test-owner', name: 'Test Owner' }
const repo = (id, overrides = {}) => ({
  id,
  name: `repo-${id}`,
  full_name: `test-owner/repo-${id}`,
  owner: { id: 7 },
  permissions: { admin: true },
  size: 100,
  ...overrides,
})

function fixture({
  repos = [repo(1), repo(2)],
  deleteError,
  patchError,
  patchReturnsUnchanged = false,
} = {}) {
  const calls = []
  const state = {
    user: { ...user },
    repos,
    metadata: new Map(repos.map((item) => [item.full_name, item])),
  }
  const api = async (path, options = {}) => {
    calls.push({
      path,
      method: options.method || 'GET',
      ...(options.fields ? { fields: options.fields } : {}),
    })
    if (options.method === 'DELETE') {
      if (deleteError) deleteError(path)
      return null
    }
    if (path === 'user') return state.user
    if (path.startsWith('user/repos?')) {
      assert.equal(options.paginate, true)
      return [state.repos.slice(0, 1), state.repos.slice(1)]
    }
    const item = state.metadata.get(path.replace('repos/', ''))
    if (!item) throw new ApiError('Repository unavailable.', 404)
    if (options.method === 'PATCH') {
      if (patchError) patchError(path)
      assert.deepEqual(options.fields, { archived: true })
      if (patchReturnsUnchanged) return { ...item, archived: false }
      item.archived = true
    }
    return item
  }
  let time = 1000
  const service = createRepoService({ api, now: () => time, pause: async () => {} })
  return {
    service,
    calls,
    state,
    advance: (ms) => {
      time += ms
    },
    deletes: () => calls.filter((call) => call.method === 'DELETE'),
  }
}

async function finish(service, job) {
  for (let attempt = 0; attempt < 200 && job.phase !== 'complete'; attempt++)
    await new Promise((resolve) => setImmediate(resolve))
  assert.equal(service.getJob(job.id).phase, 'complete')
  return job
}

test('listing combines all pages and excludes repositories belonging to other accounts', async () => {
  const { service } = fixture({ repos: [repo(1), repo(2, { owner: { id: 999 } })] })
  const result = await service.list()
  assert.deepEqual(
    result.repositories.map((item) => item.id),
    [1],
  )
  assert.equal(result.user.login, 'test-owner')
})

test('confirmation preparation rejects duplicate, unknown, and unauthorized IDs', async () => {
  const { service, deletes } = fixture({
    repos: [repo(1), repo(2, { permissions: { admin: false } })],
  })
  for (const ids of [[], [1, 1], [999], [2], ['1']]) await assert.rejects(service.prepare(ids))
  assert.equal(deletes().length, 0)
})

test('reviewing a selection never deletes it and confirmation requires a prepared plan', async () => {
  const { service, deletes } = fixture()
  const plan = await service.prepare([1, 2])
  assert.equal('phrase' in plan, false)
  for (const id of [undefined, '', 'unknown-plan'])
    assert.throws(() => service.start(id), /expired|already used/)
  assert.equal(deletes().length, 0)
})

test('expired confirmations cannot start a deletion', async () => {
  const { service, advance, deletes } = fixture()
  const plan = await service.prepare([1])
  advance(300_001)
  assert.throws(() => service.start(plan.id), /expired/)
  assert.equal(deletes().length, 0)
})

test('one confirmation without extra input deletes only reviewed targets and cannot be reused', async () => {
  const { service, deletes } = fixture({ repos: [repo(1), repo(2), repo(3)] })
  const plan = await service.prepare([1, 3])
  const job = await finish(service, service.start(plan.id))
  assert.deepEqual(
    deletes().map((call) => call.path),
    ['repos/test-owner/repo-1', 'repos/test-owner/repo-3'],
  )
  assert.deepEqual(
    job.results.map((result) => result.status),
    ['deleted', 'deleted'],
  )
  assert.throws(() => service.start(plan.id), /already used/)
  assert.equal(service.active(), null)
})

test('switching accounts after review prevents every deletion', async () => {
  const { service, state, deletes } = fixture()
  const plan = await service.prepare([1, 2])
  state.user = { id: 8, login: 'other-account' }
  const job = await finish(service, service.start(plan.id))
  assert.match(job.error, /account changed/)
  assert.equal(deletes().length, 0)
})

test('a replaced repository or ownership transfer aborts the full preflight before deleting anything', async () => {
  for (const change of [{ id: 999 }, { owner: { id: 8 } }, { permissions: { admin: false } }]) {
    const { service, state, deletes } = fixture()
    const plan = await service.prepare([1, 2])
    state.metadata.set('test-owner/repo-2', repo(2, change))
    const job = await finish(service, service.start(plan.id))
    assert.equal(deletes().length, 0)
    assert.match(job.error, /identity changed/)
    assert.equal(job.results.filter((result) => result.status === 'failed').length, 2)
  }
})

test('partial failures report each repository accurately and do not claim failed deletes succeeded', async () => {
  const { service } = fixture({
    deleteError: (path) => {
      if (path.endsWith('repo-2')) throw new ApiError('Repository unavailable.', 404)
    },
  })
  const plan = await service.prepare([1, 2])
  const job = await finish(service, service.start(plan.id))
  assert.equal(job.results[0].status, 'deleted')
  assert.equal(job.results[1].status, 'failed')
  assert.equal(job.results[1].message, 'Repository unavailable.')
})

test('GitHub rate limits stop the remaining batch without further destructive requests', async () => {
  const { service, deletes } = fixture({
    repos: [repo(1), repo(2), repo(3)],
    deleteError: () => {
      throw new ApiError('Rate limited.', 429)
    },
  })
  const plan = await service.prepare([1, 2, 3])
  const job = await finish(service, service.start(plan.id))
  assert.equal(deletes().length, 1)
  assert.equal(job.results.length, 3)
  assert.ok(job.results.every((result) => result.status === 'failed'))
})

test('only one batch can run at a time', async () => {
  const { service } = fixture()
  const first = await service.prepare([1])
  const second = await service.prepare([2])
  const job = service.start(first.id)
  assert.throws(() => service.start(second.id), /in progress/)
  await finish(service, job)
})

test('archive availability excludes archived, disabled, and non-admin repositories', async () => {
  const { service } = fixture({
    repos: [
      repo(1),
      repo(2, { archived: true }),
      repo(3, { disabled: true }),
      repo(4, { permissions: { admin: false } }),
    ],
  })
  const { repositories } = await service.list()
  assert.deepEqual(
    repositories.map((item) => item.canArchive),
    [true, false, false, false],
  )
  assert.equal(repositories[1].canDelete, true)
  for (const ids of [[2], [3], [4], [999]]) await assert.rejects(service.prepare(ids, 'archive'))
  await assert.rejects(service.prepare([1], 'unsupported'))
})

test('archive confirmation sends PATCH with archived true and never deletes repositories', async () => {
  const { service, calls, state, deletes } = fixture({ repos: [repo(1), repo(2), repo(3)] })
  const plan = await service.prepare([1, 3], 'archive')
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0)
  const job = await finish(service, service.start(plan.id, 'archive'))
  assert.equal(job.action, 'archive')
  assert.deepEqual(
    job.results.map((result) => result.status),
    ['archived', 'archived'],
  )
  assert.deepEqual(
    calls
      .filter((call) => call.method === 'PATCH')
      .map((call) => ({ path: call.path, fields: call.fields })),
    [
      { path: 'repos/test-owner/repo-1', fields: { archived: true } },
      { path: 'repos/test-owner/repo-3', fields: { archived: true } },
    ],
  )
  assert.equal(deletes().length, 0)
  assert.equal(state.repos.length, 3)
  assert.deepEqual(
    state.repos.map((item) => Boolean(item.archived)),
    [true, false, true],
  )
  assert.throws(() => service.start(plan.id, 'archive'), /already used/)
})

test('an archive plan cannot be used for deletion, and a delete plan cannot be used for archiving', async () => {
  const { service, calls } = fixture()
  const archive = await service.prepare([1], 'archive')
  const deletion = await service.prepare([2])
  assert.throws(() => service.start(archive.id), /different action/)
  assert.throws(() => service.start(deletion.id, 'archive'), /different action/)
  assert.equal(calls.filter((call) => ['PATCH', 'DELETE'].includes(call.method)).length, 0)
  assert.equal(
    (await finish(service, service.start(archive.id, 'archive'))).results[0].status,
    'archived',
  )
  assert.equal((await finish(service, service.start(deletion.id))).results[0].status, 'deleted')
})

test('expired archive confirmations cannot mutate repositories', async () => {
  const { service, calls, advance } = fixture()
  const plan = await service.prepare([1], 'archive')
  advance(300_001)
  assert.throws(() => service.start(plan.id, 'archive'), /expired/)
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 0)
})

test('account changes and ownership transfers stop an archive batch before its first PATCH', async () => {
  for (const transfer of [false, true]) {
    const { service, state, calls } = fixture()
    const plan = await service.prepare([1, 2], 'archive')
    if (transfer) state.metadata.set('test-owner/repo-2', repo(2, { owner: { id: 99 } }))
    else state.user = { id: 99, login: 'other-account' }
    const job = await finish(service, service.start(plan.id, 'archive'))
    assert.ok(job.results.every((result) => result.status === 'failed'))
    assert.equal(calls.filter((call) => ['PATCH', 'DELETE'].includes(call.method)).length, 0)
  }
})

test('archive partial failures preserve accurate per-repository outcomes', async () => {
  const { service, deletes } = fixture({
    repos: [repo(1), repo(2), repo(3)],
    patchError: (path) => {
      if (path.endsWith('repo-2')) throw new ApiError('Repository unavailable.', 404)
    },
  })
  const plan = await service.prepare([1, 2, 3], 'archive')
  const job = await finish(service, service.start(plan.id, 'archive'))
  assert.deepEqual(
    job.results.map((result) => result.status),
    ['archived', 'failed', 'archived'],
  )
  assert.equal(deletes().length, 0)
})

test('archive rate limits stop the remaining batch', async () => {
  const { service, calls } = fixture({
    patchError: () => {
      throw new ApiError('Rate limited.', 429)
    },
  })
  const plan = await service.prepare([1, 2], 'archive')
  const job = await finish(service, service.start(plan.id, 'archive'))
  assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1)
  assert.ok(job.results.every((result) => result.status === 'failed'))
})

test('GitHub must confirm archived true before success is reported', async () => {
  const { service, deletes } = fixture({ patchReturnsUnchanged: true })
  const plan = await service.prepare([1], 'archive')
  const job = await finish(service, service.start(plan.id, 'archive'))
  assert.equal(job.results[0].status, 'failed')
  assert.match(job.results[0].message, /did not confirm/)
  assert.equal(deletes().length, 0)
})
