import { useEffect, type RefObject } from 'react'

// Hardcoded peak shape exported from /shape-editor (anchors normalised to NORM_R=80).
const KAPPA = 0.5522847498
const NORM_R = 80
const N = 16 // tessellated polygon vertex count (4 anchors × 4 samples)

interface Pt { x: number; y: number }
interface Anchor { pos: Pt; handleIn: Pt; handleOut: Pt }

const REST: Anchor[] = [
  { pos: { x: 0, y: -NORM_R }, handleIn: { x: -NORM_R * KAPPA, y: 0 }, handleOut: { x: NORM_R * KAPPA, y: 0 } },
  { pos: { x: NORM_R, y: 0 }, handleIn: { x: 0, y: -NORM_R * KAPPA }, handleOut: { x: 0, y: NORM_R * KAPPA } },
  { pos: { x: 0, y: NORM_R }, handleIn: { x: NORM_R * KAPPA, y: 0 }, handleOut: { x: -NORM_R * KAPPA, y: 0 } },
  { pos: { x: -NORM_R, y: 0 }, handleIn: { x: 0, y: NORM_R * KAPPA }, handleOut: { x: 0, y: -NORM_R * KAPPA } },
]

const PEAK_RIGHT: Anchor[] = [
  { pos: { x: 45.8, y: -89.79 }, handleIn: { x: -58.46, y: -0.14 }, handleOut: { x: 50, y: 0 } },
  { pos: { x: 68.77, y: 28.19 }, handleIn: { x: 51.1, y: -37.04 }, handleOut: { x: -41.43, y: 32.52 } },
  { pos: { x: -72.67, y: 66.83 }, handleIn: { x: 44.18, y: 0 }, handleOut: { x: -44.18, y: 0 } },
  { pos: { x: -85.8, y: -0.41 }, handleIn: { x: -52.48, y: -1.13 }, handleOut: { x: 46.62, y: 1.42 } },
]

const PEAK_LEFT: Anchor[] = PEAK_RIGHT.map(a => ({
  pos: { x: -a.pos.x, y: a.pos.y },
  handleIn: { x: -a.handleIn.x, y: a.handleIn.y },
  handleOut: { x: -a.handleOut.x, y: a.handleOut.y },
}))

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }
function lerpPt(a: Pt, b: Pt, t: number): Pt { return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) } }
function lerpAnchor(a: Anchor, b: Anchor, t: number): Anchor {
  return {
    pos: lerpPt(a.pos, b.pos, t),
    handleIn: lerpPt(a.handleIn, b.handleIn, t),
    handleOut: lerpPt(a.handleOut, b.handleOut, t),
  }
}

// Tessellate 4 cubic-bezier segments into N world-space vertices.
function tessellate(anchors: Anchor[], cx: number, cy: number, scale: number, out: Float32Array) {
  const samplesPerSeg = N / 4
  let idx = 0
  for (let i = 0; i < 4; i++) {
    const cur = anchors[i]
    const next = anchors[(i + 1) % 4]
    const p0x = cur.pos.x, p0y = cur.pos.y
    const p1x = cur.pos.x + cur.handleOut.x, p1y = cur.pos.y + cur.handleOut.y
    const p2x = next.pos.x + next.handleIn.x, p2y = next.pos.y + next.handleIn.y
    const p3x = next.pos.x, p3y = next.pos.y
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg
      const u = 1 - t
      const x = u * u * u * p0x + 3 * u * u * t * p1x + 3 * u * t * t * p2x + t * t * t * p3x
      const y = u * u * u * p0y + 3 * u * u * t * p1y + 3 * u * t * t * p2y + t * t * t * p3y
      out[idx++] = cx + x * scale
      out[idx++] = cy + y * scale
    }
  }
}

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
precision mediump float;
#define N 16
uniform vec2 u_res;
uniform float u_dpr;
uniform vec4 u_rect;
uniform vec4 u_radii;
uniform vec2 u_blob[N];
uniform vec3 u_color;
uniform float u_k;

float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
  vec2 rx = (p.x > 0.0) ? r.xy : r.zw;
  float radius = (p.y < 0.0) ? rx.x : rx.y;
  vec2 q = abs(p) - b + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

