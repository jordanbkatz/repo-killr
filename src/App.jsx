import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dropdown from './Dropdown.jsx'
import {
  compareRepositoryRecency,
  exactTime,
  relativeTime,
  repositoryPushTime,
} from './repositoryDates.js'
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  Archive,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FolderGit2,
  GitFork,
  Globe2,
  HelpCircle,
  History,
  Loader2,
  LockKeyhole,
  Menu,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from 'lucide-react'

const PAGE_SIZE = 12
const formatSize = (kb = 0) =>
  kb < 1024
    ? `${kb.toLocaleString()} KB`
    : kb < 1_048_576
      ? `${(kb / 1024).toFixed(1)} MB`
      : `${(kb / 1_048_576).toFixed(1)} GB`
const readHistory = (id) => {
  try {
    const entries = JSON.parse(localStorage.getItem(`repo-killr:activity:${id}`) || '[]')
    return Array.isArray(entries)
      ? entries.filter(
          (entry) => entry && typeof entry.fullName === 'string' && typeof entry.at === 'string',
        )
      : []
  } catch {
    return []
  }
}

function Github({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.105.77-.244.77-.542 0-.267-.01-.975-.015-1.913-3.13.68-3.79-1.51-3.79-1.51-.512-1.302-1.25-1.65-1.25-1.65-1.023-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.722 2.638 1.224 3.28.936.102-.727.393-1.224.715-1.505-2.499-.284-5.126-1.249-5.126-5.563 0-1.23.44-2.234 1.16-3.022-.116-.285-.503-1.43.11-2.981 0 0 .945-.303 3.094 1.155a10.78 10.78 0 0 1 5.626 0c2.149-1.458 3.094-1.155 3.094-1.155.613 1.55.226 2.696.111 2.98.722.79 1.158 1.793 1.158 3.023 0 4.325-2.632 5.275-5.14 5.553.404.35.766 1.04.766 2.096 0 1.514-.014 2.735-.014 3.107 0 .3.202.652.774.541A11.25 11.25 0 0 0 12 .75Z" />
    </svg>
  )
}

function Brand({ compact = false }) {
  return (
    <span className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-mark">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <path
            d="M9 7v18m0-9h7c6 0 9-3 9-9M16 16l9 9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="25" cy="7" r="2" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span>
          repo killr<span className="brand-dot">.</span>
        </span>
      )}
    </span>
  )
}

function Checkbox({ checked, mixed, label, onChange, disabled = false }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(mixed)
  }, [mixed])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="checkbox"
      checked={checked}
      aria-label={label}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

function Modal({ children, onClose, busy = false, className = '', labelledBy }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="dialog-inner">{children}</div>
    </dialog>
  )
}

function HelpModal({ onClose }) {
  return (
    <Modal onClose={onClose} labelledBy="help-title" className="help-dialog">
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Close help">
        <X size={19} />
      </button>
      <span className="dialog-icon blue">
        <HelpCircle size={25} />
      </span>
      <h2 id="help-title">How it works</h2>
      <div className="help-steps">
        <div>
          <span>01</span>
          <section>
            <h3>Search repositories</h3>
            <p>
              Search names and descriptions, or filter by visibility, forks, and archived repos.
            </p>
          </section>
        </div>
        <div>
          <span>02</span>
          <section>
            <h3>Select repositories</h3>
            <p>
              Select individual repos or a whole page. Your selection stays with you as you search
              and switch pages.
            </p>
          </section>
        </div>
        <div>
          <span>03</span>
          <section>
            <h3>Archive or delete</h3>
            <p>
              Choose Archive to keep a read-only repository, or Delete to remove it. Review the
              popup, then click its confirmation button.
            </p>
          </section>
        </div>
      </div>
      <div className="help-note">
        <ShieldCheck size={19} />
        <p>
          Connected through your local GitHub CLI. Credentials stay on your computer. Only
          repositories you own are shown.
        </p>
      </div>
      <button className="button dark full-width" onClick={onClose}>
        Got it <ArrowRight size={16} />
      </button>
    </Modal>
  )
}

