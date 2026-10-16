# Repo Killr

A local app for searching, selecting, archiving, and deleting your GitHub repositories. Built with React and Vite, with a responsive repository grid, custom dropdowns, and custom confirmation popups.

## Requirements

- [Node.js](https://nodejs.org/) **22.12 or newer**, with npm.
- [Git](https://git-scm.com/).
- [GitHub CLI (`gh`)](https://cli.github.com/), installed on the computer running the app and available on its `PATH`.
- A GitHub account that owns the repositories you want to manage.

On macOS with Homebrew, you can install GitHub CLI with:

```sh
brew install gh
```

For Windows and Linux, follow the [GitHub CLI installation instructions](https://github.com/cli/cli#installation).

## Setup

### 1. Download and install

```sh
git clone https://github.com/jordanbkatz/repo-killr.git
cd repo-killr
npm ci
```

### 2. Connect GitHub through the CLI

Sign in to GitHub in your terminal:

```sh
gh auth login --hostname github.com --web
```

Complete the browser sign-in, then grant the permissions needed to access private repositories and delete repositories:

```sh
gh auth refresh --hostname github.com --scopes repo,delete_repo
```

- `repo` allows access to private repositories.
- `delete_repo` permits repository deletion. You must also have admin access to each repository.

Verify the connection and account:

```sh
gh auth status --hostname github.com
gh api --hostname github.com user --jq .login
```

Repo Killr uses this existing CLI connection automatically. You do not need to register an OAuth app, paste a token into the website, or create an `.env` file. Authentication is managed by GitHub CLI; Repo Killr does not return your GitHub token to the browser or save it in this project.

If you are already signed in, you can skip `gh auth login` and use `gh auth refresh` to add missing permissions. See the official [login](https://cli.github.com/manual/gh_auth_login) and [permission refresh](https://cli.github.com/manual/gh_auth_refresh) documentation.

### 3. Start the app

```sh
npm run dev
```

Open **[http://127.0.0.1:5180](http://127.0.0.1:5180)**.

Vite updates the browser automatically when you edit React components or CSS. The local GitHub API runs alongside Vite; keep the dev server running while using the app.

## How to use

1. **Find repositories.** Search by name, description, or language. Use the Public, Private, Archived, and Forks filters, or change the sort order.
2. **Select repositories.** Check individual cards or use **Select this page**. When a page is selected, you can also select all matching repositories. Selections are kept while searching, filtering, and moving between pages.
3. **Choose an action.** Open **Selected** in the sidebar, then choose **Archive** or **Delete** in the selection toolbar. The popup shows the exact repositories affected.
4. **Confirm the action.** Click **Confirm archive** or **Confirm delete** at the bottom of the popup. No typing or extra checkbox is required. Use **Cancel**, the close button, or Escape to dismiss the popup before confirming.
5. **Check the result.** Each repository gets a success or failure result. Failed repositories stay selected so you can review them. **Activity** shows archive and deletion results saved in this browser.

The archive and trash buttons on each card open action-specific confirmation popups. Selecting repositories or opening a popup does not change anything on GitHub.

**Archiving keeps the repository and its history, and makes it read-only.** Archived repositories stay in the grid with an Archived badge and are available through the Archived filter. Already archived repositories are excluded from archive batches. You can unarchive a repository later in GitHub settings. Archiving needs admin access and the `repo` scope; it does not need the `delete_repo` scope. Archive results appear in Activity alongside deletions.

**Deletion removes the repository and its associated code, issues, pull requests, releases, and settings from GitHub. There is no undo in Repo Killr. Local clones on your computer are not deleted.**

Use **Sync GitHub** to reload the repository list after changes on GitHub. Press `/` to focus search. Custom dropdowns support arrow keys, Home, End, Enter, and Escape.

Repository recency uses GitHub’s actual last-push timestamp (`pushed_at`), rather than metadata changes (`updated_at`). Cards and recency sorting use the same timestamp; hover over a card’s push date to see the exact date, time, and timezone. Relative labels refresh every minute. The repository data refreshes when the window regains focus and every five minutes while visible, unless a popup is open.

## Connection troubleshooting

### The app cannot find GitHub CLI

Check that `gh` is installed and available to the process running the server:

```sh
gh --version
```

If it works in your terminal but not in a process manager, restart that server with the correct `PATH`. On macOS or Linux, you can also supply the executable path explicitly:

```sh
GH_PATH=/absolute/path/to/gh npm run dev
```

### GitHub is disconnected or deletion is denied

Check the account and permissions:

```sh
gh auth status --hostname github.com
gh auth refresh --hostname github.com --scopes repo,delete_repo
```

Complete any browser authorization, then click **Sync GitHub**. Repository admin access is required even when the CLI has deletion permission. If the session has expired, run `gh auth login --hostname github.com --web` again.

### The wrong GitHub account is connected

If you have multiple accounts signed in:

```sh
gh auth switch --hostname github.com --user YOUR_USERNAME
```

Click **Sync GitHub** afterward. Existing `GH_TOKEN` or `GITHUB_TOKEN` environment variables can override stored CLI credentials; check the server's environment if the account is still unexpected. Never commit these tokens.

### Some repositories are missing

Only repositories owned by the active user are shown, including owned forks and archived repositories. Organization-owned repositories and repositories where you are only a collaborator are not included. Confirm the active account and `repo` permission to see private repositories.

### Port 5180 is already in use

Stop the other instance, or choose another port:

```sh
npm run dev -- --port 5182
```

Open the URL printed by Vite. The dev server uses a strict port to avoid silently switching to another port.

## Commands

| Command           | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `npm ci`          | Install the dependencies recorded in the lockfile.                   |
| `npm run dev`     | Run React, Vite, and the local GitHub API with hot updates.          |
| `npm test`        | Run mocked API and deletion tests; no real repositories are deleted. |
| `npm run build`   | Build the frontend into `dist/`.                                     |
| `npm run preview` | Serve the built frontend with the local GitHub API on port 5180.     |

Run `npm run build` before `npm run preview`, and stop the dev server first if it is using the same port.

If you use PM2 Manager, add the project folder with command `NODE_ENV=development npm run dev` and port `5180`. PM2 Manager is optional.

## How the connection works

The browser calls the local API defined in `server/api.mjs`. That API invokes `gh api` through `server/github.mjs`, using the active `github.com` CLI account. Repository pages are loaded from GitHub and searched, filtered, sorted, and paginated locally.

Each archive or deletion confirmation is tied to the reviewed selection, expires after five minutes, and can be used once. Before archiving or deleting, the server verifies the account, repository identities, ownership, and permissions. Batches run sequentially; authentication failures and rate limits stop the remaining batch. Reloading the page reconnects to a running batch while the server remains running.

The server binds to loopback, restricts hosts and origins, and requires a local session token for protected API requests. Activity is stored in browser local storage separately for each account; it contains repository names and outcomes, not credentials.

This is a local application. Uploading `dist/` to static hosting does not provide the local API or your GitHub CLI connection. GitHub Enterprise hosts are not currently supported.

## Project structure

```text
src/                React interface and styles
server/api.mjs      Local HTTP endpoints and request protection
server/github.mjs   GitHub CLI integration
server/service.mjs  Repository selection and deletion workflow
server/*.test.mjs   Mocked API and deletion tests
public/             Static assets
vite.config.js      React and local API integration
```

## License

[MIT](LICENSE) — Copyright (c) 2026 Jordan Katz.
