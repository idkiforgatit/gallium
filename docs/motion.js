// Motion for the Gallium website: reveal-on-scroll, scroll-driven scenes and the live Liquid Glass hero.
// Every scene reads one number, p (0 → 1 as you scroll through it). Reduced-motion users get the finished state.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => 1 - Math.pow(1 - t, 3)
const nav = document.getElementById('nav')

// ---- fade + blur in as things arrive ----
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: .12 })
document.querySelectorAll('.rv').forEach(el => io.observe(el))

// ---- headline: words rise into place one after another ----
document.querySelectorAll('.split').forEach(h => {
  h.innerHTML = h.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}"><span>${w}</span></span>`).join(' ')
  requestAnimationFrame(() => h.classList.add('in'))
})

// ---- statement: every word lights up as you read past it ----
const words = document.getElementById('words')
if (words) words.innerHTML = words.textContent.trim().split(/\s+/).map(w => `<span>${w}</span>`).join(' ')
const wordEls = words ? [...words.children] : []

// ---- scroll scenes ----
const scenes = [...document.querySelectorAll('[data-scroll]')]
const track = document.getElementById('track')
function sizeGallery() {
  const g = document.getElementById('walls')
  if (!g || !track) return
  g.style.height = (track.scrollWidth - innerWidth + innerHeight * 1.15) + 'px' // tall enough to slide the whole row past
}
function progress(el) {
  const r = el.getBoundingClientRect()
  return clamp(-r.top / Math.max(1, r.height - innerHeight)) // 0 when it reaches the top, 1 when its end leaves
}
const handlers = {
  zoom(el, p) {
    const t = ease(clamp(p / .7))
    el.style.setProperty('--s', lerp(.58, 1, t).toFixed(4))
    el.style.setProperty('--rx', lerp(22, 0, t).toFixed(2) + 'deg')
    el.style.setProperty('--r', lerp(28, 0, t).toFixed(1) + 'px')
    el.style.setProperty('--cap', clamp((p - .62) / .25).toFixed(3))
  },
  words(el, p) { const n = wordEls.length, k = p * 1.25 * n; wordEls.forEach((w, i) => w.style.opacity = (.14 + .86 * clamp(k - i)).toFixed(3)) },
  hgal(el, p) {
    const max = track.scrollWidth - innerWidth
    track.style.transform = `translate3d(${(-p * max).toFixed(1)}px,0,0)`
    for (const f of track.children) { const r = f.getBoundingClientRect(), c = (r.left + r.width / 2) / innerWidth - .5; f.querySelector('img').style.transform = `translateX(${(-c * 8).toFixed(2)}%) scale(1.12)` }
  },
}
const pars = [...document.querySelectorAll('.par')]
let ticking = false
function frame() {
  ticking = false
  for (const el of scenes) handlers[el.dataset.scroll]?.(el, calm ? 1 : progress(el))
  if (!calm) for (const el of pars) { const r = el.getBoundingClientRect(), c = (r.top + r.height / 2 - innerHeight / 2) / innerHeight; el.style.transform = `translateY(${(c * +el.dataset.par * 100).toFixed(2)}vh)` }
  nav.classList.toggle('lined', scrollY > 10)
  navTone()
}
// the nav turns dark over dark sections, like Apple's
function navTone() { const el = document.elementFromPoint(innerWidth / 2, 60); nav.classList.toggle('dk', !!el?.closest('.dark,.story.is-dark')) }
addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(frame) } }, { passive: true })
addEventListener('resize', () => { sizeGallery(); frame() })
addEventListener('load', () => { sizeGallery(); frame() })
sizeGallery(); frame()

// ---- numbers count up when they come into view ----
const cio = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return
  cio.unobserve(e.target)
  const b = e.target, to = +b.dataset.count, from = +(b.dataset.from || 0), suf = b.dataset.suffix || '', t0 = performance.now()
  if (calm) return
  const step = now => { const t = ease(clamp((now - t0) / 1400)); b.textContent = Math.round(lerp(from, to, t)) + suf; if (t < 1) requestAnimationFrame(step) }
  requestAnimationFrame(step)
}), { threshold: .6 })
document.querySelectorAll('[data-count]').forEach(b => cio.observe(b))

// ---- cards lean toward the pointer ----
document.querySelectorAll('.tilt').forEach(c => {
  c.addEventListener('pointermove', e => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; c.style.transform = `perspective(700px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)` })
  c.addEventListener('pointerleave', () => c.style.transform = '')
})

// ---- scroll story (chapters swap the picture, and light or dark) ----
const story = document.getElementById('story')
if (story) {
  const pics = [...document.querySelectorAll('#storyFrame img')], dots = [...document.querySelectorAll('#dots i')], chapters = [...document.querySelectorAll('.chapter')]
  const sio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return
    const i = +e.target.dataset.i
    chapters.forEach(c => c.classList.toggle('on', c === e.target))
    pics.forEach((p, j) => p.classList.toggle('on', j === i))
    dots.forEach((d, j) => d.classList.toggle('on', j === i))
    story.classList.toggle('is-dark', e.target.hasAttribute('data-dark'))
    navTone()
  }), { rootMargin: '-50% 0px -50% 0px' })
  chapters.forEach(c => sio.observe(c))
}

// ---- nav link for the section on screen ----
const links = [...document.querySelectorAll('nav .links a')]
const nio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.hash === '#' + e.target.id)) }), { rootMargin: '-45% 0px -50% 0px' })
document.querySelectorAll('section[id]').forEach(s => nio.observe(s))
