import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compareRepositoryRecency,
  exactTime,
  relativeTime,
  repositoryPushTime,
} from '../src/repositoryDates.js'
import { publicRepo } from './github.mjs'

test('recency uses GitHub push data rather than newer repository metadata', () => {
  const inactive = {
    name: 'old-code',
    pushedAt: '2022-12-08T13:31:52Z',
    updatedAt: '2026-07-20T06:24:00Z',
  }
  const active = {
    name: 'recent-code',
    pushedAt: '2026-06-01T12:00:00Z',
    updatedAt: '2026-06-01T12:00:00Z',
  }
  assert.equal(repositoryPushTime(inactive), Date.parse(inactive.pushedAt))
  assert.deepEqual(
    [inactive, active].sort(compareRepositoryRecency).map((repo) => repo.name),
    ['recent-code', 'old-code'],
  )
  assert.deepEqual(
    [inactive, active]
      .sort((a, b) => compareRepositoryRecency(a, b, true))
      .map((repo) => repo.name),
    ['old-code', 'recent-code'],
  )
})

test('missing push dates are not replaced with metadata and sort last in either direction', () => {
  const missing = { name: 'unknown', pushedAt: null, updatedAt: '2026-10-16T00:00:00Z' }
  const valid = { name: 'known', pushedAt: '2022-01-01T00:00:00Z' }
  assert.equal(repositoryPushTime(missing), null)
  for (const oldest of [false, true])
    assert.deepEqual(
      [missing, valid]
        .sort((a, b) => compareRepositoryRecency(a, b, oldest))
        .map((repo) => repo.name),
      ['known', 'unknown'],
    )
})

test('recent timestamps show elapsed minutes and hours rather than an ambiguous Today label', () => {
  const now = Date.parse('2026-10-16T04:15:00Z')
  assert.equal(relativeTime('2026-10-16T04:14:40Z', now), 'Just now')
  assert.equal(relativeTime('2026-10-16T04:03:00Z', now), '12 minutes ago')
  assert.equal(relativeTime('2026-10-16T02:15:00Z', now), '2 hours ago')
  assert.equal(relativeTime('2026-10-14T04:15:00Z', now), '2 days ago')
  assert.equal(relativeTime('2026-10-14T04:30:00Z', now), '2 days ago')
})

test('crossing midnight does not mislabel a recent update as yesterday', () => {
  assert.equal(
    relativeTime('2026-10-15T23:55:00-04:00', Date.parse('2026-10-16T00:05:00-04:00')),
    '10 minutes ago',
  )
})

test('calendar month and year boundaries handle month lengths and leap years', () => {
  assert.equal(
    relativeTime('2025-10-16T12:00:00Z', Date.parse('2026-10-16T12:00:00Z')),
    '1 year ago',
  )
  assert.equal(
    relativeTime('2026-01-31T12:00:00Z', Date.parse('2026-02-28T12:00:00Z')),
    '1 month ago',
  )
  assert.equal(
    relativeTime('2024-02-29T12:00:00Z', Date.parse('2025-02-28T12:00:00Z')),
    '1 year ago',
  )
  assert.equal(
    relativeTime('2026-09-16T12:00:00Z', Date.parse('2026-10-16T11:00:00Z')),
    '30 days ago',
  )
})

test('invalid dates stay unavailable and future timestamps are not silently called Today', () => {
  for (const value of [null, undefined, '', 'invalid']) {
    assert.equal(relativeTime(value), 'Date unavailable')
    assert.equal(exactTime(value), 'Date unavailable')
  }
  assert.equal(
    relativeTime('2026-10-16T05:00:00Z', Date.parse('2026-10-16T04:00:00Z')),
    'in 1 hour',
  )
})

test('the GitHub mapping preserves exact, distinct API timestamps', () => {
  const raw = {
    id: 1,
    owner: { id: 7 },
    pushed_at: '2022-12-08T13:31:52Z',
    updated_at: '2026-07-20T06:24:00Z',
    created_at: '2022-01-01T00:00:00Z',
  }
  const mapped = publicRepo(raw)
  assert.equal(mapped.pushedAt, raw.pushed_at)
  assert.equal(mapped.updatedAt, raw.updated_at)
  assert.equal(repositoryPushTime(mapped), Date.parse(raw.pushed_at))
})
