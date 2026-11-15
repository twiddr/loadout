import { contextBridge, ipcRenderer } from 'electron'
import { INVOKE_CHANNELS, LISTEN_CHANNELS, type LoadoutApi } from '../core/ipc'

const allowed = (list: readonly string[], channel: string): boolean => list.includes(channel)

const api = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!allowed(INVOKE_CHANNELS, channel)) {
      return Promise.reject(new Error(`Invalid IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    if (!allowed(LISTEN_CHANNELS, channel)) return () => {}
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('loadout', api as LoadoutApi)
