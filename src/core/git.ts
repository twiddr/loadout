export interface Repo {
  owner: string
  repo: string
}

export const REPO_INPUT_MESSAGE =
  'Enter a GitHub repository as https://github.com/owner/repo or owner/repo.'

const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]*$/
const REPO = /^[A-Za-z0-9._-]+$/

/** Lower-cased: GitHub names ignore case, and so do macOS folders, so one repository gets one clone and one source key. */
function toRepo(owner: string, name: string): Repo | null {
  const repo = name.endsWith('.git') ? name.slice(0, -4) : name
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === '.' || repo === '..') return null
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase() }
}

/** Trimmed input. Accepts `owner/repo` and `https://github.com/owner/repo` with an optional `.git`, trailing path, query or fragment. Null for anything else. */
export function parseRepo(input: string): Repo | null {
  const text = input.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null
    const [owner, name] = url.pathname.split('/').slice(1)
    return owner && name ? toRepo(owner, name) : null
  }
  const parts = text.split('/')
  return parts.length === 2 ? toRepo(parts[0], parts[1]) : null
}

/** `https://github.com/<owner>/<repo>.git` */
export function githubUrl(repo: Repo): string {
  return `https://github.com/${repo.owner}/${repo.repo}.git`
}

export function cloneArgs(url: string, dest: string): string[] {
  return ['clone', '--depth', '1', url, dest]
}

export function statusArgs(clone: string): string[] {
  return [
    '-C',
    clone,
    '-c',
    'core.quotePath=false',
    'status',
    '--porcelain',
    '--untracked-files=no'
  ]
}

/** The Tessl manifest, relative to the skill folder. */
export const MANIFEST = '.tessl-plugin/plugin.json'

/** The manifest only. An untracked manifest counts, because the first publish writes a new one. */
export function manifestStatusArgs(folder: string): string[] {
  return ['-C', folder, '-c', 'core.quotePath=false', 'status', '--porcelain', '--', MANIFEST]
}

/** Needed before the commit: a path-limited commit refuses a path that git does not track yet. */
export function manifestAddArgs(folder: string): string[] {
  return ['-C', folder, 'add', '--', MANIFEST]
}

/** A path-limited commit: it holds the manifest only, whatever else is staged or edited. */
export function manifestCommitArgs(folder: string, message: string): string[] {
  return ['-C', folder, 'commit', '-m', message, '--', MANIFEST]
}

/** The version is null when Loadout cannot read it from the manifest. */
export function publishCommitMessage(skill: string, version: string | null): string {
  return `chore(${skill}): publish ${version ?? 'to Tessl'}`
}

/** True only when the status run exited 0 and listed at least one path. */
export function manifestUncommitted(code: number | null, stdout: string): boolean {
  return code === 0 && parsePorcelain(stdout).length > 0
}

export function pullArgs(clone: string): string[] {
  return ['-C', clone, 'pull', '--ff-only']
}

/** File paths from `git status --porcelain` v1 output: the new path of a rename, surrounding double quotes removed. Empty output gives []. */
export function parsePorcelain(stdout: string): string[] {
  const files: string[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    let path = line.slice(3)
    const arrow = path.indexOf(' -> ')
    if (arrow !== -1) path = path.slice(arrow + 4)
    if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
    files.push(path)
  }
  return files
}

export function dirtyMessage(clone: string, files: string[]): string {
  return `The clone has local edits; update refused. Files: ${files.join(', ')}. Commit or discard them in ${clone} first.`
}

export function branchArgs(clone: string): string[] {
  return ['-C', clone, 'rev-parse', '--abbrev-ref', 'HEAD']
}

export function headArgs(clone: string): string[] {
  return ['-C', clone, 'rev-parse', '--short', 'HEAD']
}

export function shallowArgs(clone: string): string[] {
  return ['-C', clone, 'rev-parse', '--is-shallow-repository']
}

