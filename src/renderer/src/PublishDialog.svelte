<script lang="ts">
  import { manifestAddArgs, manifestCommitArgs, publishCommitMessage } from '../../core/git'
  import type { Bump, Manifest } from '../../core/ipc'
  import { displayPath } from '../../core/paths'
  import { bumpVersion } from '../../core/tessl'
  import { api } from './api'
  import { publishVisibility } from './format'
  import Icon from './Icon.svelte'
  import Tip from './Tip.svelte'

  let {
    dialog = $bindable(),
    name,
    workspace,
    workspaces,
    manifest,
    folder,
    home,
    gitFound,
    busy,
    onpublish
  }: {
    dialog?: HTMLDialogElement
    name: string
    /** The default, preset each time the dialog opens. */
    workspace: string
    workspaces: string[]
    /** The skill's local Tessl manifest; null before the first publish. */
    manifest: Manifest | null
    /** The skill folder; the commit commands run there. */
    folder: string
    home: string
    gitFound: boolean
    busy: boolean
    onpublish: (bump: Bump, workspace: string, commit: boolean) => void
  } = $props()

  const id = $props.id()

  let bump = $state<Bump>('patch')
  /** The workspace the user picked in this open; null means the default. */
  let picked = $state<string | null>(null)
  const target = $derived(picked ?? workspace)
  let commit = $state(false)
  /** Whether the skill folder is in a git work tree; unknown (false) until `git-work-tree` answers. */
  let inside = $state(false)

  /** The commands as the user would type them in the skill folder: the arguments after `-C <folder>`. */
  function command(args: string[]): string {
    return ['git', ...args.slice(2).map((a) => (/[\s"()<>]/.test(a) ? `"${a}"` : a))].join(' ')
  }
  const visibility = $derived(publishVisibility(manifest, target))
  const commands = $derived([
    command(manifestAddArgs(folder)),
    command(manifestCommitArgs(folder, publishCommitMessage(name, '<new version>')))
  ])
</script>

<!-- autofocus on the dialog itself, so the workspace dropdown does not open with a focus ring. -->
<dialog
  class="cover"
  autofocus
  bind:this={dialog}
  ontoggle={(e) => {
    // Reset on close, not on open: `toggle` fires after `showModal()`, so a reset on open can wipe a choice made at once.
    if (e.newState === 'closed') {
      bump = 'patch'
      picked = null
      inside = false
      commit = false
    } else {
      const asked = name
      void api.invoke('git-work-tree', { skill: asked }).then((result) => {
        // A late answer for another skill, or after the dialog closed, is dropped.
        if (asked !== name || !dialog?.open) return
        inside = result.ok && result.inside
        commit = inside
      })
    }
  }}
>
  <div class="dialog-drag"></div>
  <div class="dialog-box">
    <h2 class="title">PUBLISH</h2>
    <p>
      {name}
      <span class="muted">to the Tessl workspace</span>
    </p>
    <!-- One label column, so every value starts at the same x and sits on its label's baseline. -->
    <div class="publish-grid">
      <span class="label" id={`publish-workspace-label-${id}`}>Workspace</span>
      <div>
        <button
          class="select"
          aria-labelledby={`publish-workspace-label-${id}`}
          aria-haspopup="menu"
          popovertarget={`publish-workspace-${id}`}
          style:anchor-name={`--publish-workspace-${id}`}
          ><span class="select-value">{target}</span><Icon name="chevron-down" size={12} /></button
        >
        <div
          popover
          id={`publish-workspace-${id}`}
          class="menu-pop float select-pop"
          role="menu"
          style:position-anchor={`--publish-workspace-${id}`}
        >
          {#each workspaces as option (option)}
            <button
              role="menuitemradio"
              aria-checked={option === target}
              popovertarget={`publish-workspace-${id}`}
              popovertargetaction="hide"
              onclick={() => (picked = option)}
              ><span class="select-value">{option}</span>{#if option === target}<Icon
                  name="check"
                  size={12}
                />{/if}</button
            >
          {/each}
        </div>
      </div>
      <span class="label">Visible to</span>
      <span class="publish-visibility" class:amber-text={visibility.isPublic}
        >{visibility.text}</span
      >
      <span class="label" id={`publish-bump-label-${id}`}>Version bump</span>
      <div class="seg segmented" role="radiogroup" aria-labelledby={`publish-bump-label-${id}`}>
        {#each ['patch', 'minor', 'major'] as const as option (option)}
          {@const next = manifest ? bumpVersion(manifest.version, option) : null}
          <Tip text={next ? `${manifest?.version} → ${next}` : ''}>
            <label>
              <input type="radio" name="bump" value={option} bind:group={bump} />
              {option}
            </label>
          </Tip>
        {/each}
      </div>
    </div>
    {#if gitFound && inside}
      <div class="commit-row">
        <label class="check-label">
          <input type="checkbox" bind:checked={commit} />
          <span class="label">Commit manifest</span>
        </label>
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <span
          class="tip"
          tabindex="0"
          aria-label="About Commit manifest"
          aria-describedby={`publish-commit-tip-${id}`}
          ><Icon name="info" size={12} /><span
            class="tip-text float"
            id={`publish-commit-tip-${id}`}
            role="tooltip"
            ><span
              >After a successful publish, Loadout commits the manifest only. Your other changes
              stay uncommitted, and Loadout never pushes.</span
            ><span>Loadout runs these commands in {displayPath(folder, home)}:</span
            >{#each commands as line (line)}<code>{line}</code>{/each}<span
              >Loadout skips them when the manifest did not change. The Log shows each command it
              runs.</span
            ></span
          ></span
        >
      </div>
    {/if}
    <div class="actions">
      <button onclick={() => dialog?.close()}>Cancel</button>
      <button
        class="primary"
        disabled={busy}
        onclick={() => {
          onpublish(bump, target, commit && gitFound && inside)
          dialog?.close()
        }}>Publish</button
      >
    </div>
  </div>
</dialog>
