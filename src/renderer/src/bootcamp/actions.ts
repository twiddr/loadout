import { api } from '../api'
import { app, report } from '../state.svelte'

/** CHECK AGAIN: the startup check, as SYSTEMS Refresh runs it. */
export async function checkAgain(): Promise<void> {
  app.rowResult = {}
  report(await api.invoke('refresh'))
}

/** OPEN TERMINAL: a refusal shows under the page header; a success shows nothing. */
export async function openTerminal(): Promise<void> {
  report(await api.invoke('open-terminal'))
}