function RepositoryActionModal({
  repositories,
  resumeJobId,
  api,
  onClose,
  onComplete,
  action = 'delete',
}) {
  const [plan, setPlan] = useState(null)
  const [preparing, setPreparing] = useState(!resumeJobId)
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState(
    resumeJobId ? { id: resumeJobId, phase: 'validating', results: [], total: 0 } : null,
  )
  const [error, setError] = useState('')
  const finished = useRef(false)
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete
  const busy = submitting || Boolean(job && job.phase !== 'complete')
  const isArchive = (job?.action || action) === 'archive'
  const completedWord = isArchive ? 'archived' : 'deleted'
  const endpoint = action === 'archive' ? 'archives' : 'deletions'
  const succeeded = job?.results.filter((result) => result.status === completedWord) || []
  const failed = job?.results.filter((result) => result.status === 'failed') || []

  useEffect(() => {
    if (resumeJobId) return
    let cancelled = false
    api(`/api/${endpoint}/prepare`, {
      method: 'POST',
      body: { repositoryIds: repositories.map((repo) => repo.id) },
    })
      .then((data) => {
        if (!cancelled) setPlan(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
      .finally(() => {
        if (!cancelled) setPreparing(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, repositories, resumeJobId, endpoint])

  useEffect(() => {
    if (!job?.id) return
    let cancelled = false
    let timer
    async function poll() {
      try {
        const data = await api(`/api/${endpoint}/${job.id}`)
        if (cancelled) return
        setJob(data)
        setError('')
        if (data.phase === 'complete') {
          if (!finished.current) {
            finished.current = true
            completeRef.current(data)
          }
          return
        }
      } catch (err) {
        if (cancelled) return
        if (err.status === 404) {
          setJob((current) => ({ ...current, phase: 'complete', error: err.message }))
          setError(err.message)
          return
        }
        setError('Connection interrupted. Checking the action status again…')
      }
      if (!cancelled) timer = window.setTimeout(poll, 1200)
    }
    poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [job?.id, api, endpoint])

  async function confirm() {
    if (!plan || preparing || busy) return
    setSubmitting(true)
    setError('')
    try {
      setJob(await api(`/api/${endpoint}/confirm`, { method: 'POST', body: { planId: plan.id } }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (job)
    return (
      <Modal onClose={onClose} busy={busy} labelledBy="action-title" className="delete-dialog">
        {!busy && (
          <button className="icon-button dialog-close" onClick={onClose} aria-label="Close results">
            <X size={19} />
          </button>
        )}
        <span
          className={`dialog-icon ${busy ? 'blue' : failed.length || job.error ? 'red' : 'blue'}`}
        >
          {busy ? (
            <Loader2 size={26} className="spin" />
          ) : failed.length || job.error ? (
            <CircleAlert size={26} />
          ) : (
            <CheckCheck size={26} />
          )}
        </span>
        <h2 id="action-title">
          {busy
            ? job.phase === 'validating'
              ? 'Verifying repositories…'
              : isArchive
                ? 'Archiving repositories…'
                : 'Deleting repositories…'
            : job.error
              ? 'Cleanup needs attention.'
              : failed.length
                ? `Some repositories were not ${completedWord}.`
                : isArchive
                  ? 'Archive complete.'
                  : 'Deletion complete.'}
        </h2>
        <p className="dialog-description">
          {busy
            ? 'Keep this window open. We’re checking each repository and processing your selection.'
            : `${succeeded.length} ${succeeded.length === 1 ? 'repository' : 'repositories'} ${completedWord}${failed.length ? ` · ${failed.length} not ${completedWord}` : ''}. Your repository list has been updated.`}
        </p>
        {busy && (
          <div className="progress-section">
            <div className="progress-track">
              <span
                style={{ width: `${job.total ? (job.results.length / job.total) * 100 : 0}%` }}
              />
            </div>
            <div className="progress-label">
              <span>
                {job.phase === 'validating'
                  ? 'Verifying ownership and permissions'
                  : job.current || 'Processing repositories'}
              </span>
              <b>
                {job.results.length} / {job.total || '…'}
              </b>
            </div>
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        {job.error && !error && (
          <div className="inline-error" role="alert">
            <CircleAlert size={17} />
            {job.error}
          </div>
        )}
        {job.results.length > 0 && (
          <div className="result-list">
            {job.results.map((result) => (
              <div key={result.id}>
                <span className={result.status !== 'failed' ? 'result-success' : 'result-failure'}>
                  {result.status !== 'failed' ? (
                    <CircleCheck size={18} />
                  ) : (
                    <CircleAlert size={18} />
                  )}
                </span>
                <section>
                  <strong>{result.fullName}</strong>
                  {result.message && <p>{result.message}</p>}
                </section>
                <span className="result-status">
                  {result.status === 'failed'
                    ? `Not ${completedWord}`
                    : isArchive
                      ? 'Archived'
                      : 'Deleted'}
                </span>
              </div>
            ))}
          </div>
        )}
        {!busy && (
          <button className="button dark full-width" onClick={onClose}>
            Back to repositories <ArrowRight size={16} />
          </button>
        )}
      </Modal>
    )

  return (
    <Modal onClose={onClose} busy={busy} labelledBy="action-title" className="delete-dialog">
      <button
        className="icon-button dialog-close"
        onClick={onClose}
        disabled={busy}
        aria-label={`Cancel ${isArchive ? 'archiving' : 'deletion'}`}
      >
        <X size={19} />
      </button>
      <span className={`dialog-icon ${isArchive ? 'blue' : 'red'}`}>
        {isArchive ? <Archive size={25} /> : <Trash2 size={25} />}
      </span>
      <h2 id="action-title">{isArchive ? 'Archive repositories?' : 'Delete repositories?'}</h2>
      <p className="dialog-description">
        {isArchive ? 'You’re about to archive ' : 'You’re about to permanently delete '}
        <strong>
          {repositories.length} {repositories.length === 1 ? 'repository' : 'repositories'}
        </strong>{' '}
        {isArchive ? 'on' : 'from'} GitHub. Review your selection before continuing.
      </p>
      <div className="review-list">
        {(plan?.repositories || repositories).map((repo) => (
          <div key={repo.id}>
            <FolderGit2 size={18} />
            <section>
              <strong>{repo.fullName}</strong>
              <span>
                {repo.private ? 'Private' : 'Public'}
                {repo.archived ? ' · Archived' : ''}
                {repo.fork ? ' · Fork' : ''}
              </span>
            </section>
            <span>{formatSize(repo.size)}</span>
          </div>
        ))}
      </div>
      <div className={isArchive ? 'archive-note' : 'danger-note'}>
        {isArchive ? <Archive size={18} /> : <CircleAlert size={18} />}
        <p>
          {isArchive
            ? 'Archiving makes repositories read-only and keeps their code and history. You can unarchive them later in GitHub settings.'
            : 'This deletes the code, issues, pull requests, releases, and repository settings. There’s no undo in Repo Killr.'}
        </p>
      </div>
      {preparing && (
        <p className="checking">
          <Loader2 size={16} className="spin" /> Checking your selection with GitHub…
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          <CircleAlert size={17} />
          {error}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={`button ${isArchive ? 'dark' : 'danger'}`}
          onClick={confirm}
          disabled={!plan || preparing || busy}
        >
          {submitting ? (
            <Loader2 size={16} className="spin" />
          ) : isArchive ? (
            <Archive size={16} />
          ) : (
            <Trash2 size={16} />
          )}
          {isArchive ? 'Confirm archive' : 'Confirm delete'}
        </button>
      </div>
    </Modal>
  )
}

function RepositoryCard({ repo, checked, onSelect, onReview, onArchive, now }) {
  return (
    <article className={`repo-card ${checked ? 'is-selected' : ''}`}>
      <div className="card-top">
        <span className="visibility-badge">
          {repo.private ? <LockKeyhole size={16} /> : <Globe2 size={16} />}
          {repo.private ? 'Private' : 'Public'}
        </span>
        <label className="card-select">
          <Checkbox
            checked={checked}
            label={`Select ${repo.name}`}
            disabled={!repo.canDelete}
            onChange={onSelect}
          />
        </label>
      </div>
      <a className="repo-name" href={repo.url} target="_blank" rel="noreferrer">
        <span>{repo.name}</span>
        <ArrowUpRight size={16} />
      </a>
      <p className="repo-description">{repo.description || ''}</p>
      {(repo.archived || repo.fork || !repo.canDelete) && (
        <div className="card-badges">
          {repo.archived && (
            <span className="mini-badge">
              <Archive size={14} />
              Archived
            </span>
          )}
          {repo.fork && (
            <span className="mini-badge">
              <GitFork size={14} />
              Fork
            </span>
          )}
          {!repo.canDelete && <span className="mini-badge">Read only</span>}
        </div>
      )}
      <div className="card-footer">
        <div className="card-details">
          {repo.language && (
            <span>
              <span className="language-dot" />
              {repo.language}
            </span>
          )}
          {repo.stars > 0 && (
            <span>
              <Star size={14} />
              {repo.stars}
            </span>
          )}
          <span>{formatSize(repo.size)}</span>
          {repositoryPushTime(repo) !== null ? (
            <time dateTime={repo.pushedAt} title={`Last code push: ${exactTime(repo.pushedAt)}`}>
              Pushed {relativeTime(repo.pushedAt, now).toLowerCase()}
            </time>
          ) : (
            <span>Push date unavailable</span>
          )}
        </div>
        <div className="card-actions">
          <button
            className="icon-button row-archive"
            onClick={onArchive}
            aria-label={`Archive ${repo.name}`}
            disabled={!repo.canArchive}
            title={
              repo.archived
                ? 'Already archived'
                : repo.canArchive
                  ? `Archive ${repo.name}`
                  : 'You do not have admin access'
            }
          >
            <Archive size={18} />
          </button>
          <button
            className="icon-button row-delete"
            onClick={onReview}
            aria-label={`Delete ${repo.name}`}
            disabled={!repo.canDelete}
            title={
              repo.canDelete ? `Review deletion of ${repo.name}` : 'You do not have admin access'
            }
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </article>
  )
}

function EmptyState({ kind, onReset }) {
  const selected = kind === 'selected'
  return (
    <div className="empty-state">
      <span>
        <Search size={28} strokeWidth={1.5} />
      </span>
      <h3>{selected ? 'No repositories selected.' : 'No repositories found.'}</h3>
      <p>
        {selected
          ? 'Select repositories to review them here.'
          : 'Try another search or clear your filters.'}
      </p>
      <button className="button secondary" onClick={onReset}>
        {selected ? 'Browse repositories' : 'Clear search & filters'}
        <ArrowRight size={15} />
      </button>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [repositories, setRepositories] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('updated')
  const [view, setView] = useState('repositories')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [syncedAt, setSyncedAt] = useState(null)
  const [modal, setModal] = useState(null)
  const [mobileNav, setMobileNav] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [history, setHistory] = useState([])
  const [toast, setToast] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const token = useRef('')
  const currentUser = useRef(null)
  const searchRef = useRef(null)
  const loadingRef = useRef(false)

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(path, {
      method: options.method || 'GET',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Repo-Killr-Token': token.current },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    })
    const data = await response.json()
    if (!response.ok) {
      const err = new Error(data.error || 'Something went wrong. Please try again.')
      err.status = response.status
      throw err
    }
    return data
  }, [])

  const loadRepositories = useCallback(
    async (refresh = false) => {
      if (loadingRef.current) return
      loadingRef.current = true
      refresh ? setRefreshing(true) : setLoading(true)
      setError('')
      try {
        const session = await api('/api/session')
        token.current = session.sessionToken
        if (currentUser.current !== session.user.id) {
          currentUser.current = session.user.id
          setSelected(new Set())
          setHistory(readHistory(session.user.id))
          setRepositories([])
        }
        setUser(session.user)
        const data = await api('/api/repositories')
        setRepositories(data.repositories)
        setSyncedAt(data.syncedAt)
        setSelected(
          (previous) =>
            new Set(
              [...previous].filter((id) =>
                data.repositories.some((repo) => repo.id === id && repo.canDelete),
              ),
            ),
        )
        if (session.activeJob)
          setModal(
            (previous) =>
              previous || { type: 'action', repositories: [], resumeJobId: session.activeJob },
          )
      } catch (err) {
        setError(err.message)
      } finally {
        loadingRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    },
    [api],
  )

  useEffect(() => {
    loadRepositories()
  }, [loadRepositories])
  useEffect(() => {
    const updateClock = () => setNow(Date.now())
    const timer = window.setInterval(updateClock, 60_000)
    document.addEventListener('visibilitychange', updateClock)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', updateClock)
    }
  }, [])
  useEffect(() => {
    const sync = () => {
      if (!modal && document.visibilityState === 'visible') loadRepositories(true)
    }
    const timer = window.setInterval(sync, 5 * 60_000)
    window.addEventListener('focus', sync)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', sync)
    }
  }, [loadRepositories, modal])
  useEffect(() => {
    setPage(1)
  }, [query, filter, sort, view])
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const changed = () => {
      setIsMobile(media.matches)
      if (!media.matches) setMobileNav(false)
    }
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => {
    if (!mobileNav) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.querySelector('.main-nav button')?.focus()
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setMobileNav(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      document.querySelector('.mobile-menu')?.focus()
    }
  }, [mobileNav])
  useEffect(() => {
    const handler = (event) => {
      if (
        event.key === '/' &&
        !modal &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modal])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const counts = useMemo(
    () => ({
      all: repositories.length,
      public: repositories.filter((repo) => !repo.private).length,
      private: repositories.filter((repo) => repo.private).length,
      archived: repositories.filter((repo) => repo.archived).length,
      forks: repositories.filter((repo) => repo.fork).length,
    }),
    [repositories],
  )
  const filtered = useMemo(
    () =>
      repositories
        .filter((repo) => {
          const matchView = view !== 'selected' || selected.has(repo.id)
          const matchQuery = `${repo.fullName} ${repo.description || ''} ${repo.language || ''}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
          const matchFilter =
            filter === 'all' ||
            (filter === 'public' && !repo.private) ||
            (filter === 'private' && repo.private) ||
            (filter === 'archived' && repo.archived) ||
            (filter === 'forks' && repo.fork)
          return matchView && matchQuery && matchFilter
        })
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'oldest'
              ? compareRepositoryRecency(a, b, true)
              : sort === 'size'
                ? b.size - a.size
                : compareRepositoryRecency(a, b),
        ),
    [repositories, selected, query, filter, sort, view],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRepos = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selectablePage = pageRepos.filter((repo) => repo.canDelete)
  const allPageSelected =
    selectablePage.length > 0 && selectablePage.every((repo) => selected.has(repo.id))
  const somePageSelected = selectablePage.some((repo) => selected.has(repo.id))
  const selectedRepos = repositories.filter((repo) => selected.has(repo.id))
  const archiveRepos = selectedRepos.filter((repo) => repo.canArchive)
  const selectedSize = selectedRepos.reduce((total, repo) => total + repo.size, 0)
  const hiddenSelected = selectedRepos.filter(
    (repo) => !filtered.some((item) => item.id === repo.id),
  ).length
  const navigate = (next) => {
    setView(next)
    setMobileNav(false)
    setQuery('')
    setFilter('all')
  }
  const toggleRepo = (id) =>
    setSelected((previous) => {
      const next = new Set(previous)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const togglePage = () =>
    setSelected((previous) => {
      const next = new Set(previous)
      for (const repo of selectablePage) allPageSelected ? next.delete(repo.id) : next.add(repo.id)
      return next
    })
  const selectMatching = () => {
    const available = filtered.filter((repo) => repo.canDelete)
    if (available.length > 500) {
      setToast('You can review up to 500 repositories in one cleanup. Narrow your search first.')
      return
    }
    setSelected((previous) => new Set([...previous, ...available.map((repo) => repo.id)]))
  }
  const review = (repos, action = 'delete') => {
    if (repos.length > 500) {
      setToast('Please select 500 or fewer repositories for each cleanup.')
      return
    }
    if (!repos.length) return
    setModal({ type: 'action', action, repositories: repos })
  }

  const handleComplete = useCallback((job) => {
    const deleted = new Set(
      job.results.filter((result) => result.status === 'deleted').map((result) => result.id),
    )
    const archived = new Set(
      job.results.filter((result) => result.status === 'archived').map((result) => result.id),
    )
    setRepositories((previous) =>
      previous
        .filter((repo) => !deleted.has(repo.id))
        .map((repo) =>
          archived.has(repo.id) ? { ...repo, archived: true, canArchive: false } : repo,
        ),
    )
    setSelected(
      (previous) => new Set([...previous].filter((id) => !deleted.has(id) && !archived.has(id))),
    )
    const previous = readHistory(job.userId)
    const entries = job.results.map((result) => ({
      ...result,
      action: job.action || 'delete',
      jobId: job.id,
      at: new Date(job.finishedAt).toISOString(),
    }))
    const next = [...entries, ...previous.filter((entry) => entry.jobId !== job.id)].slice(0, 500)
    try {
      localStorage.setItem(`repo-killr:activity:${job.userId}`, JSON.stringify(next))
    } catch {
      /* Activity is optional when browser storage is unavailable. */
    }
    if (currentUser.current === job.userId) setHistory(next)
    const count = deleted.size + archived.size
    if (count)
      setToast(
        `${count} ${count === 1 ? 'repository' : 'repositories'} ${job.action === 'archive' ? 'archived' : 'deleted'}.`,
      )
  }, [])

  const pageLabel =
    view === 'selected'
      ? 'Selected repositories'
      : view === 'activity'
        ? 'Activity'
        : 'Repositories'

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={`sidebar ${mobileNav ? 'open' : ''}`}
        inert={isMobile && !mobileNav ? true : undefined}
        aria-hidden={isMobile && !mobileNav ? true : undefined}
      >
        <a
          className="brand-link"
          href="#"
          aria-label="Repo Killr home"
          onClick={(event) => {
            event.preventDefault()
            navigate('repositories')
          }}
        >
          <Brand />
        </a>
        <div className="workspace-label">Workspace</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={view === 'repositories' ? 'active' : ''}
            onClick={() => navigate('repositories')}
          >
            <FolderGit2 size={19} />
            <span>Repositories</span>
            <b>{counts.all}</b>
          </button>
          <button
            className={view === 'selected' ? 'active' : ''}
            onClick={() => navigate('selected')}
          >
            <CheckCheck size={19} />
            <span>Selected</span>
            {selected.size > 0 && <b>{selected.size}</b>}
          </button>
          <button
            className={view === 'activity' ? 'active' : ''}
            onClick={() => navigate('activity')}
          >
            <History size={19} />
            <span>Activity</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button
            className="help-link"
            onClick={() => {
              setMobileNav(false)
              setModal({ type: 'help' })
            }}
          >
            <HelpCircle size={18} /> How it works <ArrowUpRight size={15} />
          </button>
          <div className="sidebar-account">
            <span className="avatar">
              {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <Github size={20} />}
            </span>
            <div>
              <strong>{user?.name || user?.login || 'Your workspace'}</strong>
              <span>{user ? `@${user.login}` : 'Connect your GitHub'}</span>
            </div>
            <span
              className={`connection-dot ${user && !error ? 'connected' : ''}`}
              title={user && !error ? 'GitHub connected' : 'Connection needs attention'}
            />
          </div>
        </div>
      </aside>

      <div className="main-shell" inert={isMobile && mobileNav ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <span className="mobile-wordmark">
              repo killr<span className="brand-dot">.</span>
            </span>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageLabel}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection-label ${user && !error ? '' : 'disconnected'}`}>
              <span />
              {loading
                ? 'Connecting to GitHub'
                : user && !error
                  ? 'GitHub connected'
                  : 'Connection needs attention'}
            </span>
            <span className="topbar-divider" />
            <a
              className="github-link"
              href={user?.url || 'https://github.com'}
              target="_blank"
              rel="noreferrer"
              aria-label="Open your GitHub profile"
            >
              <Github size={20} />
            </a>
          </div>
        </header>

        <main>
          <section className="repository-section">
            <div className="section-heading">
              <div>
                <h1>
                  {view === 'activity'
                    ? 'Activity'
                    : view === 'selected'
                      ? 'Selected repositories'
                      : 'Repositories'}
                  <span className="count-pill">
                    {view === 'activity'
                      ? history.length
                      : view === 'selected'
                        ? selected.size
                        : counts.all}
                  </span>
                </h1>
              </div>
              <button
                className="button secondary refresh-button"
                onClick={() => loadRepositories(true)}
                disabled={loading || refreshing}
              >
                <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
                <span>{refreshing ? 'Syncing…' : 'Sync GitHub'}</span>
              </button>
            </div>

            {error && (
              <div className="connection-error" role="alert">
                <CircleAlert size={20} />
                <div>
                  <strong>Let’s reconnect to GitHub.</strong>
                  <p>{error}</p>
                  <span>
                    If needed, run <code>gh auth login</code> in your terminal.
                  </span>
                </div>
                <button
                  className="button secondary"
                  onClick={() => loadRepositories(true)}
                  disabled={refreshing}
                >
                  Try again
                </button>
              </div>
            )}

            {view === 'activity' ? (
              <div className="activity-panel">
                {history.length ? (
                  history.map((entry, index) => (
                    <div className="activity-row" key={`${entry.jobId}-${entry.id}-${index}`}>
                      <span
                        className={`activity-icon ${entry.status !== 'failed' ? '' : 'failed'}`}
                      >
                        {entry.status === 'archived' ? (
                          <Archive size={18} />
                        ) : entry.status === 'deleted' ? (
                          <Trash2 size={18} />
                        ) : (
                          <CircleAlert size={18} />
                        )}
                      </span>
                      <div>
                        <strong>{entry.fullName}</strong>
                        <p>
                          {entry.status === 'deleted'
                            ? 'Repository permanently deleted'
                            : entry.status === 'archived'
                              ? 'Repository archived'
                              : entry.message}
                        </p>
                      </div>
                      <span className={`status-pill ${entry.status}`}>
                        {entry.status === 'archived'
                          ? 'Archived'
                          : entry.status === 'deleted'
                            ? 'Deleted'
                            : entry.action === 'archive'
                              ? 'Not archived'
                              : 'Not deleted'}
                      </span>
                      <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>
                        {relativeTime(entry.at, now)}
                      </time>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <span>
                      <History size={29} strokeWidth={1.5} />
                    </span>
                    <h3>No activity yet.</h3>
                    <p>Archive and deletion results will appear here.</p>
                    <button className="button secondary" onClick={() => navigate('repositories')}>
                      Browse repositories <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="repository-controls">
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      ref={searchRef}
                      aria-label="Search repositories"
                      placeholder="Search repositories…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setQuery('')
                      }}
                    />
                    {query ? (
                      <button
                        className="icon-button"
                        onClick={() => {
                          setQuery('')
                          searchRef.current?.focus()
                        }}
                        aria-label="Clear search"
                      >
                        <X size={15} />
                      </button>
                    ) : (
                      <kbd>/</kbd>
                    )}
                  </div>
                  <div className="control-right">
                    <Dropdown
                      label="Sort repositories"
                      value={sort}
                      onChange={setSort}
                      icon={<ArrowDownWideNarrow size={16} />}
                      options={[
                        { value: 'updated', label: 'Recently pushed' },
                        { value: 'oldest', label: 'Least recently pushed' },
                        { value: 'name', label: 'Name: A to Z' },
                        { value: 'size', label: 'Largest first' },
                      ]}
                    />
                  </div>
                </div>
                <div className="filter-row">
                  <div className="filter-tabs" aria-label="Filter repositories">
                    {[
                      { id: 'all', label: 'All repos' },
                      { id: 'public', label: 'Public' },
                      { id: 'private', label: 'Private' },
                      { id: 'archived', label: 'Archived' },
                      { id: 'forks', label: 'Forks' },
                    ].map((tab) => (
                      <button
                        className={filter === tab.id ? 'active' : ''}
                        key={tab.id}
                        onClick={() => setFilter(tab.id)}
                        aria-pressed={filter === tab.id}
                      >
                        {tab.label}
                        <span>{counts[tab.id]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {loading ? (
                  <div className="loading-panel" role="status">
                    <Loader2 size={25} className="spin" />
                    <strong>Loading repositories…</strong>
                  </div>
                ) : !pageRepos.length ? (
                  <div className="repository-empty">
                    <EmptyState
                      kind={view === 'selected' && !selected.size ? 'selected' : 'search'}
                      onReset={() => {
                        setQuery('')
                        setFilter('all')
                        if (view === 'selected' && !selected.size) setView('repositories')
                      }}
                    />
                  </div>
                ) : (
                  <div className="repository-container">
                    <div className="grid-selection">
                      <label>
                        <Checkbox
                          checked={allPageSelected}
                          mixed={!allPageSelected && somePageSelected}
                          label="Select all repositories on this page"
                          onChange={togglePage}
                          disabled={!selectablePage.length}
                        />
                        <span>Select this page</span>
                      </label>
                      <span>
                        {filtered.length} {filtered.length === 1 ? 'repository' : 'repositories'}
                      </span>
                    </div>
                    {allPageSelected &&
                      filtered
                        .filter((repo) => repo.canDelete)
                        .some((repo) => !selected.has(repo.id)) && (
                        <div className="select-all-notice">
                          <span>{selectablePage.length} repos on this page selected.</span>
                          <button onClick={selectMatching}>
                            Select all {filtered.filter((repo) => repo.canDelete).length} matching
                            repos <ArrowRight size={13} />
                          </button>
                        </div>
                      )}
                    <div className="repo-items">
                      {pageRepos.map((repo) => (
                        <RepositoryCard
                          key={repo.id}
                          repo={repo}
                          checked={selected.has(repo.id)}
                          onSelect={() => toggleRepo(repo.id)}
                          onReview={() => review([repo])}
                          onArchive={() => review([repo], 'archive')}
                          now={now}
                        />
                      ))}
                    </div>
                    <div className="table-footer">
                      <span>
                        Showing{' '}
                        <strong>
                          {(currentPage - 1) * PAGE_SIZE + 1}–
                          {Math.min(currentPage * PAGE_SIZE, filtered.length)}
                        </strong>{' '}
                        of <strong>{filtered.length}</strong> repositories
                      </span>
                      <div className="pagination">
                        <button
                          className="icon-button"
                          aria-label="Previous page"
                          onClick={() => setPage(currentPage - 1)}
                          disabled={currentPage === 1}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>
                          Page <b>{currentPage}</b> of {pageCount}
                        </span>
                        <button
                          className="icon-button"
                          aria-label="Next page"
                          onClick={() => setPage(currentPage + 1)}
                          disabled={currentPage === pageCount}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          <footer className="page-footer">
            <span>
              {syncedAt
                ? `Last synced ${new Date(syncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </span>
          </footer>
        </main>
      </div>

      {selected.size > 0 && view !== 'activity' && (
        <div className="selection-toolbar" role="region" aria-label="Selected repository actions">
          <span className="selection-check">
            <CheckCheck size={19} />
          </span>
          <div className="selection-summary">
            <strong>
              {selected.size} {selected.size === 1 ? 'repository' : 'repositories'} selected
            </strong>
            <span>
              {formatSize(selectedSize)} of repository data
              {hiddenSelected > 0 ? ` · ${hiddenSelected} hidden by filters` : ''}
            </span>
          </div>
          <button className="clear-selection" onClick={() => setSelected(new Set())}>
            Clear<span className="clear-long"> selection</span>
          </button>
          <span className="selection-divider" />
          <button
            className="button selection-archive"
            onClick={() => review(archiveRepos, 'archive')}
            disabled={!archiveRepos.length}
            title={
              archiveRepos.length
                ? 'Review repositories to archive'
                : 'Selected repositories are already archived'
            }
          >
            <Archive size={16} />
            Archive {archiveRepos.length}
          </button>
          <button className="button selection-delete" onClick={() => review(selectedRepos)}>
            <Trash2 size={16} />
            <span>Delete {selected.size}</span>
          </button>
        </div>
      )}
      {toast && (
        <div
          className={`toast ${selected.size > 0 && view !== 'activity' ? 'above-selection' : ''}`}
          role="status"
        >
          <CircleCheck size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
      {modal?.type === 'action' && (
        <RepositoryActionModal
          repositories={modal.repositories}
          action={modal.action}
          resumeJobId={modal.resumeJobId}
          api={api}
          onComplete={handleComplete}
          onClose={() => {
            setModal(null)
            loadRepositories(true)
          }}
        />
      )}
    </div>
  )
}
