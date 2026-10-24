// The hero laptop: a MacBook-Pro-style model built here from simple shapes (three.js), so nothing needs crediting.
// It can't be dragged. The buttons below it switch what's on the screen and glide the laptop to a new angle.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const box = document.getElementById('mac'), canvas = document.getElementById('mac-canvas'), btns = [...document.querySelectorAll('#screens button')]
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const SHOTS = { home: 'img/home-glass.jpg', page: 'img/page-glass.jpg', dark: 'img/home-dark.jpg', search: 'img/search-dark.jpg', overview: 'img/overview.jpg' }
// where the laptop turns for each screen: [turn, tilt, distance, look-at height]
const POSES = { home: [0, 0, 1, 0], page: [-.34, .02, 1.02, 0], dark: [.34, .02, 1.02, 0], search: [0, -.04, .86, 1.2], overview: [-.16, .05, .97, .4] }

let renderer
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }) } catch { box.classList.add('failed') }
if (renderer) build()

function build() {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture
  const camera = new THREE.PerspectiveCamera(26, 16 / 9, 1, 400)

  // ---- materials ----
  const alu = new THREE.MeshPhysicalMaterial({ color: 0xd3d5da, metalness: 1, roughness: .34, clearcoat: .15, clearcoatRoughness: .4 })
  const aluEdge = new THREE.MeshPhysicalMaterial({ color: 0xc4c6cb, metalness: 1, roughness: .26 })
  const ink = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: .55, metalness: .2 })
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: .62, metalness: .1 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x030304, roughness: .45, metalness: 0, envMapIntensity: .25 }) // the black bezel

  // canvas textures: speaker grille dots, a soft contact shadow, a gentle reflection on the screen glass
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t }
  const grille = tex(64, 512, (g, w, h) => { g.fillStyle = '#000'; for (let y = 4; y < h; y += 7) for (let x = 4 + (y / 7 % 2) * 3.5; x < w; x += 7) { g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill() } })
  const shadowTex = tex(256, 256, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,.4)'); r.addColorStop(.5, 'rgba(0,0,0,.14)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w) })
  const glareTex = tex(512, 512, (g, w, h) => { const l = g.createLinearGradient(0, 0, w, h); l.addColorStop(0, 'rgba(255,255,255,.16)'); l.addColorStop(.35, 'rgba(255,255,255,.03)'); l.addColorStop(.36, 'rgba(255,255,255,0)'); l.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = l; g.fillRect(0, 0, w, h) })
  const roundRect = (w, h, r) => { const s = new THREE.Shape(), x = -w / 2, y = -h / 2; s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return new THREE.ShapeGeometry(s, 8) }

  // ---- the laptop (units ≈ cm, 16-inch proportions) ----
  const W = 35.6, D = 24.8, BASE_H = .95, LID_H = .55
  const laptop = new THREE.Group(); scene.add(laptop)
  const base = new THREE.Mesh(new RoundedBoxGeometry(W, BASE_H, D, 6, .55), alu); base.position.y = BASE_H / 2; laptop.add(base)
  const top = y => BASE_H + y
  // keyboard well and keys
  const well = new THREE.Mesh(roundRect(28.2, 11.6, .5), ink); well.rotation.x = -Math.PI / 2; well.position.set(0, top(.004), -4.6); laptop.add(well)
  const keyGeo = new RoundedBoxGeometry(1, .16, 1, 2, .08)
  const keys = []
  const row = (z, widths, h = 1.5) => { const gap = .22, total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1); let x = -total / 2; for (const w of widths) { keys.push([x + w / 2, z, w, h]); x += w + gap } }
  const u = 1.62
  row(-9.55, Array(14).fill(1.72), .8)                                   // function row
  row(-8.15, [...Array(13).fill(u), u * 1.5])
  row(-6.33, [u * 1.5, ...Array(13).fill(u)])
  row(-4.51, [u * 1.8, ...Array(11).fill(u), u * 1.95])
  row(-2.69, [u * 2.35, ...Array(10).fill(u), u * 2.35])
  row(-.87, [u, u, u, u * 1.25, u * 5.9, u * 1.25, u, u * 2.7 + .22])   // bottom row with the space bar
  const keyMesh = new THREE.InstancedMesh(keyGeo, keyMat, keys.length)
  const m4 = new THREE.Matrix4()
  keys.forEach(([x, z, w, h], i) => keyMesh.setMatrixAt(i, m4.compose(new THREE.Vector3(x, top(.06), z), new THREE.Quaternion(), new THREE.Vector3(w, 1, h))))
  laptop.add(keyMesh)
  // speaker grilles either side of the keyboard
  for (const sx of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 13.4), new THREE.MeshBasicMaterial({ map: grille, transparent: true, opacity: .55, depthWrite: false }))
    g.rotation.x = -Math.PI / 2; g.position.set(sx * 15.9, top(.006), -4.6); laptop.add(g)
  }
  // trackpad
  const pad = new THREE.Mesh(roundRect(15.8, 9.6, .5), aluEdge); pad.rotation.x = -Math.PI / 2; pad.position.set(0, top(.005), 6.4); laptop.add(pad)
  // front lip notch
  const lip = new THREE.Mesh(new RoundedBoxGeometry(6, .22, .4, 2, .1), aluEdge); lip.position.set(0, BASE_H - .12, D / 2 - .05); laptop.add(lip)
  // soft shadow under the laptop
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.7, D * 1.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false }))
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .01; laptop.add(shadow)

  // lid: hinged at the back edge of the base; its inner face holds the screen
  const hinge = new THREE.Group(); hinge.position.set(0, BASE_H, -D / 2 + .35); laptop.add(hinge)
  const lid = new THREE.Mesh(new RoundedBoxGeometry(W, LID_H, D - .4, 6, .27), alu); lid.position.set(0, LID_H / 2, (D - .4) / 2); hinge.add(lid)
  const inner = new THREE.Group(); inner.position.set(0, -.012, (D - .4) / 2); inner.rotation.x = Math.PI / 2; hinge.add(inner) // faces the keyboard when shut; its +z side is the front of the glass
  const bezel = new THREE.Mesh(roundRect(W - .5, D - .9, .6), glass); inner.add(bezel)
  const SW = 33.6, SH = 21.7 // the display (about 16:10.3)
  const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false })
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), screenMat); screen.position.set(0, .35, .01); inner.add(screen)
  const fadeMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0, depthWrite: false })
  const fade = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), fadeMat); fade.position.set(0, .35, .02); inner.add(fade) // the next screen fades in on top
  const glare = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: glareTex, transparent: true, depthWrite: false, toneMapped: false })); glare.position.set(0, .35, .03); inner.add(glare)
  const notch = new THREE.Mesh(roundRect(2.9, .75, .3), new THREE.MeshBasicMaterial({ color: 0x000000 })); notch.position.set(0, .35 + SH / 2 - .32, .04); inner.add(notch)
  const cam = new THREE.Mesh(new THREE.CircleGeometry(.12, 16), new THREE.MeshBasicMaterial({ color: 0x1b2440 })); cam.position.set(0, .35 + SH / 2 - .32, .05); inner.add(cam)

  // screenshots fill the display like "cover", without stretching
  const loader = new THREE.TextureLoader(), cache = {}
  const shot = k => cache[k] ||= new Promise(ok => loader.load(SHOTS[k], t => {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy()
    const a = t.image.width / t.image.height, s = SW / SH
    if (a > s) { t.repeat.set(s / a, 1); t.offset.set((1 - s / a) / 2, 0) } else { t.repeat.set(1, a / s); t.offset.set(0, (1 - a / s) / 2) }
    ok(t)
  }))
  shot('home').then(t => { screenMat.map = t; screenMat.needsUpdate = true; start() })
  Object.keys(SHOTS).forEach(k => setTimeout(() => shot(k), 1500)) // warm the rest

  // ---- motion: everything eases toward a target pose; nothing follows the mouse ----
  const OPEN = -1.86, CLOSED = -.005
  const now = { lid: calm ? OPEN : CLOSED, ry: calm ? 0 : -.5, rx: 0, dist: calm ? 1 : 1.25, lift: 0, rise: calm ? 0 : -4 }
  const goal = { lid: OPEN, ry: 0, rx: 0, dist: 1, lift: 0, rise: 0 }
  let fadeT = 1, next = null, raf = 0, opened = false
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight
    if (w !== resize.w || h !== resize.h) { resize.w = w; resize.h = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
  }
  function frame() {
    raf = 0
    resize()
    let moving = false
    for (const k in goal) { const d = goal[k] - now[k]; if (Math.abs(d) > 1e-4) { now[k] += d * (k === 'lid' ? .055 : .075); moving = true } else now[k] = goal[k] }
    if (fadeT < 1) { fadeT = Math.min(1, fadeT + .06); fadeMat.opacity = fadeT; moving = true; if (fadeT === 1 && next) { screenMat.map = next; screenMat.needsUpdate = true; fadeMat.opacity = 0 } }
    hinge.rotation.x = now.lid
    laptop.rotation.set(now.rx, now.ry, 0); laptop.position.y = now.rise
    const d = 78 * now.dist
    camera.position.set(0, 15 + now.lift * .6, d); camera.lookAt(0, 9.5 + now.lift, 0)
    renderer.render(scene, camera)
    if (moving && !calm) raf = requestAnimationFrame(frame)
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame) }
  function start() {
    box.classList.add('ready')
    resize(); renderer.render(scene, camera)
    // the lid lifts and the laptop turns to face you once it scrolls into view
    new IntersectionObserver((es, o) => { if (es[0].isIntersecting && !opened) { opened = true; o.disconnect(); setTimeout(kick, 250) } }, { threshold: .3 }).observe(box)
    if (calm) frame()
  }
  addEventListener('resize', kick)
  btns.forEach(b => b.addEventListener('click', async () => {
    btns.forEach(x => x.classList.toggle('on', x === b))
    const [ry, rx, dist, lift] = POSES[b.dataset.s]
    Object.assign(goal, { ry, rx, dist, lift, lid: OPEN })
    const t = await shot(b.dataset.s)
    if (t !== screenMat.map) { if (calm) { screenMat.map = t; screenMat.needsUpdate = true } else { next = t; fadeMat.map = t; fadeMat.needsUpdate = true; fadeT = 0 } }
    kick()
  }))
}
