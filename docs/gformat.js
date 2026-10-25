// Gallium theme (.gtheme) and mod (.gmod) files.
// Both are plain JSON. Nothing in them is ever run: a theme is colours, a few settings and an optional picture,
// and a mod is a CSS stylesheet. check() validates a file and returns a cleaned copy plus everything worth warning about.
// The same file runs in the app, on the website and in the GitHub scan job (keep docs/gformat.js a copy of src/gformat.js).
;(function (root) {
  const LIMIT = { theme: 6 * 1024 * 1024, mod: 100 * 1024 }
  const HEX = /^#[0-9a-f]{6}$/i
  const STYLES = { gradient: 'Gradient', apple: 'Apple', glass: 'Liquid Glass', macos: 'macOS' }
  const FONTS = { auto: 'Automatic', system: 'Segoe UI', apple: 'SF Pro', geometric: 'Bahnschrift', serif: 'Georgia', mono: 'Cascadia Code' }
  const WINBG = { blur: 'Blurred photo', gradient: 'Soft gradient', solid: 'Solid colour', theme: 'Theme colours' }
  const TOP = { theme: ['gallium', 'type', 'name', 'author', 'version', 'description', 'style', 'dark', 'colors', 'settings', 'wallpaper'],
    mod: ['gallium', 'type', 'name', 'author', 'version', 'description', 'css'] }
  // CSS that could reach outside the app, run code, or swallow the whole window
  const CSS_BLOCK = [
    [/@import/i, 'loads another stylesheet from somewhere else (@import)'],
    [/url\s*\(\s*(['"]?)(?!data:image\/(png|jpeg|webp|gif|svg\+xml)[;,])/i, 'loads a file from outside the mod (url() that is not an embedded image)'],
    [/expression\s*\(/i, 'contains a script expression'],
    [/(java|vb)script\s*:/i, 'contains a script link'],
    [/-moz-binding|behavior\s*:/i, 'tries to attach code to the page'],
    [/<\s*\/?\s*(style|script|iframe|object|embed|link|meta)/i, 'contains HTML tags'],
    [/(^|[\s,}])(html|body|:root|#app)\s*\{[^}]*(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(\.0*)?\s*[;}]|pointer-events\s*:\s*none)/i, 'would hide or freeze the whole window'],
  ]
  const CSS_WARN = [
    [/z-index\s*:\s*\d{4,}/i, 'Draws things on top of everything else'],
    [/content\s*:\s*(['"])[^'"]{40,}\1/i, 'Adds long text to the interface, which could imitate Gallium\'s own messages'],
    [/#(t-url|t-q|titlebar|tbar)\b[^{]*\{[^}]*(display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)/i, 'Hides the address bar, so you might not see which site you are on'],
    [/@font-face/i, 'Includes its own font'],
  ]
  const clean = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n) : ''
  const mb = n => (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' MB'

  function check(text, ext, opts = {}) {
    const r = { ok: false, kind: null, pkg: null, errors: [], warnings: [], changes: [], size: (text || '').length }
    const fail = m => { r.errors.push(m); return r }
    if (typeof text !== 'string' || !text.trim()) return fail('The file is empty.')
    let j
    try { j = JSON.parse(text) } catch { return fail('This is not a Gallium file (it is not valid JSON).') }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return fail('This is not a Gallium file.')
    if (j.gallium !== 1) return fail('Unknown format version. Update Gallium or ask the author for a newer file.')
    const kind = j.type
    if (kind !== 'theme' && kind !== 'mod') return fail('The file says it is a "' + clean(String(kind), 20) + '", which Gallium does not know.')
    r.kind = kind
    ext = (ext || '').replace(/^\./, '').toLowerCase()
    if (ext && ext !== (kind === 'theme' ? 'gtheme' : 'gmod')) r.warnings.push('The file name ends in .' + ext + ' but it contains a ' + kind + '.')
    if (r.size > LIMIT[kind]) return fail('The file is too large for a ' + kind + ' (' + mb(r.size) + ', limit ' + mb(LIMIT[kind]) + ').')
    const extra = Object.keys(j).filter(k => !TOP[kind].includes(k))
    if (extra.length) r.warnings.push('Has extra fields Gallium ignores: ' + extra.slice(0, 5).map(k => clean(k, 20)).join(', '))
    const pkg = { gallium: 1, type: kind, name: clean(j.name, 60), author: clean(j.author, 60) || 'Unknown', version: clean(j.version, 20) || '1.0', description: clean(j.description, 300) }
    if (!pkg.name) return fail('The ' + kind + ' has no name.')
    if (kind === 'theme') {
      const c = j.colors || {}
      if (!HEX.test(c.c1 || '') || !HEX.test(c.c2 || '')) return fail('Colours must be written like #a1b2c3 (colors.c1 and colors.c2).')
      if (c.accent && !HEX.test(c.accent)) return fail('The accent colour must be written like #a1b2c3.')
      pkg.style = STYLES[j.style] ? j.style : 'gradient'
      if (j.style && !STYLES[j.style]) r.warnings.push('Unknown style "' + clean(String(j.style), 20) + '", using Gradient.')
      pkg.dark = j.dark === true
      pkg.colors = { c1: c.c1.toLowerCase(), c2: c.c2.toLowerCase(), ...(c.accent ? { accent: c.accent.toLowerCase() } : {}) }
      r.changes.push(STYLES[pkg.style] + (pkg.dark ? ' dark' : ' light') + ' look, colours ' + pkg.colors.c1 + ' and ' + pkg.colors.c2 + (pkg.colors.accent ? ', accent ' + pkg.colors.accent : ''))
      const s = j.settings || {}, set = {}
      const num = (k, lo, hi) => { if (s[k] === undefined) return; const v = +s[k]; if (Number.isFinite(v) && v >= lo && v <= hi) set[k] = v; else r.warnings.push('Ignored "' + k + '": out of range.') }
      if (s.font !== undefined) FONTS[s.font] ? set.font = s.font : r.warnings.push('Ignored unknown font.')
      if (s.winbg !== undefined) WINBG[s.winbg] ? set.winbg = s.winbg : r.warnings.push('Ignored unknown window background.')
      num('radius', .3, 1.8); num('glass', 0, 85); num('tint', 0, 80)
      if (Object.keys(set).length) {
        pkg.settings = set
        r.changes.push('Settings: ' + [set.font && 'font ' + FONTS[set.font], set.radius && 'corner roundness', set.glass !== undefined && 'glass tint', set.tint !== undefined && 'window tint', set.winbg && 'window background ' + WINBG[set.winbg]].filter(Boolean).join(', '))
      }
      const w = j.wallpaper
      if (typeof w === 'string' && w) {
        if (/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(w)) { pkg.wallpaper = w; r.changes.push('Its own wallpaper picture (' + mb(w.length * .75) + ')') }
        else if (/^[a-z0-9-]{1,30}$/.test(w) && (!opts.walls || opts.walls.includes(w))) { pkg.wallpaper = w; r.changes.push('Wallpaper: ' + (opts.wallName?.(w) || w)) }
        else r.warnings.push('Ignored the wallpaper: it is not a picture Gallium can use.')
      }
    } else {
      if (typeof j.css !== 'string' || !j.css.trim()) return fail('The mod has no CSS.')
      const css = j.css.replace(/\/\*[\s\S]*?\*\//g, '')
      for (const [re, why] of CSS_BLOCK) if (re.test(css)) r.errors.push('Blocked: it ' + why + '.')
      if (r.errors.length) return r
      for (const [re, why] of CSS_WARN) if (re.test(css)) r.warnings.push(why + '.')
      pkg.css = j.css
      const rules = (css.match(/\{/g) || []).length
      r.changes.push('Restyles Gallium with ' + rules + ' CSS rule' + (rules === 1 ? '' : 's') + '. It cannot run code, read your tabs or reach the internet.')
    }
    r.pkg = pkg; r.ok = true
    return r
  }
  // Pretty JSON for exporting (wallpaper last so the readable part stays at the top)
  const stringify = pkg => JSON.stringify(pkg, null, 2)
  const api = { check, stringify, STYLES, FONTS, LIMIT }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.GalliumFormat = api
})(typeof self !== 'undefined' ? self : this)
