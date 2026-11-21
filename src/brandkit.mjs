/** Brand kit: portable theme presets, favorites, house style and snippets. */

export const BRAND_KIT_VERSION = 1

/** Build a stable, serializable brand kit from app state. */
export function createBrandKit({ favorites = [], recent = [], dnaPresets = [], styleGuide = null, snippets = [] } = {}) {
  return {
    format: 'dsh-wechat-brand-kit',
    version: BRAND_KIT_VERSION,
    exportedAt: new Date().toISOString(),
    favorites: [...new Set(favorites.filter(id => typeof id === 'string'))].slice(0, 30),
    recent: [...new Set(recent.filter(id => typeof id === 'string'))].slice(0, 10),
    dnaPresets: dnaPresets.filter(item => item && typeof item.id === 'string' && item.overrides).slice(0, 20),
    styleGuide: styleGuide ?? null,
    snippets: snippets.filter(item => item && typeof item.name === 'string' && typeof item.text === 'string').slice(0, 50),
  }
}

/** Validate an imported kit; returns null when the file is not a brand kit. */
export function parseBrandKit(raw) {
  if (raw === null || typeof raw !== 'object' || raw.format !== 'dsh-wechat-brand-kit') return null
  const kit = createBrandKit(raw)
  if (kit.favorites.length === 0 && kit.recent.length === 0 && kit.dnaPresets.length === 0 && kit.snippets.length === 0 && kit.styleGuide === null) return null
  return kit
}

/** Merge two kits without duplicating favorite ids, presets or snippets. */
export function mergeBrandKits(current, incoming) {
  if (incoming === null) return current
  if (current === null) return incoming
  const presetIds = new Set(current.dnaPresets.map(item => item.id))
  const snippetIds = new Set(current.snippets.map(item => item.id))
  return createBrandKit({
    favorites: [...current.favorites, ...incoming.favorites],
    recent: [...incoming.recent, ...current.recent],
    dnaPresets: [...current.dnaPresets, ...incoming.dnaPresets.filter(item => !presetIds.has(item.id))],
    styleGuide: incoming.styleGuide ?? current.styleGuide,
    snippets: [...current.snippets, ...incoming.snippets.filter(item => !snippetIds.has(item.id))],
  })
}
