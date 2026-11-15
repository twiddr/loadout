import type { LoadoutApi } from '../core/ipc'

declare global {
  interface Window {
    loadout: LoadoutApi
  }
}

export {}
