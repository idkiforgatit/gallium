# Builds glcheck.html: the intro's real shader, drawn once, with its pixels read back (for checking WebGL on macOS)
import re
s = open('src/index.html', encoding='utf-8').read()
frag = re.search(r'const FRAG = `(.*?)`', s, re.S).group(1)
page = '''<!doctype html><canvas id=c width=800 height=500></canvas><img id=w src="wall.jpg"><script>
const FRAG = `''' + frag + '''`
const out = {}, cv = document.getElementById('c'), gl = cv.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
out.gl = !!gl; out.renderer = gl && gl.getParameter(gl.RENDERER)
const sh = (t, src) => { const x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) out.compile = gl.getShaderInfoLog(x); return x }
const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}')); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(p)
out.linked = gl.getProgramParameter(p, gl.LINK_STATUS); gl.useProgram(p)
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW)
gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
const U = k => gl.getUniformLocation(p, k)
function draw(tag, t) {
  gl.viewport(0, 0, 800, 500); gl.uniform1f(U('t'), t); gl.uniform1f(U('f'), 0); gl.uniform2f(U('R'), 800, 500); gl.uniform1i(U('env'), 0)
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3)
  const px = new Uint8Array(4), pts = {}
  for (const [n, x, y] of [['center', 400, 250], ['drop', 400, 300], ['corner', 40, 40], ['side', 150, 250]]) { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); pts[n] = [...px] }
  out[tag] = pts; out[tag + '_err'] = gl.getError()
}
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([90, 90, 100, 255]))
draw('grey_t6', 6)
const img = document.getElementById('w')
img.decode().then(() => {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; c.getContext('2d').drawImage(img, 0, 0, 1024, 512)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c); gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  draw('wall_t1', 1); draw('wall_t6', 6)
}).catch(e => out.imgerr = String(e)).finally(() => { document.title = 'DONE ' + JSON.stringify(out) })
</script>'''
open('glcheck.html', 'w', encoding='utf-8').write(page)
