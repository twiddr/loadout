# Loadout

One place to manage agent skills for Claude Code and Codex on macOS. Loadout keeps a library of skills in `~/.loadout/skills`, one symlink per skill, and turns each skill on or off per agent by creating or removing one symlink in that agent's skills folder. Loadout never deletes a skill folder; it only adds and removes symlinks.

## Requirements

- A Mac with Apple silicon. The app is built for `arm64` only and does not run on an Intel Mac.
- `git`. Run `xcode-select --install` if you do not have it, or with Homebrew `brew install git`.
- Claude Code or Codex, or both:
  - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`, or with Homebrew `brew install --cask claude-code`; then `claude auth login`.
  - Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`, or with Homebrew `brew install --cask codex`; then `codex login`.
- Tessl, only for Recruit skill › Registry, Review, Fix and Publish: `curl -fsSL https://get.tessl.io | sh`, or with Homebrew `brew tap tesslio/tap`, `brew trust tesslio/tap`, `brew install tesslio/tap/tessl`; then `tessl login`.

Loadout reads your shell's `PATH` and also looks in `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`, so a launch from Finder finds tools installed by these installers. If you install a tool while Loadout is open, press Refresh (the icon in SYSTEMS).

## Install

Download page: <https://theloadout.dev/>

**The app is not notarised.** It is ad-hoc signed, not signed with an Apple Developer ID, and Apple has not notarised it. macOS blocks the first launch of a copy downloaded in a browser. A download with `curl` gets no quarantine flag, so macOS skips the Gatekeeper check for it: no notarisation check, no Developer ID check and no first-launch prompt. You trust this repository and GitHub's HTTPS, nothing more. To check a download, compare `shasum -a 256 ~/Downloads/Loadout.dmg` with the SHA-256 in the notes of the [release](https://github.com/twiddr/loadout/releases/latest); the download page shows it too.

1. In Terminal, run:

   ```bash
   curl -fL -o ~/Downloads/Loadout.dmg https://github.com/twiddr/loadout/releases/latest/download/Loadout.dmg
   ```

2. Open `Loadout.dmg` in your Downloads folder, drag Loadout to Applications, and eject the Loadout disk.
3. Start Loadout from `/Applications`.

### If you downloaded `Loadout.dmg` in a browser

