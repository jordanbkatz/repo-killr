import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

// gh reads its existing OS-keychain credentials. No token enters this app's files or browser.
export async function githubApi(path, { method = 'GET', paginate = false } = {}) {
  const args = [
    'api',
    '--hostname',
    'github.com',
    '--method',
    method,
    path,
    '-H',
    'Accept: application/vnd.github+json',
    '-H',
    'X-GitHub-Api-Version: 2022-11-28',
  ]
  if (paginate) args.push('--paginate', '--slurp')
  try {
    const { stdout } = await execute(process.env.GH_PATH || 'gh', args, {
      timeout: paginate ? 120_000 : 30_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_HOST: 'github.com' },
    })
    return stdout.trim() ? JSON.parse(stdout) : null
  } catch (error) {
    const detail = String(error.stderr || '')
    if (error.code === 'ENOENT')
      throw new ApiError(
        'GitHub CLI was not found. Install it, then run gh auth login in your terminal.',
        503,
      )
    if (/HTTP 429|rate limit|secondary rate/i.test(detail))
      throw new ApiError(
        'GitHub’s request limit was reached. Wait a few minutes before trying again.',
        429,
      )
    if (/HTTP 401|gh auth login|not logged/i.test(detail))
      throw new ApiError(
        'Your GitHub session needs attention. Run gh auth login in your terminal, then reconnect.',
        401,
      )
    if (/HTTP 403/.test(detail))
      throw new ApiError(
        'GitHub denied this request. Deletion requires repository admin access and the delete_repo scope. Run gh auth refresh -h github.com -s delete_repo if needed.',
        403,
      )
    if (/HTTP 404/.test(detail))
      throw new ApiError('This repository no longer exists or is no longer accessible.', 404)
    if (error.killed || error.code === 'ETIMEDOUT')
      throw new ApiError('GitHub took too long to respond. Refresh and try again.', 504)
    // Never return CLI stderr: it may contain local paths or authentication information.
    throw new ApiError(
      'Could not reach GitHub. Check your connection and GitHub CLI sign-in, then try again.',
      502,
    )
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    url: user.html_url,
  }
}

export function publicRepo(repo) {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    ownerId: repo.owner.id,
    description: repo.description,
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    language: repo.language,
    size: repo.size,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    createdAt: repo.created_at,
    url: repo.html_url,
    canDelete: repo.permissions?.admin === true && !repo.disabled,
  }
}
