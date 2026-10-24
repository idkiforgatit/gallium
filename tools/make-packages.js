// node tools/make-packages.js — writes the starter themes and mods in docs/packages and their listing (index.json)
const fs = require('fs'), path = require('path')
const { check, stringify } = require('../src/gformat.js')
const out = path.join(__dirname, '..', 'docs', 'packages')
const T = (name, style, dark, c1, c2, accent, wallpaper, description, settings) =>
  ({ gallium: 1, type: 'theme', name, author: 'Gallium', version: '1.0', description, style, dark, colors: { c1, c2, accent }, ...(settings ? { settings } : {}), ...(wallpaper ? { wallpaper } : {}) })
const M = (name, description, css) => ({ gallium: 1, type: 'mod', name, author: 'Gallium', version: '1.0', description, css })
const pkgs = [
  T('Sequoia Glass', 'glass', true, '#3a0f2e', '#1a0b2e', '#ff6a3d', 'sequoia', 'Deep Liquid Glass over warm red folds.'),
  T('Tide', 'glass', false, '#dbe8ff', '#c9dcff', '#3f7cf2', 'tide', 'Bright, airy glass with ocean blues.'),
  T('Mercury', 'apple', true, '#232326', '#2c2c30', '#8e8e93', 'mercury', 'Quiet graphite with a liquid metal home.'),
  T('Sonoma Mist', 'gradient', false, '#dff3e9', '#cfe9f1', '#2f8f7b', 'sonoma', 'Soft greens, calm as a morning walk.'),
  T('Gold Leaf', 'glass', true, '#1d140b', '#2e1f12', '#e8b86a', 'gold', 'Dark glass with warm gold accents.'),
  T('Paper', 'apple', false, '#f5f5f2', '#ecebe6', '#c2410c', null, 'Warm paper tones and a serif font for reading.', { font: 'serif', radius: 0.8 }),
  T('Bloom', 'gradient', false, '#f6dcf2', '#e3d6ff', '#9b5de5', 'bloom', 'Lilac and pink, light and playful.'),
  T('Nord Glass', 'glass', true, '#2e3440', '#3b4252', '#88c0d0', 'graphite', 'The Nord palette as Liquid Glass.', { radius: 1.1 }),
  M('Compact Sidebar', 'Shorter tab rows and smaller favourites, so more fits.', 'body{--tab-h:30px!important;--fav-h:40px!important}\n.tab{font-size:12.5px}\n#favorites{gap:6px}'),
  M('Clean Home', 'Hides the greeting and recent tabs on the home screen.', '#greet,#hrecent{display:none!important}'),
  M('Big Clock', 'A much larger clock on the home screen.', '#clock{font-size:clamp(90px,14vw,180px)!important;letter-spacing:-.05em}'),
  M('Square Corners', 'Sharper corners everywhere.', 'body{--r:.35!important}'),
]
const index = []
for (const p of pkgs) {
  const ext = p.type === 'theme' ? 'gtheme' : 'gmod', file = p.name.replace(/\s+/g, '-').toLowerCase() + '.' + ext, text = stringify(p) + '\n'
  const r = check(text, ext)
  if (!r.ok) throw new Error(file + ': ' + r.errors.join('; '))
  fs.writeFileSync(path.join(out, file), text)
  index.push({ file, type: p.type, name: p.name, author: p.author, description: p.description, ...(p.type === 'theme' ? { style: p.style, dark: p.dark, colors: p.colors, wallpaper: p.wallpaper || null } : {}) })
}
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(index, null, 2) + '\n')
console.log('wrote', index.length, 'packages')