float sdPolygon(vec2 p) {
  float dSq = dot(p - u_blob[0], p - u_blob[0]);
  float s = 1.0;
  vec2 vPrev = u_blob[N - 1];
  for (int i = 0; i < N; i++) {
    vec2 vCur = u_blob[i];
    vec2 e = vPrev - vCur;
    vec2 w = p - vCur;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    dSq = min(dSq, dot(b, b));
    bvec3 c = bvec3(p.y >= vCur.y, p.y < vPrev.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
    vPrev = vCur;
  }
  return s * sqrt(dSq);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / u_dpr, u_res.y - gl_FragCoord.y / u_dpr);
  vec2 rc = u_rect.xy + u_rect.zw * 0.5;
  vec2 rh = u_rect.zw * 0.5;
  float dRect = sdRoundedBox(p - rc, rh, u_radii);
  float dBlob = sdPolygon(p);
  float d = smin(dRect, dBlob, u_k);
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(u_color, alpha);
}
`

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  fabRef: RefObject<HTMLElement | null>
  sheetRef: RefObject<HTMLElement | null>
  /** Live ref to armed flag — when true, blob stays a perfect rest circle and only follows FAB scale. */
  armedRef: RefObject<boolean>
  peakVelocity?: number
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function parseAccent(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  if (raw.startsWith('#') && raw.length === 7) {
    return [
      parseInt(raw.slice(1, 3), 16) / 255,
      parseInt(raw.slice(3, 5), 16) / 255,
      parseInt(raw.slice(5, 7), 16) / 255,
    ]
  }
  return [28 / 255, 151 / 255, 94 / 255]
}

export function useMetaballSheet({ canvasRef, fabRef, sheetRef, armedRef, peakVelocity = 6 }: Options) {
  useEffect(() => {
    const canvas = canvasRef.current
    const fab = fabRef.current
    const sheet = sheetRef.current
    if (!canvas || !fab || !sheet) return

    const gl = canvas.getContext('webgl', { premultipliedAlpha: false, antialias: true, alpha: true })
    if (!gl) return

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('program link error:', gl.getProgramInfoLog(program))
      return
    }

    const aPos = gl.getAttribLocation(program, 'a_pos')
    const uRes = gl.getUniformLocation(program, 'u_res')
    const uDpr = gl.getUniformLocation(program, 'u_dpr')
    const uRect = gl.getUniformLocation(program, 'u_rect')
    const uRadii = gl.getUniformLocation(program, 'u_radii')
    const uBlob = gl.getUniformLocation(program, 'u_blob[0]')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uK = gl.getUniformLocation(program, 'u_k')

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

    const color = parseAccent()
    const radius = 24
    const k = 24

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    gl.uniform3f(uColor, color[0], color[1], color[2])
    gl.uniform4f(uRadii, radius, 0, radius, 0)
    gl.uniform1f(uK, k)

    const blobBuf = new Float32Array(N * 2)

    // Velocity / deform state.
    const st = {
      prevX: 0,
      velocity: 0,
      deform: 0,
      direction: 1 as 1 | -1,
      initialised: false,
    }

    let rafId: number | null = null

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = window.innerWidth
      const h = window.innerHeight
      const dw = Math.round(w * dpr)
      const dh = Math.round(h * dpr)
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw
        canvas.height = dh
        gl.viewport(0, 0, dw, dh)
      }

      const sRect = sheet.getBoundingClientRect()
      const fRect = fab.getBoundingClientRect()
      const cx = fRect.left + fRect.width / 2
      const cy = fRect.top + fRect.height / 2
      const fabRadius = Math.min(fRect.width, fRect.height) / 2
      const scale = fabRadius / NORM_R

      // Velocity (px/frame). Low-pass to suppress single-frame jitter.
      let v = 0
      if (st.initialised) v = cx - st.prevX
      st.prevX = cx
      st.initialised = true
      st.velocity = st.velocity * 0.7 + v * 0.3

      // Direction change while still deformed → snap deform to 0 to avoid the
      // mirrored-anchor "flip" lerp. New lean builds back up from rest.
      const wantedDir = Math.abs(st.velocity) > 0.1
        ? (st.velocity > 0 ? 1 : -1)
        : st.direction
      if (wantedDir !== st.direction && st.deform > 0.05) {
        st.deform = 0
      }
      st.direction = wantedDir

      let targetDeform = Math.min(1, Math.abs(st.velocity) / peakVelocity)
      if (armedRef.current) targetDeform = 0
      const easeK = targetDeform > st.deform ? 0.35 : 0.18
      st.deform += (targetDeform - st.deform) * easeK

      const peak = st.direction > 0 ? PEAK_RIGHT : PEAK_LEFT
      const blob = REST.map((r, i) => lerpAnchor(r, peak[i], st.deform))
      tessellate(blob, cx, cy, scale, blobBuf)

      // Scissor box: cover sheet rect + bbox of all blob vertices, padded for blur.
      let blobMinX = Infinity, blobMinY = Infinity, blobMaxX = -Infinity, blobMaxY = -Infinity
      for (let i = 0; i < blobBuf.length; i += 2) {
        const x = blobBuf[i], y = blobBuf[i + 1]
        if (x < blobMinX) blobMinX = x
        if (y < blobMinY) blobMinY = y
        if (x > blobMaxX) blobMaxX = x
        if (y > blobMaxY) blobMaxY = y
      }
      const margin = k + radius + 4
      const minX = Math.max(0, Math.min(sRect.left, blobMinX) - margin)
      const maxX = Math.min(w, Math.max(sRect.right, blobMaxX) + margin)
      const minY = Math.max(0, Math.min(sRect.top, blobMinY) - margin)
      const maxY = Math.min(h, Math.max(sRect.bottom + 4, blobMaxY) + margin)

      gl.disable(gl.SCISSOR_TEST)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const ssw = Math.max(0, Math.ceil((maxX - minX) * dpr))
      const ssh = Math.max(0, Math.ceil((maxY - minY) * dpr))
      if (ssw === 0 || ssh === 0) return

      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(Math.floor(minX * dpr), Math.floor((h - maxY) * dpr), ssw, ssh)

      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4f(uRect, sRect.left, sRect.top, sRect.width, sRect.height + 4)
      gl.uniform2fv(uBlob, blobBuf)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const tick = () => {
      draw()
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)

    const onResize = () => requestAnimationFrame(draw)
    window.addEventListener('resize', onResize)

    const ro = new ResizeObserver(() => requestAnimationFrame(draw))
    ro.observe(fab)
    ro.observe(sheet)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      ro.disconnect()
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [canvasRef, fabRef, sheetRef, armedRef, peakVelocity])
}
