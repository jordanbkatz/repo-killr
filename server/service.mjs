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
      'user/repos?affiliation=owner&sort=updated&direction=desc&per_page=100',
      { paginate: true },
    )
    const repositories = pages
      .flat()
      .filter((repo) => repo.owner.id === user.id)
      .map(publicRepo)
    return { user: publicUser(user), repositories, syncedAt: new Date(now()).toISOString() }
  }

  async function prepare(ids) {
    prune()
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
    if (selected.some((repo) => !repo || !repo.canDelete)) {
      throw new ApiError(
        'A selected repository is unavailable or you do not have permission to delete it. Refresh your list.',
        409,
      )
    }
    const plan = {
      id: randomUUID(),
      userId: user.id,
      login: user.login,
      repositories: selected,
      expiresAt: now() + 5 * 60_000,
    }
    plans.set(plan.id, plan)
    return plan
  }

  async function run(job, plan) {
    try {
      // Validate the entire batch before making the first destructive request.
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
            `Permissions or identity changed for ${repo.fullName}. No repositories were deleted. Refresh and review again.`,
            409,
          )
        }
      }
      job.phase = 'deleting'
      for (let index = 0; index < plan.repositories.length; index++) {
        const repo = plan.repositories[index]
        job.current = repo.fullName
        try {
          // Recheck immediately before DELETE to detect renames/transfers during a large batch.
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
          await api(`repos/${repo.fullName}`, { method: 'DELETE' })
          job.results.push({
            id: repo.id,
            fullName: repo.fullName,
            status: 'deleted',
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

  function start(id) {
    prune()
    const plan = plans.get(id)
    if (!plan)
      throw new ApiError(
        'This confirmation expired or was already used. Close it and review your selection again.',
        409,
      )
    if (activeJob)
      throw new ApiError('Another deletion is in progress. Wait for it to finish.', 409)
    plans.delete(id)
    const job = {
      id: randomUUID(),
      phase: 'validating',
      total: plan.repositories.length,
      results: [],
      userId: plan.userId,
      login: plan.login,
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
        'This deletion session is no longer available. Refresh your repositories to check their current state.',
        404,
      )
    return job
  }

  return { list, prepare, start, getJob, active: () => activeJob }
}
