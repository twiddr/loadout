<script lang="ts">
  import type { Entry, State } from '../../core/ipc'
  import { boxClickOn, packBox, type Pack } from '../../core/packs'
  import { openPack, togglePack } from './actions'
  import { agentCode, isRunning, pointsToLog } from './format'
  import Icon from './Icon.svelte'
  import PackMenu from './PackMenu.svelte'
  import Tip from './Tip.svelte'
  import { app } from './state.svelte'

  let { pack, members, state: lib }: { pack: Pack; members: Entry[]; state: State } = $props()

  const agents = $derived(lib.agents.filter((a) => a.enabled))
  const deployed = $derived(members.filter((m) => m.enabledFor.length > 0).length)
  const stowed = $derived(deployed === 0)
  const ready = $derived(lib.checks[pack.key]?.state === 'ready')
  const names = $derived(members.map((m) => m.name).join(', '))
  const missing = $derived(members.filter((m) => m.status === 'missing').length)
  const notALink = $derived(members.filter((m) => m.status === 'not-a-link').length)
  // Check and Update from the pack menu act on the first member, so its row text is the pack's.
  const row = $derived(app.rowResult[members[0]?.name ?? ''])
  const INTEL_TIP = 'An update is available.\nClick to open Intel.'

  function onclick(e: MouseEvent): void {
    if ((e.target as HTMLElement).closest('button, input, label, dialog, [popover]')) return
    openPack(pack.key)
  }

  /** A refusal pushes no new look, so the box takes the state's look back by hand. */
  async function onchange(box: HTMLInputElement, agent: State['agents'][number]): Promise<void> {
    const look = packBox(members, agent.id).look
    await togglePack(pack, agent, boxClickOn(look))
    const now = packBox(members, agent.id).look
    box.checked = now === 'all'
    box.indeterminate = now === 'some'
  }
</script>

<!-- The pack name is a button, so the click handler here only adds a larger mouse target. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article
  class="skill-card pack-card cut"
  class:stowed
  class:update={ready}
  aria-label={pack.name}
  {onclick}
>
  <div class="card-top">
    <span class="card-top-id"
      ><span class="card-serial">PACK · {members.length} SKILLS</span>
      {#if ready}
        <Tip text={INTEL_TIP}>
          <button
            class="small amber card-intel"
            aria-label={`Intel for ${pack.name}`}
            onclick={() => (app.page = { name: 'intel' })}>↑ INTEL</button
          >
        </Tip>
      {/if}
    </span>
    <span class="card-top-end">
      {#if stowed}STOWED{:else}<span><b>{deployed}</b> DEPLOYED</span>{/if}
    </span>
  </div>
  <div class="card-main">
    <span
      class="tile {pack.type}"
      role="img"
      aria-label={pack.type === 'github' ? 'Link' : 'Registry'}
      ><Icon name={pack.type === 'github' ? 'link' : 'package'} size={18} /></span
    >
    <div class="card-id">
      <button class="card-name" onclick={() => openPack(pack.key)}>{pack.name}</button>
      <Tip text={names} overflow><span class="card-path">{names}</span></Tip>
    </div>
  </div>
  {#if missing > 0}
    <span class="card-chip bad">{missing} MISSING</span>
  {/if}
  {#if notALink > 0}
    <span class="card-chip bad">{notALink} NOT A LINK</span>
  {/if}
  <div class="card-foot">
    {#each agents as agent (agent.id)}
      {@const box = packBox(members, agent.id)}
      {@const text = `${agent.label}: ${box.deployed} of ${box.total} deployed`}
      <label class="toggle tip" class:partial={box.look === 'some'}>
        <input
          type="checkbox"
          aria-label={`${pack.name} ${text}`}
          checked={box.look === 'all'}
          {@attach (node) => {
            node.indeterminate = box.look === 'some'
          }}
          disabled={lib.busy !== null || (box.look === 'none' && box.deployable === 0)}
          onchange={(e) => onchange(e.currentTarget, agent)}
        />
        <span>{agentCode(agent)}</span>
        <span class="tip-text float" role="tooltip">{text}</span>
      </label>
    {/each}
    {#if row && pointsToLog(row)}
      <Tip text={`${row}\nClick to open the Log.`}>
        <button
          class="card-result warn"
          aria-label={`Open the Log: ${row}`}
          onclick={() => (app.page = { name: 'log' })}
          ><Icon name="triangle-alert" size={12} /><span>{row}</span></button
        >
      </Tip>
    {:else if row}
      <Tip text={row} overflow
        ><span class="card-result" class:running={isRunning(row)}>{row}</span></Tip
      >
    {/if}
    <span class="spacer"></span>
    <PackMenu {pack} {members} state={lib} />
  </div>
</article>
