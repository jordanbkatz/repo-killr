import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ApiError, githubApi, publicUser } from './github.mjs'
import { createRepoService } from './service.mjs'

export function createApiMiddleware({ service = createRepoService(), api = githubApi } = {}) {
  const sessionToken = randomBytes(32).toString('hex')
  const send = (res, status, payload) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end(JSON.stringify(payload))
  }

  return async (req, res, next) => {
    const path = req.url.split('?')[0]
    if (!path.startsWith('/api/')) return next()
    const host = req.headers.host || ''
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
      return send(res, 403, { error: 'Repo Killr is available on this computer only.' })
    if (
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)
    ) {
      return send(res, 403, { error: 'Cross-origin requests are not allowed.' })
    }
    try {
      if (req.method === 'GET' && path === '/api/health')
        return send(res, 200, { ok: true, app: 'Repo Killr' })
      if (req.method === 'GET' && path === '/api/session') {
        return send(res, 200, {
          user: publicUser(await api('user')),
          sessionToken,
          activeJob: service.active(),
        })
      }
      const supplied = Buffer.from(String(req.headers['x-repo-killr-token'] || ''))
      const expected = Buffer.from(sessionToken)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        throw new ApiError('Your local session expired. Refresh the page and try again.', 403)
      if (req.method === 'GET' && path === '/api/repositories')
        return send(res, 200, await service.list())
      const jobMatch = path.match(/^\/api\/deletions\/([a-f0-9-]+)$/)
      if (req.method === 'GET' && jobMatch) return send(res, 200, service.getJob(jobMatch[1]))
      if (req.method === 'POST') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json'))
          throw new ApiError('A JSON request is required.', 415)
        const chunks = []
        let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > 32_768) throw new ApiError('The request is too large.', 413)
          chunks.push(chunk)
        }
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString())
        } catch {
          throw new ApiError('The request could not be read.')
        }
        if (!body || typeof body !== 'object') throw new ApiError('A JSON object is required.')
        if (path === '/api/deletions/prepare')
          return send(res, 200, await service.prepare(body.repositoryIds))
        if (path === '/api/deletions/confirm') return send(res, 202, service.start(body.planId))
      }
      throw new ApiError('This endpoint does not exist.', 404)
    } catch (error) {
      send(res, error.status || 500, {
        error: error.status ? error.message : 'Something went wrong. Refresh and try again.',
      })
    }
  }
}

export function repoKillrApi() {
  const middleware = createApiMiddleware()
  return {
    name: 'repo-killr-local-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
