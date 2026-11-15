// No imports: the sandboxed renderer bundles this file. macOS only, so '/' is the separator.
export interface Paths {
  home: string
  loadout: string
  config: string
  library: string
  repos: string
  /** One saved Tessl review per skill, `<name>.json`. */
  reviews: string
  /** The skill folder saved before the last Tessl fix, per skill. */
  fixes: string
  /** Originals Loadout moved out of an agent folder, `<agent id>/<entry name>`. Loadout never deletes here. */
  backups: string
  tesslPlugins: string
  /** Read only, to remove the links `tessl install` makes. */
  agentsSkills: string
  /** Read only, to name the signed-in claude.ai account. */
  claudeJson: string
  /** Read only, for the Claude Code sync and skill override settings. */
  claudeSettings: string
  /** Read only, the folder Claude Code fills with the claude.ai synced skills. */
  synced: string
}

export function pathsFrom(home: string): Paths {
  const loadout = `${home}/.loadout`
  return {
    home,
    loadout,
    config: `${loadout}/config.json`,
    library: `${loadout}/skills`,
    repos: `${loadout}/repos`,
    reviews: `${loadout}/reviews`,
    fixes: `${loadout}/fixes`,
    backups: `${loadout}/backups`,
    tesslPlugins: `${home}/.tessl/plugins`,
    agentsSkills: `${home}/.agents/skills`,
    claudeJson: `${home}/.claude.json`,
    claudeSettings: `${home}/.claude/settings.json`,
    synced: `${home}/.claude/skills/synced`
  }
}

/** '~/x' -> '<home>/x'; '~' alone -> home; anything else unchanged. */
export function expandHome(path: string, home: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  return path
}

/** '<home>/x' -> '~/x'; anything else unchanged. */
export function displayPath(path: string, home: string): string {
  if (path === home) return '~'
  if (path.startsWith(home + '/')) return '~' + path.slice(home.length)
  return path
}
