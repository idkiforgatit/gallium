// node tools/scan.js — checks and virus-scans every file in docs/packages, then writes docs/packages/scan.json for the website.
// Runs on GitHub after every change to the packages and once a week (fresh virus definitions). ClamAV must be installed
// for a virus scan; without it the files are still format-checked and the scan is reported as "not run".
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync, spawnSync } = require('child_process')
const { check } = require('../src/gformat.js')
const root = path.join(__dirname, '..'), dir = path.join(root, 'docs', 'packages')
fs.copyFileSync(path.join(root, 'src', 'gformat.js'), path.join(root, 'docs', 'gformat.js')) // the site uses the same checker as the app

let engine = null
try { engine = execFileSync('clamscan', ['--version'], { encoding: 'utf8' }).trim() } catch {}
const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
const files = {}
let bad = 0
for (const { file } of index) {
  const full = path.join(dir, file), text = fs.readFileSync(full, 'utf8'), r = check(text, path.extname(file))
  let virus = 'not run', signature
  if (engine) {
    const res = spawnSync('clamscan', ['--no-summary', '--stdout', full], { encoding: 'utf8' })
    virus = res.status === 0 ? 'clean' : res.status === 1 ? 'infected' : 'error'
    if (virus === 'infected') signature = (res.stdout.match(/: (.+) FOUND/) || [])[1]
  }
  if (!r.ok || virus === 'infected') bad++
  files[file] = { sha256: crypto.createHash('sha256').update(text).digest('hex'), size: Buffer.byteLength(text),
    check: { ok: r.ok, errors: r.errors, warnings: r.warnings, changes: r.changes }, virus, ...(signature ? { signature } : {}) }
  console.log(file.padEnd(24), r.ok ? 'format ok' : 'FORMAT FAILED', '|', virus)
}
fs.writeFileSync(path.join(dir, 'scan.json'), JSON.stringify({ scannedAt: new Date().toISOString(), engine: engine || 'ClamAV not available', files }, null, 2) + '\n')
console.log(bad ? `${bad} file(s) failed` : 'all files passed')
process.exitCode = bad ? 1 : 0
