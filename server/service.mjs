import { randomUUID } from 'node:crypto'
import { ApiError, githubApi, publicRepo, publicUser } from './github.mjs'

export function createRepoService({
  api = githubApi,
  now = Date.now,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const plans = new Map()
  const jobs = new Map()
  let activeJob = null

  function prune() {
    for (const [key, value] of plans) if (value.expiresAt < now()) plans.delete(key)
    for (const [key, value] of jobs)
      if (value.finishedAt && value.finishedAt < now() - 3_600_000) jobs.delete(key)
  }

  async function list() {
    const user = await api('user')
    const pages = await api(
      'user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100',
      { paginate: true },
    )
    const repositories = pages
      .flat()
      .filter((repo) => repo.owner.id === user.id)
      .map(publicRepo)
    return { user: publicUser(user), repositories, syncedAt: new Date(now()).toISOString() }
  }

  async function prepare(ids, action = 'delete') {
    prune()
    if (!['delete', 'archive'].includes(action))
      throw new ApiError('Unsupported repository action.')
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      ids.some((id) => !Number.isSafeInteger(id))
    ) {
      throw new ApiError('Select between 1 and 500 repositories to review.')
    }
    if (new Set(ids).size !== ids.length)
      throw new ApiError('The selection contains duplicate repositories.')
    const { user, repositories } = await list()
    const byId = new Map(repositories.map((repo) => [repo.id, repo]))
    const selected = ids.map((id) => byId.get(id))
    if (
      selected.some((repo) => !repo || !(action === 'archive' ? repo.canArchive : repo.canDelete))
    ) {
      throw new ApiError(
        `A selected repository is unavailable, ${action === 'archive' ? 'already archived, ' : ''}or you do not have permission to ${action} it. Refresh your list.`,
        409,
      )
    }
    const plan = {
      id: randomUUID(),
      userId: user.id,
      login: user.login,
      repositories: selected,
      action,
      expiresAt: now() + 5 * 60_000,
    }
    plans.set(plan.id, plan)
    return plan
  }

  async function run(job, plan) {
    try {
      // Validate the entire batch before changing any repositories.
      const user = await api('user')
      if (user.id !== plan.userId || user.login !== plan.login)
        throw new ApiError(
          'The signed-in account changed. Refresh and review your selection again.',
          409,
        )
      for (const repo of plan.repositories) {
        const current = await api(`repos/${repo.fullName}`)
        if (
          current.id !== repo.id ||
          current.full_name !== repo.fullName ||
          current.owner.id !== plan.userId ||
          current.permissions?.admin !== true ||
          current.disabled
        ) {
          throw new ApiError(
            `Permissions or identity changed for ${repo.fullName}. No repositories were ${plan.action === 'archive' ? 'archived' : 'deleted'}. Refresh and review again.`,
            409,
          )
        }
      }
      job.phase = plan.action === 'archive' ? 'archiving' : 'deleting'
      for (let index = 0; index < plan.repositories.length; index++) {
        const repo = plan.repositories[index]
        job.current = repo.fullName
        try {
          // Recheck immediately before each mutation to detect renames or transfers.
          const current = await api(`repos/${repo.fullName}`)
          if (
            current.id !== repo.id ||
            current.full_name !== repo.fullName ||
            current.owner.id !== plan.userId ||
            current.permissions?.admin !== true
          ) {
            throw new ApiError(
              'Repository identity or permissions changed. Refresh before retrying.',
              409,
            )
          }
          if (plan.action === 'archive') {
            const updated = current.archived
              ? current
              : await api(`repos/${repo.fullName}`, { method: 'PATCH', fields: { archived: true } })
            if (updated?.id !== repo.id || updated.archived !== true)
              throw new ApiError(
                'GitHub did not confirm that the repository was archived. Refresh before retrying.',
                502,
              )
          } else {
            await api(`repos/${repo.fullName}`, { method: 'DELETE' })
          }
          job.results.push({
            id: repo.id,
            fullName: repo.fullName,
            status: plan.action === 'archive' ? 'archived' : 'deleted',
            size: repo.size,
          })
        } catch (error) {
          job.results.push({
            id: repo.id,
            fullName: repo.fullName,
            status: 'failed',
            message: error.message,
          })
          if ([401, 403, 429].includes(error.status)) {
            for (const remaining of plan.repositories.slice(index + 1)) {
              job.results.push({
                id: remaining.id,
                fullName: remaining.fullName,
                status: 'failed',
                message:
                  'Batch stopped after GitHub blocked a request. Review permissions or wait before retrying.',
              })
            }
            break
          }
        }
        if (index < plan.repositories.length - 1) await pause(1000)
      }
    } catch (error) {
      job.error = error.message
      job.results = plan.repositories.map((repo) => ({
        id: repo.id,
        fullName: repo.fullName,
        status: 'failed',
        message: error.message,
      }))
    } finally {
      job.phase = 'complete'
      job.current = null
      job.finishedAt = now()
      activeJob = null
    }
  }

  function start(id, action = 'delete') {
    prune()
    const plan = plans.get(id)
    if (!plan)
      throw new ApiError(
        'This confirmation expired or was already used. Close it and review your selection again.',
        409,
      )
    if (plan.action !== action)
      throw new ApiError(
        'This confirmation belongs to a different action. Review your selection again.',
        409,
      )
    if (activeJob)
      throw new ApiError('Another repository action is in progress. Wait for it to finish.', 409)
    plans.delete(id)
    const job = {
      id: randomUUID(),
      phase: 'validating',
      total: plan.repositories.length,
      results: [],
      userId: plan.userId,
      login: plan.login,
      action: plan.action,
      startedAt: now(),
      current: null,
      finishedAt: null,
    }
    jobs.set(job.id, job)
    activeJob = job.id
    void run(job, plan)
    return job
  }

  function getJob(id) {
    prune()
    const job = jobs.get(id)
    if (!job)
      throw new ApiError(
        'This action session is no longer available. Refresh your repositories to check their current state.',
        404,
      )
    return job
  }

  return { list, prepare, start, getJob, active: () => activeJob }
}