/** The last 30 commits that touch `subpath` (the whole clone when it is empty). */
export function historyArgs(clone: string, subpath: string): string[] {
  return ['-C', clone, 'log', '--format=%h%x09%as%x09%s', '-n', '30', '--', subpath || '.']
}

/** Lines of `<hash>\t<date>\t<subject>`; a tab in the subject stays in the subject. */
export function parseHistory(stdout: string): { hash: string; date: string; subject: string }[] {
  const commits: { hash: string; date: string; subject: string }[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [hash, date, ...rest] = line.split('\t')
    commits.push({ hash, date, subject: rest.join('\t') })
  }
  return commits
}

export function fetchArgs(clone: string): string[] {
  return ['-C', clone, 'fetch']
}

/** Prints `<ahead>\t<behind>`; the left/right count also catches a rewritten remote history. */
export function aheadBehindArgs(clone: string): string[] {
  return ['-C', clone, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']
}

export function upstreamArgs(clone: string): string[] {
  return ['-C', clone, 'rev-parse', '--abbrev-ref', '@{u}']
}

/** The commits the upstream has and HEAD has not, newest first. */
export function incomingArgs(clone: string): string[] {
  return ['-C', clone, 'log', '--format=%h%x09%s', 'HEAD..@{u}']
}

/** The incoming change to `subpath` (the whole clone when it is empty). */
export function diffArgs(clone: string, subpath: string): string[] {
  return ['-C', clone, 'diff', 'HEAD..@{u}', '--', subpath || '.']
}

/** `<ahead>\t<behind>` from `rev-list --left-right --count`; null for anything else. */
export function parseAheadBehind(stdout: string): { ahead: number; behind: number } | null {
  const match = /^(\d+)\t(\d+)$/.exec(stdout.trim())
  return match ? { ahead: Number(match[1]), behind: Number(match[2]) } : null
}

/** Lines of `<hash>\t<subject>`; a tab in the subject stays in the subject. */
export function parseCommits(stdout: string): { hash: string; subject: string }[] {
  const commits: { hash: string; subject: string }[] = []
  for (const line of stdout.split('\n')) {
    if (!line) continue
    const [hash, ...rest] = line.split('\t')
    commits.push({ hash, subject: rest.join('\t') })
  }
  return commits
}

export function divergedMessage(clone: string, upstream: string): string {
  return `The clone has commits that are not on ${upstream}; update refused. Fix it with git in ${clone} first.`
}

/** The work tree that `git -C <clone>` uses; a folder with no `.git` of its own answers with a parent repository. */
export function toplevelArgs(clone: string): string[] {
  return ['-C', clone, 'rev-parse', '--show-toplevel']
}

/** Every file git does not have as committed: changed, untracked and ignored. */
export function localFilesArgs(clone: string): string[] {
  return ['-C', clone, 'status', '--porcelain', '--ignored', '--untracked-files=all']
}

/** A commit on no remote branch: a local branch ahead, a stash or a local tag. */
export function localCommitsArgs(clone: string): string[] {
  return ['-C', clone, 'log', '--all', '--not', '--remotes', '--oneline', '-n', '1']
}

type Read = { code: number | null; stdout: string } | null

/**
 * Why an unused clone at the real path `real` stays, from the three reads above; null when it can be
 * deleted. A read that is null (no git) or fails keeps the clone.
 */
export function cloneKeepReason(
  real: string,
  top: Read,
  files: Read,
  commits: Read
): string | null {
  if (top === null || files === null || commits === null) {
    return 'Loadout found no git to check it for local changes'
  }
  if (top.code !== 0 || top.stdout.trim() !== real) return 'it is not a git repository of its own'
  if (files.code !== 0 || commits.code !== 0) return 'git could not check it for local changes'
  const first = files.stdout.split('\n').find((line) => line.trim() !== '')
  if (first !== undefined) {
    return `it holds files that git does not have as committed, such as ${first.slice(3)}`
  }
  if (commits.stdout.trim() !== '') return 'it holds commits that are on no remote'
  return null
}
