/*
 * Vanilla (no React) ports of React Bits components: Aurora, LiquidChrome, BlurText, ShinyText, SpotlightCard.
 * Original components: https://github.com/DavidHDev/react-bits . Shaders are copied unchanged; the wiring is rewritten.
 *
 * MIT + Commons Clause License Condition v1.0
 * 
 * Copyright (c) 2026 David Haz
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * ## Commons Clause Restriction
 * 
 * You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
 * 
 * The same restriction covers the React Bits tools (Background Studio, Texture Lab, Shape Magic, Center Stage, Sound Lab and any tools added later) and the sounds in the sound library. **You may not sell, sublicense, or redistribute the tools or the sounds themselves, or offer the tools or a substantially similar copy of them as a hosted service-whether alone, in a bundle, or as a ported version.**
 * 
 * What you make with the tools is yours to use. You can use exported code, images, videos, and audio files in any personal or commercial application, website, or product, including paid ones. **You may not sell or redistribute the exports on their own, either individually or as the product itself, such as a sound, texture, background, or template pack.**
 * 
 * ## No Warranty
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
function compile(gl, type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s; console.warn(gl.getShaderInfoLog(s)); gl.deleteShader(s); return null }
function link(gl, vsrc, fsrc, bindPos) {
  const v = compile(gl, gl.VERTEX_SHADER, vsrc), f = compile(gl, gl.FRAGMENT_SHADER, fsrc), p = gl.createProgram()
  if (!v || !f) return null
  gl.attachShader(p, v); gl.attachShader(p, f); if (bindPos) gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null
  const uniforms = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name) }
  return { program: p, uniforms }
}

// ---------------- Aurora ----------------
const A_MAX_STOPS = 5, A_MAX_LAYERS = 3, A_INTRO = 2.4
const MAX_STOPS = A_MAX_STOPS, MAX_LAYERS = A_MAX_LAYERS
const A_VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`
const A_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uStops[${MAX_STOPS}];
uniform int uStopCount;
uniform float uAmplitude;
uniform float uBlend;
uniform float uHeight;
uniform float uScale;
uniform float uGlow;
uniform float uBrightness;
uniform int uLayers;
uniform float uFlip;
uniform vec3 uPointer;
uniform float uReveal;
uniform float uOpacity;
uniform float uLightMode;
out vec4 outColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float smootherstep(float edge0, float edge1, float x) {
  float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec3 oklabToLinear(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l;
  m = m * m * m;
  s = s * s * s;
  return vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

vec3 toSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 ramp(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uStopCount - 1);
  int i = int(min(floor(x), float(uStopCount - 2)));
  float f = x - float(i);
  f = f * f * (3.0 - 2.0 * f);
  vec3 lch = mix(uStops[i], uStops[i + 1], f);
  lch.x = mix(lch.x, min(lch.x, 0.7), uLightMode);
  return toSrgb(oklabToLinear(vec3(lch.x, lch.y * cos(lch.z), lch.y * sin(lch.z))));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  float y = 1.0 - frag.y / uResolution.y;
  y = mix(y, 1.0 - y, uFlip);
  float u = frag.x / uResolution.x;
  float X = (frag.x - uResolution.x * 0.5) / uResolution.y;
  float t = uTime;
  float reach = uPointer.z * exp(-pow((X - uPointer.x) / 0.38, 2.0));

  vec3 glow = vec3(0.0);
  float cover = 0.0;
  for (int k = 0; k < ${MAX_LAYERS}; k++) {
    if (k >= uLayers) break;
    float layer = float(k);
    float seed = layer * 13.7;
    float pace = t * (1.0 - layer * 0.18);
    float warp = snoise(vec2(X * 0.45 * uScale + pace * 0.02 + seed, pace * 0.05 + seed));
    float wave = snoise(vec2(X * 0.75 * uScale + warp * 0.35 - pace * 0.03 + seed, pace * 0.07 - seed)) * 0.72
      + snoise(vec2(X * 1.6 * uScale + warp * 0.5 + pace * 0.04 - seed, pace * 0.1 + seed * 0.5)) * 0.28;
    float hem = uHeight + layer * 0.07 + wave * 0.15 * uAmplitude;
    hem += reach * 0.08 * (layer < 0.5 ? 1.0 : 0.4);
    hem = mix(-0.25, hem, uReveal);

    float soft = (0.04 + uBlend * 0.16) * (1.0 + layer * 0.9);
    float rise = hem - y;
    float low = -soft - uGlow * 0.14;
    float high = 0.26 + soft * 0.6;
    float body = pow(smootherstep(low, high, rise), 1.5 + uGlow * 0.6);
    float lobes = 0.86 + 0.14 * snoise(vec2(X * 0.9 * uScale - pace * 0.025 + seed, y * 0.3 + pace * 0.04));
    float alpha = body * lobes * (layer < 0.5 ? 1.0 : 0.32 / layer);
    alpha = clamp(alpha * (1.0 + reach * 0.25 * smootherstep(0.9, 0.0, abs(y - hem))), 0.0, 1.0);

    vec3 tint = ramp(u + 0.05 * sin(pace * 0.08 + layer * 2.3) + layer * 0.1 + max(rise, 0.0) * 0.05);
    glow = 1.0 - (1.0 - glow) * (1.0 - tint * alpha);
    cover = 1.0 - (1.0 - cover) * (1.0 - alpha);
  }

  float fade = smootherstep(0.0, 0.7, uReveal) * uOpacity;
  float strength = clamp(uBrightness, 0.0, 2.0);
  glow *= fade * min(strength, 1.0);
  cover *= fade * min(strength, 1.0);
  glow = 1.0 - pow(1.0 - glow, vec3(max(strength, 1.0)));
  float dither = (hash(frag) - 0.5) / 255.0;

  if (uLightMode > 0.5) {
    vec3 tint = cover > 0.0001 ? glow / cover : vec3(0.0);
    cover *= smootherstep(0.0, 0.25, cover);
    float alpha = cover * 0.7;
    outColor = vec4(tint * alpha + dither, clamp(alpha + dither, 0.0, 1.0));
    return;
  }
  outColor = vec4(glow + dither, clamp(cover + dither, 0.0, 1.0));
}`
const toOklch = rgb => {
  const [r, g, b] = rgb.map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lab = [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
  return [lab[0], Math.hypot(lab[1], lab[2]), Math.atan2(lab[2], lab[1])]
}
const unwrapHues = stops => { const k = stops.findIndex(s => s[1] > 0.02); let prev = k === -1 ? 0 : stops[k][2]; return stops.map(s => { let h = s[1] > 0.02 ? s[2] : prev; while (h - prev > Math.PI) h -= Math.PI * 2; while (h - prev < -Math.PI) h += Math.PI * 2; prev = h; return [s[0], s[1], h] }) }
const hexRgb = h => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255] }

export function aurora(container, o = {}) {
  const s = { stops: ['#5227FF', '#7cff67', '#5227FF'], amplitude: 1, blend: .5, speed: 1, height: .45, scale: 1, glow: .6, brightness: 1, layers: 1, flip: 0, intro: true, opacity: 1, mouse: true, ...o }
  const canvas = document.createElement('canvas'); canvas.className = 'rb-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.appendChild(canvas)
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
  const prog = gl && link(gl, A_VERTEX, A_FRAGMENT, true)
  if (!prog) return { setActive() {} }
  const u = prog.uniforms, vao = gl.createVertexArray(); gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const palette = new Float32Array(A_MAX_STOPS * 3); unwrapHues(s.stops.map(c => toOklch(hexRgb(c)))).forEach((st, i) => palette.set(st, i * 3))
  const view = { w: 1, h: 1 }, ptr = { x: 0, y: 0, inside: false }, st = { clock: 0, px: 0, py: .5, reach: 0, reveal: s.intro && !reduced() ? 0 : 1 }
  let raf = 0, last = 0, visible = false, active = o.active !== false
  const render = () => {
    gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(prog.program); gl.bindVertexArray(vao)
    gl.uniform2f(u.uResolution, canvas.width, canvas.height); gl.uniform1f(u.uTime, st.clock); gl.uniform3fv(u.uStops, palette); gl.uniform1i(u.uStopCount, s.stops.length)
    gl.uniform1f(u.uAmplitude, s.amplitude); gl.uniform1f(u.uBlend, s.blend); gl.uniform1f(u.uHeight, s.height); gl.uniform1f(u.uScale, s.scale); gl.uniform1f(u.uGlow, s.glow)
    gl.uniform1f(u.uBrightness, s.brightness); gl.uniform1i(u.uLayers, s.layers); gl.uniform1f(u.uFlip, s.flip); gl.uniform3f(u.uPointer, st.px, st.py, st.reach)
    gl.uniform1f(u.uReveal, 1 - Math.pow(1 - st.reveal, 3)); gl.uniform1f(u.uOpacity, s.opacity); gl.uniform1f(u.uLightMode, 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  const frame = now => {
    raf = 0
    if (!visible || !active || document.hidden) return
    const dt = last ? clamp((now - last) / 1000, .0005, .05) : 1 / 60; last = now
    st.clock += dt * s.speed * (reduced() ? 0 : 1)
    const engaged = s.mouse && ptr.inside && !reduced(), follow = 1 - Math.exp(-dt / .6)
    if (engaged) { st.px += ((ptr.x - view.w / 2) / view.h - st.px) * follow; st.py += ((s.flip ? 1 - ptr.y / view.h : ptr.y / view.h) - st.py) * follow }
    st.reach += ((engaged ? 1 : 0) - st.reach) * (1 - Math.exp(-dt / (engaged ? .9 : 1.4)))
    if (st.reveal < 1) st.reveal = Math.min(1, st.reveal + dt / A_INTRO)
    render(); raf = requestAnimationFrame(frame)
  }
  const wake = () => { if (!raf && visible && active && !document.hidden) { last = 0; raf = requestAnimationFrame(frame) } }
  const resize = () => { const r = Math.min(devicePixelRatio || 1, 1.5); view.w = Math.max(1, container.clientWidth); view.h = Math.max(1, container.clientHeight); canvas.width = Math.round(view.w * r); canvas.height = Math.round(view.h * r); render(); wake() }
  new ResizeObserver(resize).observe(container)
  new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); wake() }).observe(container)
  addEventListener('pointermove', e => { const r = container.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; ptr.inside = ptr.x >= 0 && ptr.y >= 0 && ptr.x <= r.width && ptr.y <= r.height }, { passive: true })
  document.addEventListener('visibilitychange', wake)
  resize()
  return { setActive(on) { active = on; if (on && st.reveal >= 1 && s.intro) st.reveal = .35; wake() } }
}

// ---------------- LiquidChrome ----------------
const L_PIXEL_BUDGET = 2.4e6, L_SIM_CELL = 4, L_SIM_STEP = 1 / 120
const L_VERTEX = `#version 300 es
const vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() {
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`
const L_SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSize;
uniform vec4 uStroke;
uniform vec2 uImpulse;
out vec4 fragColor;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - a - ab * t);
}

void main() {
  vec2 texel = 1.0 / uSize;
  vec2 uv = gl_FragCoord.xy * texel;
  vec2 state = texture(uState, uv).rg;
  vec2 around =
    texture(uState, uv - vec2(texel.x, 0.0)).rg +
    texture(uState, uv + vec2(texel.x, 0.0)).rg +
    texture(uState, uv - vec2(0.0, texel.y)).rg +
    texture(uState, uv + vec2(0.0, texel.y)).rg -
    4.0 * state;
  float next = state.r + (state.r - state.g) * 0.982 + 0.3 * around.r + 0.08 * (around.r - around.g);
  next *= 0.998;
  if (uImpulse.x != 0.0) {
    float d = segment(gl_FragCoord.xy, uStroke.xy, uStroke.zw) / uImpulse.y;
    next += uImpulse.x * exp(-d * d);
  }
  fragColor = vec4(next, state.r, 0.0, 1.0);
}`
const L_SLOPE = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSize;
out vec4 fragColor;

void main() {
  vec2 texel = 1.0 / uSize;
  vec2 uv = gl_FragCoord.xy * texel;
  float left = texture(uState, uv - vec2(texel.x, 0.0)).r;
  float right = texture(uState, uv + vec2(texel.x, 0.0)).r;
  float down = texture(uState, uv - vec2(0.0, texel.y)).r;
  float up = texture(uState, uv + vec2(0.0, texel.y)).r;
  fragColor = vec4((right - left) * 0.5, (up - down) * 0.5, 0.0, 1.0);
}`
const L_CHROME = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform float uUnit;
uniform float uTime;
uniform float uAmplitude;
uniform vec2 uFrequency;
uniform float uDetail;
uniform float uSharpness;
uniform float uDepth;
uniform float uPresence;
uniform vec3 uTint;
uniform vec2 uShift;
uniform float uRoughness;
uniform float uExposure;
uniform float uLight;
uniform sampler2D uSlope;
uniform vec2 uSlopeSize;
uniform float uRipple;
out vec4 fragColor;

vec2 slopeAt(vec2 uv) {
  vec2 st = uv * uSlopeSize - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (-f3 + 3.0 * f2 - 3.0 * f + 1.0) / 6.0;
  vec2 w1 = (3.0 * f3 - 6.0 * f2 + 4.0) / 6.0;
  vec2 w2 = (-3.0 * f3 + 3.0 * f2 + 3.0 * f + 1.0) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / uSlopeSize;
  vec2 h1 = (i + 1.5 + w3 / g1) / uSlopeSize;
  vec2 a = texture(uSlope, vec2(h0.x, h0.y)).rg;
  vec2 b = texture(uSlope, vec2(h1.x, h0.y)).rg;
  vec2 c = texture(uSlope, vec2(h0.x, h1.y)).rg;
  vec2 d = texture(uSlope, vec2(h1.x, h1.y)).rg;
  return g0.y * (g0.x * a + g1.x * b) + g1.y * (g0.x * c + g1.x * d);
}

float lamp(vec2 p, vec2 center, vec2 size, float soft) {
  vec2 grown = size + soft;
  vec2 q = (p - center) / grown;
  q *= q;
  float d = sqrt(sqrt(dot(q, q)));
  float edge = soft / min(grown.x, grown.y);
  float shape = (1.0 - smoothstep(1.0 - edge, 1.0 + edge, d)) * (1.0 - 0.45 * d * d);
  return shape * size.x * size.y / (grown.x * grown.y);
}

vec3 studio(vec3 r, float blur) {
  vec2 p = r.xy / max(r.z + 1.0, 0.05);
  p += uShift * smoothstep(0.3, 1.0, length(p));
  float radius = length(p);
  float soft = 0.008 + blur;
  vec2 dir = p / max(radius, 1e-3);
  float key = lamp(p, vec2(-0.25, 0.42), vec2(0.3, 0.12), soft);
  float side = lamp(p, vec2(0.48, 0.12), vec2(0.06, 0.3), soft);
  float ground = lamp(p, vec2(-0.1, -0.55), vec2(0.45, 0.06), soft);
  float rise = smoothstep(-1.0, 1.0, dir.y);
  if (uLight > 0.5) {
    float edge = 0.008 + blur * 0.8;
    float lobe = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(atan(dir.y, dir.x) * 2.0 + 0.9));
    float tone = mix(2.4, 0.95, smoothstep(0.5 - edge, 1.0 + edge, radius));
    tone = mix(tone, 0.02, smoothstep(0.98 - edge, 1.12 + edge, radius));
    tone = mix(tone, mix(0.03, 0.3, lobe) * (0.8 + 0.4 * rise), smoothstep(1.15 - edge, 1.3 + edge, radius));
    float width = 0.035 + edge;
    tone += 2.4 * exp(-pow((radius - 1.4) / width, 2.0)) * min(1.0, 0.06 / width) * (0.6 + 0.4 * rise);
    return vec3(tone) * (1.0 - 0.5 * side) * (1.0 - 0.3 * ground) + 0.8 * key;
  }
  float width = 0.015 + soft * 2.0;
  float rim = exp(-abs(radius - 1.0) / width) * 0.031 / width * (0.8 + smoothstep(-0.5, 0.8, p.y));
  float band = 1.0 - 0.95 * smoothstep(1.04 - soft, 1.12 + soft, radius);
  float wall = smoothstep(1.25, 1.55, radius) * (0.6 + 0.4 * rise);
  float streak = smoothstep(0.2, 0.8, 0.5 + 0.5 * sin(atan(dir.y, dir.x) * 3.0 + 0.6));
  vec3 color = vec3(0.004, 0.004, 0.005) + 0.02 * smoothstep(-0.4, 0.6, p.y);
  color += vec3(1.0, 0.97, 0.94) * key * 4.0 + vec3(0.9, 0.95, 1.0) * side * 3.0 + ground * 1.2;
  color += vec3(1.0, 0.98, 0.95) * rim;
  color *= band;
  return color + vec3(mix(0.45, 1.8, streak)) * wall;
}

vec3 shade(vec2 slope, vec3 v, float blur, vec3 f0) {
  float steep = length(slope);
  slope *= 3.0 * tanh(steep / 3.0) / max(steep, 1e-6);
  vec3 n = normalize(vec3(-slope, 1.0));
  vec3 r = reflect(v, n);
  float facing = clamp(dot(n, -v), 0.0, 1.0);
  return studio(r, blur) * (f0 + (1.0 - f0) * pow(1.0 - facing, 5.0));
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (2.0 * frag - uResolution) / uUnit;
  vec2 p = uv;
  vec2 rowX = vec2(1.0, 0.0);
  vec2 rowY = vec2(0.0, 1.0);
  float amplitude = uAmplitude * uPresence;
  for (float i = 1.0; i < 9.0; i++) {
    if (i > uDetail) break;
    float a = amplitude / i;
    float soften = exp(0.3 - 0.3 * i);
    float argX = i * uFrequency.x * p.y + uTime;
    p.x += a * cos(argX);
    rowX -= a * sin(argX) * i * uFrequency.x * soften * rowY;
    float argY = i * uFrequency.y * p.x + uTime;
    p.y += a * cos(argY);
    rowY -= a * sin(argY) * i * uFrequency.y * soften * rowX;
  }
  float phase = uTime - p.x - p.y;
  vec2 field = -(rowX + rowY);
  float density = max(length(field), 1e-3);
  vec2 across = field / density;
  float k = uSharpness;
  float sn = sin(phase);
  float cs = cos(phase);
  float th = tanh(k * sn);
  float bevel = (1.0 - th * th) / tanh(k);
  float fade = smoothstep(3.0, 9.0, 3.14159 * uUnit / density);
  float weight = uDepth * uPresence * fade;
  vec2 slope = k * cs * bevel * weight * across + slopeAt(frag / uResolution) * uRipple;
  vec2 sweep = -k * bevel * (sn + 2.0 * k * cs * cs * th) * weight * density * 2.0 / uUnit * across;
  vec2 stepX = dFdx(slope);
  vec2 stepY = dFdy(slope);
  vec2 crease = dot(stepX, stepX) > dot(stepY, stepY) ? stepX : stepY;
  if (dot(crease, crease) > dot(sweep, sweep)) sweep = crease;
  float bend = length(sweep);
  float alpha = smoothstep(0.0, 0.1, length(slope));
  vec3 f0 = mix(vec3(1.0), uTint, smoothstep(0.05, 0.6, length(slope))) * 0.92;
  vec3 v = normalize(vec3(uv * 0.08, -1.0));
  float blur = uRoughness * 0.35;
  vec3 light;
  if (bend < 0.01) {
    light = shade(slope, v, blur + bend * 0.5, f0);
  } else {
    light = vec3(0.0);
    for (float t = -0.375; t < 0.4; t += 0.25) {
      light += shade(slope + sweep * t, v, blur + bend * 0.15, f0);
    }
    light *= 0.25;
  }
  vec3 color = pow(aces(light * uExposure), vec3(1.0 / 2.2));
  float grain = fract(52.9829189 * fract(dot(frag, vec2(0.06711056, 0.00583715))));
  color += (grain - 0.5) / 255.0;
  fragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`

export function liquidChrome(container, o = {}) {
  const s = { tint: hexRgb(o.color || '#ffffff').map(c => Math.pow(c, 2.2)), speed: .2, amplitude: .3, frequency: [3, 3], detail: 4, thickness: 1, depth: 1, roughness: .3, exposure: 1,
    interactive: true, rippleStrength: 1, rippleSize: 1, tilt: 1, intro: true, maxRatio: 2, ...o }
  const canvas = document.createElement('canvas'); canvas.className = 'rb-canvas'; canvas.setAttribute('aria-hidden', 'true'); container.appendChild(canvas)
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' })
  const chrome = gl && link(gl, L_VERTEX, L_CHROME)
  if (!chrome) return
  const fluid = !!gl.getExtension('EXT_color_buffer_float'), sim = fluid ? link(gl, L_VERTEX, L_SIM) : null, slope = fluid ? link(gl, L_VERTEX, L_SLOPE) : null
  const red = reduced(), vao = gl.createVertexArray(), grid = { width: 1, height: 1 }, targets = [], strokes = []
  const ptr = { x: 0, y: 0, inside: false, ready: false, nx: 0, ny: 0 }, view = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 }
  let slopeTarget = null, current = 0, unit = 1, time = Math.random() * 40, presence = s.intro && !red ? 0 : 1, energy = 0, acc = 0, raf = 0, last = 0, visible = false
  const makeTarget = (w, h) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, w, h, 0, gl.RG, gl.HALF_FLOAT, null)
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v)
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return { texture: t, framebuffer: fb }
  }
  const drop = t => { if (t) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.framebuffer) } }
  const resize = () => {
    const r = container.getBoundingClientRect(), cw = Math.max(1, r.width), ch = Math.max(1, r.height)
    const ratio = Math.min(devicePixelRatio || 1, s.maxRatio, Math.sqrt(L_PIXEL_BUDGET / (cw * ch)))
    canvas.width = Math.max(1, Math.round(cw * ratio)); canvas.height = Math.max(1, Math.round(ch * ratio)); unit = Math.min(canvas.width, canvas.height)
    if (!sim || !slope) return
    const gw = clamp(Math.round(cw / L_SIM_CELL), 16, 512), gh = clamp(Math.round(ch / L_SIM_CELL), 16, 512)
    if (gw === grid.width && gh === grid.height && targets.length) return
    targets.forEach(drop); targets.length = 0; drop(slopeTarget)
    Object.assign(grid, { width: gw, height: gh }); targets.push(makeTarget(gw, gh), makeTarget(gw, gh)); slopeTarget = makeTarget(gw, gh)
  }
  const simulate = steps => {
    gl.useProgram(sim.program); gl.viewport(0, 0, grid.width, grid.height); gl.uniform2f(sim.uniforms.uSize, grid.width, grid.height); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(sim.uniforms.uState, 0)
    for (let i = 0; i < steps; i++) {
      const k = i === 0 ? strokes.shift() : null
      if (k) { gl.uniform4f(sim.uniforms.uStroke, k.ax, k.ay, k.bx, k.by); gl.uniform2f(sim.uniforms.uImpulse, k.strength, k.radius) } else gl.uniform2f(sim.uniforms.uImpulse, 0, 1)
      gl.bindTexture(gl.TEXTURE_2D, targets[current].texture); gl.bindFramebuffer(gl.FRAMEBUFFER, targets[1 - current].framebuffer); gl.drawArrays(gl.TRIANGLES, 0, 3); current = 1 - current
    }
    gl.useProgram(slope.program); gl.uniform2f(slope.uniforms.uSize, grid.width, grid.height); gl.uniform1i(slope.uniforms.uState, 0)
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture); gl.bindFramebuffer(gl.FRAMEBUFFER, slopeTarget.framebuffer); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  const render = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height)
    const u = chrome.uniforms; gl.useProgram(chrome.program)
    gl.uniform2f(u.uResolution, canvas.width, canvas.height); gl.uniform1f(u.uUnit, unit); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uAmplitude, s.amplitude)
    gl.uniform2f(u.uFrequency, s.frequency[0], s.frequency[1]); gl.uniform1f(u.uDepth, s.depth); gl.uniform1f(u.uDetail, s.detail); gl.uniform1f(u.uSharpness, 5 / (3 * s.thickness))
    gl.uniform1f(u.uPresence, 1 - Math.pow(1 - presence, 3)); gl.uniform3fv(u.uTint, s.tint); gl.uniform2f(u.uShift, view.yaw, view.pitch); gl.uniform1f(u.uRoughness, s.roughness)
    gl.uniform1f(u.uExposure, s.exposure); gl.uniform1f(u.uLight, 0); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, slopeTarget ? slopeTarget.texture : null)
    gl.uniform1i(u.uSlope, 0); gl.uniform2f(u.uSlopeSize, grid.width, grid.height); gl.uniform1f(u.uRipple, slopeTarget ? s.rippleStrength * 2.2 : 0); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  const frame = now => {
    raf = 0
    const dt = clamp((now - last) / 1000 || 0, 0, .05); last = Math.max(last, now)
    time += dt * s.speed * (red ? .25 : 1); presence = Math.min(1, presence + dt / 1.8)
    const hov = s.interactive && ptr.inside, reach = red ? 0 : s.tilt
    const ty = (hov ? ptr.nx * .35 : .22 * Math.sin(time * 1.3)) * reach, tp = (hov ? -ptr.ny * .28 : .16 * Math.sin(time * .9 + 1.7)) * reach
    const k = 36, damp = 2 * Math.sqrt(k) * .95
    view.vyaw += ((ty - view.yaw) * k - view.vyaw * damp) * dt; view.vpitch += ((tp - view.pitch) * k - view.vpitch * damp) * dt
    view.yaw += view.vyaw * dt; view.pitch += view.vpitch * dt
    gl.bindVertexArray(vao)
    if (slopeTarget) { acc += dt; const steps = Math.min(4, Math.floor(acc / L_SIM_STEP)); acc -= steps * L_SIM_STEP; if (steps > 0) { simulate(steps); energy = Math.max(0, energy * Math.pow(.982, steps)) } }
    render()
    if (visible && !document.hidden) raf = requestAnimationFrame(frame)
  }
  const wake = () => { if (raf || !visible || document.hidden) return; last = performance.now(); raf = requestAnimationFrame(frame) }
  const toGrid = (x, y) => { const r = container.getBoundingClientRect(); return { x: (x - r.left) / r.width * grid.width, y: (1 - (y - r.top) / r.height) * grid.height, nx: (x - r.left) / r.width * 2 - 1, ny: (y - r.top) / r.height * 2 - 1, inside: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom } }
  const push = k => { if (!slopeTarget || !s.interactive || red) return; strokes.push(k); if (strokes.length > 6) strokes.shift(); energy = 1 }
  addEventListener('pointermove', e => {
    const p = toGrid(e.clientX, e.clientY); ptr.nx = clamp(p.nx, -1, 1); ptr.ny = clamp(p.ny, -1, 1); ptr.inside = p.inside
    if (p.inside && ptr.ready) { const t = Math.hypot(p.x - ptr.x, p.y - ptr.y); if (t > .25) push({ ax: ptr.x, ay: ptr.y, bx: p.x, by: p.y, strength: -Math.min(.45, .04 + t * .045) * s.rippleSize, radius: 4 * s.rippleSize }) }
    ptr.x = p.x; ptr.y = p.y; ptr.ready = p.inside; wake()
  }, { passive: true })
  addEventListener('pointerdown', e => { const p = toGrid(e.clientX, e.clientY); if (p.inside) { push({ ax: p.x, ay: p.y, bx: p.x, by: p.y, strength: -1.6 * s.rippleSize, radius: 6 * s.rippleSize }); wake() } }, { passive: true })
  new ResizeObserver(() => { resize(); wake() }).observe(container)
  new IntersectionObserver(es => { visible = es.some(e => e.isIntersecting); wake() }).observe(container)
  document.addEventListener('visibilitychange', wake)
  resize()
}

// ---------------- BlurText: words sharpen out of a blur, one after another ----------------
export function blurText(el, { delay = 90, blur = 10, distance = 34 } = {}) {
  const words = el.textContent.trim().split(/\s+/)
  el.textContent = ''
  const spans = words.map((w, i) => { const sp = document.createElement('span'); sp.className = 'rb-word'; sp.textContent = w; el.append(sp, i < words.length - 1 ? ' ' : ''); return sp })
  if (reduced()) return
  spans.forEach(sp => { sp.style.opacity = 0 })
  new IntersectionObserver((es, o) => {
    if (!es[0].isIntersecting) return
    o.disconnect()
    spans.forEach((sp, i) => sp.animate([
      { filter: `blur(${blur}px)`, opacity: 0, transform: `translateY(${-distance}px)` },
      { filter: `blur(${blur / 2}px)`, opacity: .5, transform: `translateY(${distance / 10}px)`, offset: .5 },
      { filter: 'blur(0px)', opacity: 1, transform: 'none' }], { duration: 900, delay: i * delay, easing: 'cubic-bezier(.22,.8,.2,1)', fill: 'forwards' }))
  }, { threshold: .3 }).observe(el)
}

// ---------------- SpotlightCard: a soft light that follows the pointer, plus a lit edge ----------------
export function spotlightCards(selector) {
  document.querySelectorAll(selector).forEach(card => {
    card.classList.add('rb-spot')
    for (const c of ['rb-spot__light', 'rb-spot__border', 'rb-spot__edge']) { const d = document.createElement('span'); d.className = c; card.appendChild(d) }
    card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); card.style.setProperty('--sx', (e.clientX - r.left) + 'px'); card.style.setProperty('--sy', (e.clientY - r.top) + 'px') })
  })
}
