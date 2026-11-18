import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, serializeConfig } from '../../src/core/config'

function script(path: string, body: string): void {
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

/** A temp home with one library skill, one broken Claude Code link and fake tools. */
export function fakeHome(): { home: string; env: Record<string, string> } {
  const home = mkdtempSync(join(tmpdir(), 'loadout-e2e-'))
  const loadout = join(home, '.loadout')
  const library = join(loadout, 'skills')
  const claude = join(home, '.claude', 'skills')
  const source = join(home, 'Code', 'Skills', 'probe')
  const bin = join(home, 'fakebin')
  const ghSource = join(loadout, 'repos', 'acme', 'tools', 'skills', 'probe-gh')
  for (const dir of [library, claude, source, ghSource, bin]) mkdirSync(dir, { recursive: true })

  const config = structuredClone(DEFAULT_CONFIG)
  config.agents[0].enabled = true
  config.tesslWorkspace = 'acme'
  writeFileSync(join(loadout, 'config.json'), serializeConfig(config))

  writeFileSync(
    join(source, 'SKILL.md'),
    [
      '---',
      'name: probe',
      'description: A probe skill.',
      '---',
      '# Probe',
      '',
      'A paragraph with **bold** text.',
      '',
      '- first item',
      '- second item',
      '',
      '```sh',
      'echo probe',
      '```',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '[docs](http://example.invalid/docs)',
      ''
    ].join('\n')
  )
  writeFileSync(
    join(ghSource, 'SKILL.md'),
    '---\nname: probe-gh\ndescription: A GitHub probe.\n---\n'
  )
  symlinkSync(source, join(library, 'probe'))
  symlinkSync(ghSource, join(library, 'probe-gh'))
  symlinkSync(join(library, 'probe'), join(claude, 'probe'))
  symlinkSync(join(home, 'missing', 'deep-research'), join(claude, 'deep-research'))

  script(join(bin, 'shell'), `case "$1" in -ilc|-lc) printf '%s' '${bin}' ;; esac`)
  // `git -C <clone> <command>…`: one case per command; add answers here. A clone path with
  // `broken` fails `fetch`, with `dirty` lists a local edit, with `slow` sleeps in `fetch`, with
  // `diverged` is one commit ahead of its upstream, with `noupstream` has no upstream, with `current`
  // is up to date, with `pullfail` fails `pull`, with `lagging` sleeps in `rev-list`. `pull` leaves a `.pulled` mark in the clone and
  // rewrites probe-gh's SKILL.md; after it the clone answers as one at `def5678`. The manifest status lists
  // `.tessl-plugin/plugin.json` until `commit` leaves a `.committed` mark beside it.
  script(
    join(bin, 'git'),
    `if [ "$1" = -C ]; then
  clone="$2"
  shift 2
  case "$1" in
    fetch)
      case "$clone" in *slow*) /bin/sleep 5 ;; esac
      case "$clone" in *broken*) echo "fatal: repository 'x' not found" >&2; exit 128 ;; esac ;;
    -c)
      if [ "$6" = .tessl-plugin/plugin.json ]; then
        if [ -f "$clone/.tessl-plugin/plugin.json" ] && [ ! -e "$clone/.tessl-plugin/.committed" ]; then
          echo '?? .tessl-plugin/plugin.json'
        fi
        exit 0
      fi
      case "$clone" in *dirty*) echo ' M SKILL.md' ;; esac ;;
    status) case "$clone" in *dirty*) echo ' M SKILL.md' ;; esac ;;
    add) ;;
    commit) : > "$clone/.tessl-plugin/.committed" ;;
    rev-list)
      case "$clone" in *lagging*) /bin/sleep 3 ;; esac
      if [ -e "$clone/.pulled" ]; then printf '0\\t0\\n'; exit 0; fi
      case "$clone" in
        *noupstream*) echo "fatal: no upstream configured for branch 'main'" >&2; exit 128 ;;
        *current*) printf '0\\t0\\n' ;;
        *diverged*) printf '1\\t2\\n' ;;
        *) printf '0\\t2\\n' ;;
      esac ;;
    rev-parse)
      case "$2 $3" in
        '--abbrev-ref @{u}') echo origin/main ;;
        --abbrev-ref*) echo main ;;
        --short*) if [ -e "$clone/.pulled" ]; then echo def5678; else echo abc1234; fi ;;
        --is-shallow-repository*) echo true ;;
        --show-toplevel*) cd "$clone" && pwd -P ;;
      esac ;;
    log)
      case "$3" in
        'HEAD..@{u}') printf 'def5678\\tSecond change\\nbcd2345\\tFirst change\\n' ;;
        --not) ;;
        *)
          if [ -e "$clone/.pulled" ]; then printf 'def5678\\t2026-11-07\\tSecond change\\n'; fi
          printf 'abc1234\\t2026-11-01\\tInitial\\n' ;;
      esac ;;
    diff)
      printf '%s\\n' '--- a/skills/probe-gh/SKILL.md' '+++ b/skills/probe-gh/SKILL.md' \\
        '@@ -3 +3 @@' '-description: A GitHub probe.' '+description: A better GitHub probe.' ;;
    pull)
      case "$clone" in *pullfail*) echo 'fatal: Not possible to fast-forward, aborting.' >&2; exit 1 ;; esac
      : > "$clone/.pulled"
      f="$clone/skills/probe-gh/SKILL.md"
      if [ -f "$f" ]; then
        printf '%s\\n' '---' 'name: probe-gh' 'description: A better GitHub probe.' '---' > "$f"
      fi
      echo Fast-forward ;;
  esac
else
  echo "git version 2.47.0"
fi`
  )
  // \`whoami\` appends its TESSL_AUTO_UPDATE_INTERVAL_MINUTES to \`tessl-whoami-env\`. When that is not 0
  // and \`tessl-update-to\` exists, it fakes an update: a start line in \`.tessl/auto-update.log\`, a
  // sleep of the seconds in \`tessl-update.sleep\` (default 3), then \`--version\` prints the new
  // version (\`tessl-version\`, else 0.119.0).
  script(
    join(bin, 'tessl'),
    `if [ "$1" = whoami ]; then
  echo "$TESSL_AUTO_UPDATE_INTERVAL_MINUTES" >> "${home}/tessl-whoami-env"
  if [ "$TESSL_AUTO_UPDATE_INTERVAL_MINUTES" != 0 ] && [ -f "${home}/tessl-update-to" ]; then
    /bin/mkdir -p "${home}/.tessl"
    echo '=== Auto-update started at fake ===' >> "${home}/.tessl/auto-update.log"
    if [ -f "${home}/tessl-update.sleep" ]; then /bin/sleep "$(/bin/cat "${home}/tessl-update.sleep")"; else /bin/sleep 3; fi
    /bin/cp "${home}/tessl-update-to" "${home}/tessl-version"
  fi
  if [ -n "$FAKE_WHOAMI_SLEEP" ]; then /bin/sleep "$FAKE_WHOAMI_SLEEP"; fi
  echo '{"authenticated":true,"method":"session","user":{"name":"acme-dev"}}'
elif [ "$*" = "workspace list --json" ]; then
  echo '{"workspaces":[{"id":"1","name":"acme","allowedActions":["plugin.publish"]},{"id":"2","name":"beta","allowedActions":[]}]}'
elif [ "$1 $2" = "search --json" ]; then
  # \`search --json --workspace <id> <name>\`: the tiles of that workspace.
  echo "$*" >> "${home}/tessl-args.log"
  if [ "$4" = 1 ]; then
    echo '{"results":[{"type":"tile","fullName":"acme/nokit","workspaceName":"acme","tileName":"nokit","description":"Docs only.","latestVersion":"0.1.0","content":{"hasSkills":false}},{"type":"tile","fullName":"acme/kit","workspaceName":"acme","tileName":"kit","description":"A kit.","latestVersion":"0.1.0","content":{"hasSkills":true}},{"type":"tile-skill","name":"probe-t","source":"acme/kit"}]}'
  else
    printf '%s\\n' '{"results":[{"type":"tile","fullName":"beta/other","workspaceName":"beta","tileName":"other","description":"Other.\\nSecond line.","latestVersion":null,"content":{"hasSkills":true}}]}'
  fi
elif [ "$1 $2" = "review run" ]; then
  if [ -f "${home}/review.json" ]; then /bin/cat "${home}/review.json"; else echo '{"review":{"reviewScore":90}}'; fi
elif [ "$1 $2" = "review fix" ]; then
  # The target is the third argument: append a line to SKILL.md and add a file in a new folder.
  printf 'Fixed line.\\n' >> "$3/SKILL.md"
  /bin/mkdir -p "$3/references"
  printf 'New reference.\\n' > "$3/references/new.md"
  # The shape of tests/fixtures/tessl/review-fix.json: no review, only the fix's own scores and files.
  echo '{"status":"completed","baselineScore":34,"finalScore":98,"applied":true,"files":{"modified":["SKILL.md"],"added":["references/new.md"],"deleted":[]}}'
elif [ "$1 $2" = "skill publish" ]; then
  # The target is the third argument: write the manifest at the bumped version.
  /bin/mkdir -p "$3/.tessl-plugin"
  echo '{"name":"acme/probe","version":"0.1.1"}' > "$3/.tessl-plugin/plugin.json"
elif [ "$1 $2" = "plugin unpublish" ]; then
  echo "$*" >> "${home}/tessl-args.log"
  if [ -f "${home}/unpublish.err" ]; then /bin/cat "${home}/unpublish.err" >&2; exit 1; fi
  if [ -f "${home}/unpublish.noop" ]; then exit 0; fi
  if [ -f "${home}/registry" ]; then
    v="\${4#*@}"
    /usr/bin/grep -v "^$v " "${home}/registry" > "${home}/registry.new"
    /bin/mv "${home}/registry.new" "${home}/registry"
  fi
elif [ "$1 $2" = "plugin info" ] && [ -f "${home}/registry" ]; then
  # The registry file: one line per version, oldest first, \`<version> live\` or \`<version> hidden\`.
  echo "$*" >> "${home}/tessl-args.log"
  if [ ! -s "${home}/registry" ]; then
    echo '✘ Could not find plugin "acme/probe".' >&2
    echo 'It may not exist, may be unpublished, or may be private to a workspace you are not a member of.' >&2
    exit 1
  fi
  case "$3" in
    *@*)
      v="\${3#*@}"
      if /usr/bin/grep -q "^$v " "${home}/registry"; then
        echo "{\\"tile\\":{\\"latestVersion\\":null},\\"version\\":{\\"version\\":\\"$v\\"}}"
      else
        echo "✘ Plugin \\"acme/probe\\" exists, but it has no version \\"$v\\"." >&2
        exit 1
      fi ;;
    *)
      v="$(/usr/bin/grep ' live$' "${home}/registry" | /usr/bin/tail -n 1 | /usr/bin/cut -d' ' -f1)"
      if [ -n "$v" ]; then
        echo "{\\"tile\\":{\\"fullName\\":\\"acme/probe\\",\\"latestVersion\\":\\"$v\\",\\"archived\\":false,\\"deprecated\\":false},\\"version\\":{\\"version\\":\\"$v\\",\\"createdAt\\":\\"2026-11-11T09:00:00.000Z\\"}}"
      elif [ -f "${home}/registry.archived" ]; then
        # A whole-plugin archive: no latest version (research memo, probe 12).
        echo '{"tile":{"fullName":"acme/probe","latestVersion":null,"archived":true,"archivedReason":"Old."},"version":null}'
      else
        echo '{"tile":{"fullName":"acme/probe","latestVersion":null,"archived":false},"version":null}'
      fi ;;
  esac
elif [ "$1 $2" = "plugin info" ]; then
  echo "$*" >> "${home}/tessl-args.log"
  # Answers from the fake home: stdout, stderr and the exit code of the lookup the test sets up.
  if [ -f "${home}/plugin-info.json" ]; then /bin/cat "${home}/plugin-info.json"; fi
  if [ -f "${home}/plugin-info.err" ]; then /bin/cat "${home}/plugin-info.err" >&2; fi
  if [ -f "${home}/plugin-info.code" ]; then exit "$(/bin/cat "${home}/plugin-info.code")"; fi
elif [ "$*" = "outdated --global --json" ]; then
  echo '${JSON.stringify({
    outdated: [
      {
        current: {
          tile: { workspaceName: 'acme', tileName: 'kit', version: '0.1.0' },
          source: { source: 'registry', tile: { workspaceName: 'acme', tileName: 'kit' } }
        },
        update: { version: '0.1.1' },
        latest: { version: '0.1.1' },
        isLatestPinned: false
      }
    ],
    upToDate: [],
    errors: []
  })}'
elif [ -f "${home}/tessl-version" ]; then
  /bin/cat "${home}/tessl-version"
else
  echo 0.119.0
fi`
  )
  script(join(bin, 'claude'), 'echo "2.1.0 (Claude Code)"')
  script(join(bin, 'codex'), 'echo "codex-cli 0.50.0"')
  // The app update check (LOADOUT_CURL): `latest-release` is the `-w` output, `.err` the stderr of a
  // failed run, `.sleep` seconds to wait first. With no file it fails as with no network. Every run
  // appends one line to `curl-calls`. With `-o <path>` (not the check's `/dev/null`) it is the update
  // download instead: it copies `release-headers` to the `-D` path, sleeps the seconds in
  // `download.sleep`, then prints `download.err` and exits 22 when that file exists, or copies
  // `release.dmg` to `<path>`; it appends `download` to `curl-calls`.
  script(
    join(bin, 'curl'),
    `out=''; hdr=''
for a in "$@"; do case "$prev" in -o) out=$a;; -D) hdr=$a;; esac; prev=$a; done
if [ -n "$out" ] && [ "$out" != /dev/null ]; then
  echo download >> "${home}/curl-calls"
  [ -f "${home}/release-headers" ] && /bin/cp "${home}/release-headers" "$hdr"
  if [ -f "${home}/download.sleep" ]; then /bin/sleep "$(/bin/cat "${home}/download.sleep")"; fi
  if [ -f "${home}/download.err" ]; then /bin/cat "${home}/download.err" >&2; exit 22; fi
  /bin/cp "${home}/release.dmg" "$out"; exit 0
fi
echo run >> "${home}/curl-calls"
if [ -f "${home}/latest-release.sleep" ]; then /bin/sleep "$(/bin/cat "${home}/latest-release.sleep")"; fi
if [ -f "${home}/latest-release.err" ]; then /bin/cat "${home}/latest-release.err" >&2; exit 6; fi
if [ -f "${home}/latest-release" ]; then /bin/cat "${home}/latest-release"; exit 0; fi
echo 'curl: (6) Could not resolve host: github.com' >&2; exit 6`
  )

  return {
    home,
    env: {
      HOME: home,
      SHELL: join(bin, 'shell'),
      PATH: '/usr/bin:/bin',
      LOADOUT_FALLBACK_DIRS: '',
      LOADOUT_CURL: join(bin, 'curl')
    }
  }
}
