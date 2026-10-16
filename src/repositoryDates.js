const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' })
const units = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

export function timestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : null
}

// Metadata updates (updatedAt) can happen without any new code being pushed.
export function repositoryPushTime(repo) {
  return timestamp(repo.pushedAt)
}

export function compareRepositoryRecency(a, b, oldestFirst = false) {
  const first = repositoryPushTime(a)
  const second = repositoryPushTime(b)
  if (first === null && second === null) return a.name.localeCompare(b.name)
  if (first === null) return 1
  if (second === null) return -1
  return (oldestFirst ? first - second : second - first) || a.name.localeCompare(b.name)
}

export function relativeTime(value, now = Date.now()) {
  const time = timestamp(value)
  if (time === null) return 'Date unavailable'
  const seconds = (time - now) / 1000
  if (Math.abs(seconds) < 60) return 'Just now'
  const earlier = new Date(Math.min(time, now))
  const later = new Date(Math.max(time, now))
  let months =
    (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
    later.getUTCMonth() -
    earlier.getUTCMonth()
  const day = Math.min(
    earlier.getUTCDate(),
    new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth() + 1, 0)).getUTCDate(),
  )
  const anniversary = Date.UTC(
    later.getUTCFullYear(),
    later.getUTCMonth(),
    day,
    earlier.getUTCHours(),
    earlier.getUTCMinutes(),
    earlier.getUTCSeconds(),
    earlier.getUTCMilliseconds(),
  )
  if (later.getTime() < anniversary) months--
  const sign = seconds < 0 ? -1 : 1
  if (months >= 12) return relative.format(sign * Math.floor(months / 12), 'year')
  if (months >= 1) return relative.format(sign * months, 'month')
  const [unit, duration] = units.find(([, duration]) => Math.abs(seconds) >= duration)
  // Round day-scale ages instead of calling almost two days ago "1 day ago".
  const amount =
    unit === 'day'
      ? sign * Math.round(Math.abs(seconds) / duration)
      : Math.trunc(seconds / duration)
  return relative.format(amount, unit)
}

export function exactTime(value) {
  const time = timestamp(value)
  if (time === null) return 'Date unavailable'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(time)
}
