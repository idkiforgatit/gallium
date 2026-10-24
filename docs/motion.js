// Motion for the Gallium website: reveal-on-scroll, scroll-driven scenes and the live Liquid Glass hero.
// Every scene reads one number, p (0 → 1 as you scroll through it). Reduced-motion users get the finished state.
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const lerp = (a, b, t) => a + (b - a) * t
const ease = t => 1 - Math.pow(1 - t, 3)
const nav = document.getElementById('nav')
let heroP = 0 // how far the hero has scrolled away, read by the glass renderer

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
  hero(el) { const p = calm ? 0 : clamp(-el.getBoundingClientRect().top / el.offsetHeight); heroP = p; el.style.setProperty('--p', p.toFixed(3)) },
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

// ---- the live Liquid Glass hero ----
;(() => {
  const cv = document.getElementById('glass')
  const gl = cv?.getContext('webgl', { antialias: false, alpha: false })
  if (!gl) return document.querySelector('.hero3')?.classList.add('still')
  const FRAG = `precision highp float;
uniform vec2 R; uniform float T, S; uniform vec2 M;
vec3 lin(vec3 c){return c*c;}
float A;
vec3 mesh(vec2 u){
  vec3 c=lin(vec3(1.,.42,.24));
  vec2 a=vec2(.35+.08*sin(T*.21),.8+.05*cos(T*.17)), b=vec2(A-.35+.06*cos(T*.19),.2+.05*sin(T*.23)), d=vec2(A-.2,.95+.04*sin(T*.3)), e=vec2(.6+.05*sin(T*.27),.1);
  c=mix(c,lin(vec3(1.,.176,.333)),exp(-dot(u-a,u-a)/.3));
  c=mix(c,lin(vec3(1.,.8,0.)),exp(-dot(u-b,u-b)/.3));
  c=mix(c,lin(vec3(.749,.353,.949)),exp(-dot(u-d,u-d)/.2));
  c=mix(c,lin(vec3(1.,.624,.039)),exp(-dot(u-e,u-e)/.16));
  return c;}
vec3 wall(vec3 o,vec3 d){d=normalize(vec3(d.xy,-max(abs(d.z),.35)));float k=(-3.2-o.z)/d.z;vec2 u=clamp((o+d*k).xy*.16+vec2(A*.5,.5),vec2(.05),vec2(A-.05,.95));
  vec3 c=mesh(u); float b=sin((u.x*.76+u.y*1.1)*9.+T*.15)*.5+.5; c*=.72+.5*smoothstep(.25,.75,b);
  for(int i=0;i<5;i++){float fi=float(i);vec2 o2=vec2(fract(sin(fi*7.3+1.)*43.1)*A+.03*sin(T*.2+fi),fract(sin(fi*3.1+1.)*17.7));c=mix(c,c*1.6+.04,(1.-smoothstep(.13,.16,length(u-o2)))*.6);}
  return c;}
mat3 rot(vec3 a){float cx=cos(a.x),sx=sin(a.x),cy=cos(a.y),sy=sin(a.y),cz=cos(a.z),sz=sin(a.z);
  return mat3(cy*cz,cy*sz,-sy, sx*sy*cz-cx*sz,sx*sy*sz+cx*cz,sx*cy, cx*sy*cz+sx*sz,cx*sy*sz-sx*cz,cx*cy);}
mat3 RM;
float map(vec3 p){vec3 q=RM*p; vec2 t=vec2(length(q.xz)-1.05,q.y); return length(t)-.36-.05*sin(atan(q.z,q.x)*3.+q.y*4.+T*.6);}
vec3 nrm(vec3 p){vec2 e=vec2(.002,-.002);return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));}
void main(){
  A=R.x/R.y;
  RM=rot(vec3(1.15+M.y*.35+S*1.1,.35+T*.16+M.x*.5+S*1.6,.2));
  vec2 uv=gl_FragCoord.xy/R.y, c=uv-vec2(A*.5,.5);
  float z=5.6-S*1.6; vec3 ro=vec3(0.,-S*.5,z), rd=normalize(vec3(c,-1.75));
  vec3 col=wall(ro,rd);
  float d=0.,h; bool hit=false;
  for(int i=0;i<80;i++){vec3 q=ro+rd*d;h=map(q);if(h<.001){hit=true;break;}d+=h;if(d>12.)break;}
  if(hit){
    vec3 p=ro+rd*d,n=nrm(p);
    vec3 ri=refract(rd,n,1./1.46); float t=.02; vec3 q=p;
    for(int i=0;i<48;i++){q=p+ri*t;float hh=-map(q);if(hh<.001)break;t+=max(hh*.85,.006);}
    vec3 n2=nrm(q), ro2=refract(ri,-n2,1.46); if(dot(ro2,ro2)<.01)ro2=reflect(ri,-n2);
    vec3 tr=vec3(wall(q,ro2+vec3(.02,0.,0.)).r,wall(q,ro2).g,wall(q,ro2-vec3(.025,0.,0.)).b)*1.1;
    vec3 rf=reflect(rd,n); float F=.04+.96*pow(1.-max(dot(n,-rd),0.),5.);
    vec3 env=wall(p,vec3(rf.xy,-abs(rf.z)-.2))*.85+vec3(1.)*smoothstep(.92,.99,dot(rf,normalize(vec3(-.5,.65,.6))))*1.2;
    col=mix(tr,env,F)+pow(max(dot(rf,normalize(vec3(-.5,.65,.6))),0.),160.)*1.3+pow(1.-max(dot(n,-rd),0.),3.)*lin(vec3(1.,.88,.69))*.35;
  }
  col*=1.-.18*dot(c*vec2(.7,1.),c*vec2(.7,1.));
  col=sqrt(1.-exp(-col*1.3));
  gl_FragColor=vec4(col,1.);}`
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o }
  const pr = gl.createProgram()
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'))
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(pr)
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return document.querySelector('.hero3').classList.add('still')
  gl.useProgram(pr)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const U = Object.fromEntries(['R', 'T', 'S', 'M'].map(k => [k, gl.getUniformLocation(pr, k)]))
  let mx = 0, my = 0, tx = 0, ty = 0, on = true, raf = 0, slow = 0
  addEventListener('pointermove', e => { tx = e.clientX / innerWidth - .5; ty = e.clientY / innerHeight - .5 }, { passive: true })
  new IntersectionObserver(es => { on = es[0].isIntersecting; if (on && !raf) raf = requestAnimationFrame(draw) }).observe(cv)
  // render at reduced resolution (the glass is soft anyway) and drop further if the GPU struggles
  let scale = innerWidth < 700 ? .45 : .6, last = performance.now(), avg = 16
  function draw(now) {
    raf = 0
    if (!on || document.hidden) return
    avg = avg * .9 + (now - last) * .1; last = now
    if (avg > 30 && scale > .35) { scale -= .05; avg = 16 }
    const w = Math.round(cv.clientWidth * scale * Math.min(devicePixelRatio, 1.5)), h = Math.round(cv.clientHeight * scale * Math.min(devicePixelRatio, 1.5))
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h) }
    mx += (tx - mx) * .05; my += (ty - my) * .05
    gl.uniform2f(U.R, w, h); gl.uniform1f(U.T, calm ? 3 : now / 1000); gl.uniform1f(U.S, heroP); gl.uniform2f(U.M, mx, my)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (!calm) raf = requestAnimationFrame(draw)
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on && !raf) raf = requestAnimationFrame(draw) })
  raf = requestAnimationFrame(draw)
})()
