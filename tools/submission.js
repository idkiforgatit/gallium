// node tools/submission.js — checks and virus-scans a theme or mod uploaded through a GitHub issue (the "Upload" form).
// Input (env): BODY = the issue text, ISSUE = its number, PUBLISH=1 to add it to the gallery when it passes.
// Output: report.md (posted on the issue) and, via GITHUB_OUTPUT, result=passed|failed and file=<name>.
// The issue text is untrusted: it is only parsed here, never run, and files are only fetched from GitHub's own upload host.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), { execFileSync, spawnSync } = require('child_process')
const { check } = require('../src/gformat.js')
const root = path.join(__dirname, '..'), dir = path.join(root, 'docs', 'packages')
const ATTACH = /https:\/\/github\.com\/user-attachments\/files\/\d+\/[\w.%-]+/

// The form puts the file under "### Package file": either pasted text (maybe in a ``` block) or a link to an attached file
function section(body) {
  const m = (body || '').replace(/\r/g, '').match(/###\s*Package file\s*\n([\s\S]*?)(?=\n###\s|$)/)
  return m ? m[1].trim() : (body || '').trim()
}
async function getText(body) {
  const s = section(body), url = (s.match(ATTACH) || [])[0]
  if (url) {
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error('Could not download the attached file (' + res.status + ').')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 7 << 20) throw new Error('The attached file is larger than 7 MB.')
    return buf.toString('utf8')
  }
  const fenced = s.match(/```[a-z]*\n([\s\S]*?)\n```/)
  const text = (fenced ? fenced[1] : s).trim()
  if (!text || text === '_No response_') throw new Error('No file found. Paste the file\'s contents or attach the .txt file the website gave you.')
  return text
}
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'untitled'

async function main() {
  const out = [], lines = []
  let result = 'failed', file = ''
  const say = (...l) => lines.push(...l)
  try {
    const text = await getText(process.env.BODY), r = check(text, '')
    const sha = crypto.createHash('sha256').update(text).digest('hex')
    const tmp = path.join(os.tmpdir(), 'upload-' + sha.slice(0, 12) + (r.kind === 'mod' ? '.gmod' : '.gtheme'))
    fs.writeFileSync(tmp, text)
    let engine = null, virus = 'not run', signature = ''
    try { engine = execFileSync('clamscan', ['--version'], { encoding: 'utf8' }).trim() } catch {}
    if (engine) {
      const res = spawnSync('clamscan', ['--no-summary', '--stdout', tmp], { encoding: 'utf8' })
      virus = res.status === 0 ? 'clean' : res.status === 1 ? 'infected' : 'error'
      signature = (res.stdout.match(/: (.+) FOUND/) || [])[1] || ''
    }
    const passed = r.ok && virus === 'clean'
    result = passed ? 'passed' : 'failed'
    say(passed ? '## ✅ Passed the checks' : '## ❌ Did not pass', '',
      `**${r.pkg ? r.pkg.name : 'Unknown file'}**${r.kind ? ' · ' + r.kind : ''} · ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB`, '',
      '| Check | Result |', '|---|---|',
      `| Format (the same checker Gallium uses) | ${r.ok ? '✅ valid ' + r.kind : '❌ ' + r.errors.join(' ')} |`,
      `| Virus scan (${engine ? engine.split('/')[0] : 'ClamAV'}) | ${virus === 'clean' ? '✅ clean' : virus === 'infected' ? '❌ threat found: ' + signature : '⚠️ ' + (engine ? 'scan error' : 'scanner not available')} |`,
      `| SHA-256 | \`${sha}\` ([VirusTotal](https://www.virustotal.com/gui/file/${sha})) |`, '')
    if (r.changes.length) say('**What it changes**', ...r.changes.map(c => '- ' + c), '')
    if (r.warnings.length) say('**Worth knowing**', ...r.warnings.map(w => '- ' + w), '')

    if (passed && process.env.PUBLISH === '1') {
      const ext = r.kind === 'mod' ? '.gmod' : '.gtheme', index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))
      let base = slugify(r.pkg.name), n = 1
      file = base + ext
      while (fs.existsSync(path.join(dir, file))) file = `${base}-${++n}${ext}`
      fs.writeFileSync(path.join(dir, file), text.endsWith('\n') ? text : text + '\n')
      const p = r.pkg, w = typeof p.wallpaper === 'string' && fs.existsSync(path.join(root, 'docs', 'img', 'walls', p.wallpaper + '.jpg')) ? p.wallpaper : null
      index.push({ file, type: r.kind, name: p.name, author: p.author || 'Unknown', description: p.description || '', upload: +process.env.ISSUE || undefined,
        ...(r.kind === 'theme' ? { style: p.style, dark: !!p.dark, colors: p.colors, wallpaper: w } : {}) })
      fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2) + '\n')
      execFileSync('node', [path.join(__dirname, 'scan.js')], { stdio: 'inherit' })
      say(`🎉 **Published** as \`${file}\`. It shows up on the [Themes & Mods page](https://idkiforgatit.github.io/gallium/themes.html) in a minute or two.`)
    } else if (passed) say('A maintainer will take a look, then add it to the gallery.')
    else say('Fix the problems above, then edit this issue with the new file. It is checked again automatically.')
  } catch (e) {
    say('## ❌ Could not check this upload', '', e.message)
  }
  fs.writeFileSync(path.join(root, 'report.md'), lines.join('\n') + '\n')
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `result=${result}\nfile=${file}\n`)
  console.log(lines.join('\n'))
}
if (require.main === module) main()
module.exports = { main, section, getText, slugify }
