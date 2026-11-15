// Version logic for the app update notice. Pure: the renderer imports it at runtime, so no `node:` import.

import type { AppUpdate } from './ipc'

export const LATEST_URL = 'https://github.com/twiddr/loadout/releases/latest'

export const INSTALL_COMMAND =
  'curl -fL -o ~/Downloads/Loadout.dmg https://github.com/twiddr/loadout/releases/latest/download/Loadout.dmg'

export function releaseNotesUrl(version: string): string {
  return `https://github.com/twiddr/loadout/releases/tag/v${version}`
}

export function parseVersion(text: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) throw new Error(`Cannot compare versions "${a}" and "${b}".`)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

/** `latest` when it is strictly higher than `current`, else null. Null too when either side does not parse. */
export function newerRelease(current: string, latest: string): string | null {
  if (!parseVersion(current) || !parseVersion(latest)) return null
  return compareVersions(latest, current) > 0 ? latest : null
}

export type Latest = { ok: true; version: string } | { ok: false; message: string }

const REDIRECTS = new Set(['301', '302', '303', '307', '308'])
const TAG_URL = /^https:\/\/github\.com\/twiddr\/loadout\/releases\/tag\/v(\d+\.\d+\.\d+)$/

/** Reads curl `-w '%{http_code} %{redirect_url}'` output from the `/releases/latest` request. */
export function parseLatest(output: string): Latest {
  const text = output.trim()
  const space = text.indexOf(' ')
  const code = space === -1 ? text : text.slice(0, space)
  const url = space === -1 ? '' : text.slice(space + 1).trim()
  const version = REDIRECTS.has(code) ? TAG_URL.exec(url)?.[1] : undefined
  if (version && parseVersion(version)) return { ok: true, version }
  return {
    ok: false,
    message: `GitHub did not point at a release tag (${url || code || 'no answer'}).`
  }
}

export const BUNDLE_ID = 'com.twiddr.loadout'

/** The tagged DMG of one release, never `latest`. */
export function downloadUrl(version: string): string {
  return `https://github.com/twiddr/loadout/releases/download/v${version}/Loadout.dmg`
}

/** The `<string>` value that follows `<key>key</key>` in an XML property list, or null. */
export function plistString(xml: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`).exec(xml)
  return match ? match[1] : null
}

/** The `content-length` of the last response in a `curl -D` header dump, or null. */
export function contentLength(headers: string): number | null {
  const blocks = headers.split(/\r?\n\r?\n/).filter((block) => block.trim() !== '')
  const last = blocks[blocks.length - 1] ?? ''
  const match = /^content-length:\s*(\d+)\s*$/im.exec(last)
  return match ? Number(match[1]) : null
}

/**
 * A newer release found while an update may be in progress. No update yet: a fresh one. Stage
 * `downloading`, `checking` or `ready`: unchanged. Stage `offered` or `failed`: `latest` replaced.
 */
export function mergeAppUpdate(
  current: AppUpdate | null,
  latest: string,
  fresh: () => Omit<AppUpdate, 'latest'>
): AppUpdate {
  if (!current) return { latest, ...fresh() }
  if (current.stage === 'offered' || current.stage === 'failed') return { ...current, latest }
  return current
}

/**
 * The swap script, run as `/bin/sh swap.sh <bundle> <new> <old-dir> <executable> [args...]`.
 * It waits for its stdin pipe to close (the app has exited), swaps the bundle with two `mv`, and
 * starts the new app, or the old one after a failure. Its log is `swap.log` beside it.
 */
export const SWAP_SCRIPT = `bundle=$1
new=$2
old_dir=$3
executable=$4
shift 4
exec >>"\${0%/*}/swap.log" 2>&1
start() { "$bundle/Contents/MacOS/$executable" "$@" </dev/null >/dev/null 2>&1 & }
read -r _
/bin/mv "$bundle" "$old_dir/"
code=$?
if [ "$code" -ne 0 ]; then
  echo "FAILED move-old $code"
  start "$@"
  exit 0
fi
source=$new
if [ "$LOADOUT_UPDATE_FAIL" = swap ]; then source="$new.missing"; fi
/bin/mv "$source" "$bundle"
code=$?
if [ "$code" -ne 0 ]; then
  echo "FAILED move-new $code"
  /bin/mv "$old_dir/\${bundle##*/}" "$bundle"
  code=$?
  if [ "$code" -eq 0 ]; then echo RESTORED; else echo "FAILED restore $code"; fi
  start "$@"
  exit 0
fi
echo DONE
start "$@"
`

/** The noon check never runs within this gap after another app update check. */
export const NOON_GAP_MS = 60 * 60 * 1000

/** The noon check runs from 12:00 to before this hour, local time; never in the evening or at night. */
export const NOON_END_HOUR = 18

/** The most recent 12:00 local time at or before `now`. */
export function lastNoon(now: Date): Date {
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  if (noon > now) noon.setDate(noon.getDate() - 1)
  return noon
}

/** The first 12:00 local time after `now`. */
export function nextNoon(now: Date): Date {
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  if (noon <= now) noon.setDate(noon.getDate() + 1)
  return noon
}

/**
 * The daily check at 12:00 (ADR `20261114-app-update-noon-check`): due from 12:00 to before
 * `NOON_END_HOUR` when the last app update check started before today's 12:00 and at least
 * `NOON_GAP_MS` ago. Whether an update is already known is main's test.
 */
export function noonDue(now: Date, last: Date): boolean {
  const hour = now.getHours()
  return (
    hour >= 12 &&
    hour < NOON_END_HOUR &&
    last < lastNoon(now) &&
    now.getTime() - last.getTime() >= NOON_GAP_MS
  )
}
