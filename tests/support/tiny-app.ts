import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { plistString } from '../../src/core/release'

function run(file: string, args: string[]): void {
  const result = spawnSync(file, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed: ${result.stderr || result.error?.message}`)
  }
}

/**
 * A tiny signed `Loadout.app` (or `options.name`) in `dir`: an `Info.plist` and a `/bin/sh` executable that appends
 * `started <version> <args>` to `marker`. Synchronous, so a synchronous fixture can call it.
 */
export function tinyApp(
  dir: string,
  options: { version: string; id?: string; executable?: string; marker: string; name?: string }
): string {
  const { version, marker } = options
  const id = options.id ?? 'com.twiddr.loadout'
  const executable = options.executable ?? 'Loadout'
  const app = join(dir, options.name ?? 'Loadout.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${executable}</string>
  <key>CFBundleIdentifier</key>
  <string>${id}</string>
  <key>CFBundleName</key>
  <string>Loadout</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
</dict>
</plist>
`
  writeFileSync(join(app, 'Contents', 'Info.plist'), plist)
  const script = join(app, 'Contents', 'MacOS', executable)
  writeFileSync(script, `#!/bin/sh\necho "started ${version} $*" >> '${marker}'\n`)
  chmodSync(script, 0o755)
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app])
  return app
}

/** A compressed DMG at `out` that holds the folder of `app`, named `Loadout <version>`. */
export function tinyDmg(app: string, out: string): string {
  const version = plistString(
    readFileSync(join(app, 'Contents', 'Info.plist'), 'utf8'),
    'CFBundleShortVersionString'
  )
  run('/usr/bin/hdiutil', [
    'create',
    '-srcfolder',
    dirname(app),
    '-format',
    'UDZO',
    '-volname',
    `Loadout ${version}`,
    '-quiet',
    out
  ])
  return out
}