1. Open `Loadout.dmg`, drag Loadout to Applications, and eject the Loadout disk.
2. Start Loadout. The first launch stops with **"Loadout.app" Not Opened** and only the buttons Done and Move to Bin. Press Done.
3. In Terminal, run:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Loadout.app
   ```

4. Start Loadout again.

On macOS 27.2, right-click › Open and Open Anyway in System Settings did not get past this message; the `xattr` command does.

## Updates

- At each start, Loadout checks GitHub once for a newer release: one `curl` request to `github.com`. While Loadout stays open, it checks again once a day at 12:00 local time, or when the Mac wakes between 12:00 and 18:00 after a missed 12:00, but never within 1 hour of another check and never in the evening or at night. It needs no account and stores nothing. A failed check writes one line to the Log and shows nothing else.
- `Loadout › Check for Updates…` checks on request and says when you have the latest release.
- When a newer release exists, the window corner shows the two versions and `UPDATE ›`, for example `0.1.4 → 0.1.5 UPDATE ›`. `UPDATE ›` opens the steps, which are the install steps above: download `Loadout.dmg` with `curl`, quit Loadout, drag Loadout to Applications and replace the old copy, eject the Loadout disk, then start Loadout.
- `UPDATE ›` opens a dialog. DOWNLOAD gets the new release, checks it and gets it ready. A progress line shows `DOWNLOADING <version>` and the percent, then `CHECKING <version>`. CANCEL stops the download. CLOSE hides the dialog and the download goes on; `UPDATE ›` shows it again.
- When the update is ready, the dialog shows `<version> IS READY` and RESTART. Loadout restarts only when you press RESTART. If a command is running, RESTART says `Another command is running.` and Loadout stays open; press it again when the command has ended. A normal quit installs nothing.
- If Loadout cannot write its own folder, the dialog offers no DOWNLOAD and opens the steps under INSTALL BY HAND ›. The same happens when an update fails: the dialog shows the reason and opens the steps, and TRY AGAIN starts the download again.

## First steps

1. Start Loadout. BOOT CAMP opens at the first launch, when no agent is enlisted. It checks the agents, git and Tessl. The Briefing, five cards that explain the ideas behind Loadout, opens over it; SKIP BRIEFING or Esc closes it, and the `?` button in the rail opens it again.
2. Enlist Claude Code, Codex or both with the ENLIST switch. If a tool is missing, its row shows the install command with COPY and OPEN TERMINAL. Run the command, then press CHECK AGAIN.
3. Press GO TO RECON. The button appears once one agent is enlisted. The Recon page lists the skills that are already in your agent folders (step 6). With no such skill, the button is GO TO LOADOUT.
4. On the Loadout page, add a skill with Recruit skill. Link takes a GitHub repository such as `anthropics/skills`, Folder takes a folder that holds a `SKILL.md`, and Registry takes `workspace/plugin`, typed or picked from the field's dropdown, which lists the plugins of the chosen Tessl workspace. Then switch an agent toggle on. Loadout links `~/.claude/skills/<name>` (or `~/.codex/skills/<name>`) to `~/.loadout/skills/<name>`. Switch it off to remove the link.
5. Tessl is optional. To use it, run `tessl login` in Terminal, then choose the default workspace in Settings.
6. The Recon page lists what was in your agent folders before Loadout. To put one of these skills under Loadout's toggles, press RECRUIT on its row; Loadout changes nothing there until you do.

## What the app shows

The rail on the left has five pages: BOOT CAMP, Loadout, Intel, Recon and Log. The back button on a mouse returns to the page you saw before.

- **BOOT CAMP:** the first-launch guide, also open from the rail. It checks the agents, git and Tessl, shows the command for anything missing, and leads to the Loadout page.
- **Loadout:** one card per skill, sorted by name, with a search box and the filter chips All, Folder, Link, Registry and Stowed. A card shows the source (Folder is `local`, a folder of your own edited in place; Link is `github`, a clone under `~/.loadout/repos`; Registry is `tessl`, a plugin under `~/.tessl/plugins`), one toggle per enabled agent, and the `⋯` menu. A stowed card is a skill that no agent uses. A card for a skill whose folder is gone shows MISSING; a card for a library entry that is not a symlink shows NOT A LINK.
- **Packs:** the `SKILLS | PACKS` button at the end of the filter row switches to the packed view, and Loadout remembers the choice. There, a Link or Registry source with two or more skills shows as one pack card. Its agent box deploys every skill of the pack to that agent, or stows them all when all are deployed; lines in the box mean that some are deployed. The pack's `⋯` menu has Check source, Update, Reveal in Finder and Remove (Remove takes every skill of the pack out of your loadout; the clone or plugin folder stays on disk). Click a pack to see its skills as normal cards; `‹ PACKS` or the mouse Back button returns to the grid. A search, or the Stowed chip, shows every skill as its own card.
- **Card menu (`⋯`):** Check (looks for an update to the skill's source; Link and Registry only), Update (pulls the clone or reinstalls the plugin, for every skill from that source), Tessl review (`tessl` review score), Tessl fix (one improve-and-review round, which costs 100 credits times the model multiplier; Folder only), Tessl publish (Folder only), Tessl unpublish (Folder skills with a Tessl manifest), Fork (see [Fork a skill](#fork-a-skill)), Reveal in Finder, Remove (removes the agent links and the library link; the skill folder stays on disk).
- **Skill page:** click a card to open it. It shows the rendered `SKILL.md` (Briefing), the Diff of a pending update and the commit History for a Link skill, the agents the skill is deployed to, its spec and its files. Decommission skill removes it.
- **Tessl status:** a Folder skill with a Tessl manifest (`.tessl-plugin/plugin.json`) shows a `package` mark beside its rank chevron; the tooltip names the plugin (`<workspace>/<plugin>`) and the manifest version. When you edit the skill after its last publish, the mark turns amber and pulses, and the tooltip says `Changed since publish`: a file in the folder is newer than the manifest, which Tessl rewrites at every publish. Publish the skill to clear it (an edit you undo still counts until the next publish). The skill page then shows an amber strip, `Files changed after version <version> was published.`, with PUBLISH; hover the sentence to see which files. Its skill page has a TESSL card: PLUGIN, MANIFEST, REGISTRY, VISIBLE, OPEN IN REGISTRY (the plugin's registry page in your browser) and SHARE (copies a message for a colleague with the registry link and the install line). A Registry skill's page has the same card, read from the installed plugin, with INSTALLED in place of MANIFEST and none of the publish strips below. The refresh button beside REGISTRY runs `tessl plugin info` and shows the published date and version. When the versions differ, a strip says which copy is behind: folder ahead offers PUBLISH; registry ahead asks you to bring the newer copy into the folder first. Other states: PENDING (Tessl still checks a new version), NOT FOUND, ARCHIVED, DEPRECATED and CHECK FAILED (with Tessl's message, for example when you are logged out). Loadout looks up the registry only from the refresh button, after a Publish and during a Tessl unpublish, stores nothing, and forgets the result when it quits.
- **Tessl publish:** the dialog offers the workspace, the bump (patch, minor, major) and, only when the skill folder is in a git work tree, COMMIT MANIFEST, which commits the manifest and nothing else. The result reads `published <version>`, and Loadout then checks the registry. If Tessl still checks the new version, REGISTRY shows PENDING, and Loadout checks again 20, 40 and 60 seconds later.
- **Tessl unpublish:** the card `⋯` menu and the ACTIONS menu on the skill page offer it for a Folder skill with a Tessl manifest. The dialog names the plugin and runs nothing until you press Unpublish; the job then removes every version of the plugin it can find. Tessl says unpublished versions "are completely removed and cannot be recovered", so this cannot be undone. A colleague who installed the plugin keeps a working copy but cannot update or reinstall it. When every version is gone, Loadout deletes the Tessl manifest (`.tessl-plugin/plugin.json`, and the folder when it is empty), so the skill no longer shows as published; in a git folder you commit that deletion yourself. A new Publish starts the plugin again at version 0.1.0. The result reads `unpublished <versions>`. A version Loadout cannot find, and Archive (`tessl plugin archive --plugin <workspace>/<plugin> --reason <text>`), are steps for the `tessl` CLI.
- **Platoon panel:** the enabled agents, the SYSTEMS list and the Recon count.
- **Appearance:** Loadout starts dark. The sun or moon button at the bottom of the rail switches between light and dark; Settings also offers System, which follows macOS. Loadout keeps the choice in `~/.loadout/config.json`.
- **Settings** (the gear at the bottom of the rail, or `+ Enlist agent`): the agents, your Tessl account and workspaces, the appearance, the tools Loadout found with their paths and versions (Refresh checks again), and the folders Loadout uses, each with Reveal in Finder.
- **Intel:** the sources with an update. Check all looks for updates, and Update all applies every update that is ready.
- **Recon:** links and folders in an agent's skills folder that Loadout did not make, and problems with skills in your loadout. RECRUIT on a row shows every step first, then adds the skill to your loadout, switches it on for that agent and moves your original, unchanged, to `~/.loadout/backups/<agent>/<name>`; MOVE TO BACKUP does the move alone for a link whose target is gone. The BACKUPS section lists the originals: REVEAL opens one in Finder and UNDO moves it back to the agent folder. Loadout never deletes an original or a backup; remove a backup in Finder when you no longer need it. Rescan reads the folders again.
- **Log:** the output of every `git` and `tessl` run. While a command runs, a bar shows the command and Cancel, which stops it. A failed filter shows only failed runs, the copy button on a run puts its command and output on the clipboard, and Clear empties the list.

## Update checks

- A check runs only when you press Check on a skill or Check all on the Intel page. Loadout never checks skills in the background.
- Results last until Loadout quits.
- A clone with local edits or rewritten history shows BLOCKED, and Loadout does not update it.

## Skills Loadout does not manage

- **Plugin skills** (Claude Code `/plugin`, Codex `/plugins`) live in the plugin folders, not in the agent skills folders. The agent's plugin manager installs, updates and removes them; Loadout does not show them.
- **`~/.claude/skills/synced`** is the claude.ai skill sync. Claude Code loads those skills as `anthropic-skills:<name>`, whatever the Loadout toggles say. Recon lists them under the `synced` row, read-only, and marks each name that is also in your loadout `IN LOADOUT`. A skill in your loadout that is also synced carries a cloud icon on its card and a CLAUDE.AI card on its skill page, which says whether the two copies are the same. Loadout shows the `"skillOverrides"` and `"syncClaudeAiSkills": false` lines to copy into `~/.claude/settings.json`; it never writes that file. Change the synced skills themselves on claude.ai.
- **A skill that runs a CLI** (for example `human-review`, `extract-design`) needs that CLI on your machine; Loadout does not check or install it. If the skill runs `npx <cli>`, a global install pins the version `npx` runs, so update it with the skill or leave it out. Do not run a vendor's setup command (such as `npx human-review setup --global`) for a skill Loadout manages: it writes through Loadout's links into the clone. Or let the CLI install the skill instead of Loadout (for example `human-review setup --global`): it then shows on the Recon page, and you update it with the CLI. Delete any copy it writes into `~/.agents/skills`, because Codex would load it twice.

## Fork a skill

Fix and Publish work on Folder skills (`local`) only. To change a Link (`github`) or Registry (`tessl`) skill, or to make any skill your own under a new name, fork it:

1. Open the `⋯` menu on the card (or ACTIONS on the skill page) and choose Fork.
2. Type the new name and press Choose folder…. Pick the parent folder. The copy goes to `<parent folder>/<new name>`, and Loadout adds it as a Folder skill.
3. The agents that had the original on switch to the fork. The original stays in your loadout and on disk, switched off for those agents.

The copy leaves out `.git`, `node_modules`, `__pycache__` and `.DS_Store` at any depth, and the Tessl files `.tessl-plugin/`, `tile.json` and `tessl-package.json` at the folder root, so a Publish of the fork makes a new plugin. Fork changes only the `name` line in the frontmatter of the copy's `SKILL.md`. The result lists every other line that names the original; edit those by hand where they should name the fork. A saved review or fix does not carry over.

Fork has no undo. To take a fork back, remove it in Loadout and delete its folder by hand, then switch the original on again.

A fork of a skill in a subfolder of a GitHub repository leaves out the repository's `LICENSE`. Check the licence before you publish someone else's skill.

## Where Loadout keeps things

- `~/.loadout/config.json`: the agents, the Tessl workspaces and the appearance.
- `~/.loadout/skills`: the library, one symlink per skill.
- `~/.loadout/repos`: the clones made by Recruit skill › Link.
- `~/.tessl/plugins`: the plugins Tessl installs for Recruit skill › Registry.

## Run from source

Needs Node.js and pnpm.

```bash
pnpm install
pnpm dev
```

If Electron does not start after `pnpm install`, run `node node_modules/electron/install.js` once.

## Checks

```bash
pnpm test        # Vitest
pnpm test:e2e    # Playwright smoke test, builds first
pnpm typecheck
pnpm lint
```

## Package

```bash
pnpm package     # ad-hoc signed .app and dist/Loadout.dmg
```

`pnpm package` gives `dist/mac-arm64/Loadout.app`, ad-hoc signed and about 300 MB, and packs it into `dist/Loadout.dmg`, about 130 MB, with the drag-to-Applications window.

## Licence

Loadout is under the MIT licence; see [`LICENSE`](LICENSE). The bundled fonts and icons keep their own licences; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Contributions

Loadout is open source, but not open to contributions: pull requests are turned off. Bug reports are welcome as [Issues](https://github.com/twiddr/loadout/issues). To change Loadout for yourself, fork it; the licence allows that. Report a security problem privately, as [`SECURITY.md`](SECURITY.md) describes.

## Trademarks

Loadout is an independent project. It is not affiliated with, endorsed by or sponsored by Anthropic (Claude Code, claude.ai), OpenAI (Codex), Tessl, OpenCode, GitHub or Homebrew. Their names appear here only to say which tools Loadout works with.
