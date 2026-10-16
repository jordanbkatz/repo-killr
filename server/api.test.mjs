import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { createApiMiddleware } from './api.mjs'

test('local API blocks cross-origin mutations, missing session tokens, and invalid hosts', async (t) => {
  let confirmed = 0
  let confirmedAction
  const middleware = createApiMiddleware({
    api: async () => ({ id: 7, login: 'test-owner' }),
    service: {
      active: () => null,
      list: async () => ({ repositories: [] }),
      prepare: async (ids, action) => ({ id: 'mock-plan', action, ids }),
      start: (id, action = 'delete') => {
        confirmed++
        confirmedAction = action
        return { id: 'mock-job' }
      },
    },
  })
  const server = createServer((req, res) =>
    middleware(req, res, () => {
      res.writeHead(404)
      res.end()
    }),
  )
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const session = await (await fetch(`${base}/api/session`)).json()
  assert.equal(typeof session.sessionToken, 'string')
  const confirm = (headers) =>
    fetch(`${base}/api/deletions/confirm`, { method: 'POST', headers, body: '{}' })
  assert.equal((await confirm({ 'Content-Type': 'application/json' })).status, 403)
  assert.equal(
    (
      await confirm({
        'Content-Type': 'application/json',
        'X-Repo-Killr-Token': session.sessionToken,
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await confirm({
        'Content-Type': 'application/json',
        'X-Repo-Killr-Token': session.sessionToken,
        'Sec-Fetch-Site': 'cross-site',
      })
    ).status,
    403,
  )
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/session`, { headers: { Host: 'attacker.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
  assert.equal(invalidHostStatus, 403)
  assert.equal(
    (await confirm({ 'Content-Type': 'text/plain', 'X-Repo-Killr-Token': session.sessionToken }))
      .status,
    415,
  )
  assert.equal(confirmed, 0)
  assert.equal(
    (
      await confirm({
        'Content-Type': 'application/json',
        'X-Repo-Killr-Token': session.sessionToken,
        Origin: base,
      })
    ).status,
    202,
  )
  assert.equal(confirmed, 1)
  const archiveHeaders = {
    'Content-Type': 'application/json',
    'X-Repo-Killr-Token': session.sessionToken,
    Origin: base,
  }
  assert.equal(
    (
      await fetch(`${base}/api/archives/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  )
  assert.equal(
    (
      await fetch(`${base}/api/archives/confirm`, {
        method: 'POST',
        headers: { ...archiveHeaders, Origin: 'https://attacker.example' },
        body: '{}',
      })
    ).status,
    403,
  )
  const plan = await (
    await fetch(`${base}/api/archives/prepare`, {
      method: 'POST',
      headers: archiveHeaders,
      body: JSON.stringify({ repositoryIds: [1] }),
    })
  ).json()
  assert.equal(plan.action, 'archive')
  assert.deepEqual(plan.ids, [1])
  assert.equal(
    (
      await fetch(`${base}/api/archives/confirm`, {
        method: 'POST',
        headers: archiveHeaders,
        body: JSON.stringify({ planId: plan.id }),
      })
    ).status,
    202,
  )
  assert.equal(confirmed, 2)
  assert.equal(confirmedAction, 'archive')
})
