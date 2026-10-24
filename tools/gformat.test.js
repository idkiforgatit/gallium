// node tools/gformat.test.js — the theme/mod checker must accept good files and block bad ones
const assert = require('assert')
const { check } = require('../src/gformat.js')
const theme = o => JSON.stringify({ gallium: 1, type: 'theme', name: 'T', colors: { c1: '#112233', c2: '#445566' }, ...o })
const mod = css => JSON.stringify({ gallium: 1, type: 'mod', name: 'M', css })

assert(check(theme({ style: 'glass', dark: true, settings: { font: 'apple', radius: 1.2 } }), 'gtheme').ok)
assert(!check('not json').ok)
assert(!check(theme({ colors: { c1: 'red', c2: '#000000' } })).ok, 'colour names are not allowed')
assert(!check(JSON.stringify({ gallium: 2, type: 'theme' })).ok, 'unknown version')
assert(check(theme({ settings: { radius: 99 } })).warnings.length, 'out-of-range settings are dropped with a warning')
assert(check(theme({ wallpaper: 'https://evil.example/x.jpg' })).pkg.wallpaper === undefined, 'remote wallpapers are ignored')
assert(check(theme({ wallpaper: 'data:image/jpeg;base64,AAAA' })).pkg.wallpaper, 'embedded pictures are kept')
assert(check(theme({ name: '<img onerror=x>' })).pkg.name.indexOf('<') === -1, 'tags are stripped from text')
assert(check(theme(), 'gmod').warnings.length, 'wrong extension warns')

assert(check(mod('#sidebar{width:200px}'), 'gmod').ok)
for (const bad of ['@import "x.css";', 'a{background:url(https://x.y/a.png)}', 'a{background:url( "//x.y/a.png")}', 'a{width:expression(alert(1))}',
  'a{background:url(javascript:alert(1))}', 'body{display:none}', 'html { opacity: 0 }', '</style><script>alert(1)</script>', 'a{behavior:url(x.htc)}'])
  assert(!check(mod(bad)).ok, 'should block: ' + bad)
assert(check(mod('a{background:url(data:image/png;base64,AAAA)}')).ok, 'embedded images are fine')
assert(check(mod('#t-url{display:none}')).warnings.some(w => /address bar/.test(w)), 'hiding the address bar warns')
assert(check(mod('/* @import x */ a{color:red}')).ok, 'comments are ignored')
console.log('gformat: all checks passed')
