import { useEffect, useRef, type RefObject } from 'react'

// '#rrggbb' / 'rgb(r, g, b)' / 'rgba(r, g, b, a)' を [0,1] の RGB に正規化。
// CSS @property で <color> 型として登録された変数は getComputedStyle が
// rgb(...) 形式で返すため、hex だけでなく rgb もパースする必要がある。
function parseCssColor(raw: string): [number, number, number] | null {
  const s = raw.trim()
  if (s.startsWith('#') && s.length === 7) {
    return [
      parseInt(s.slice(1, 3), 16) / 255,
      parseInt(s.slice(3, 5), 16) / 255,
      parseInt(s.slice(5, 7), 16) / 255,
    ]
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/)
  if (m) {
    const r = parseFloat(m[1])
    const g = parseFloat(m[2])
    const b = parseFloat(m[3])
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return [r / 255, g / 255, b / 255]
    }
  }
  return null
}

// Hardcoded peak shape exported from /shape-editor (anchors normalised to NORM_R=80).
const KAPPA = 0.5522847498
const NORM_R = 80
const N = 32 // tessellated polygon vertex count (4 anchors × 8 samples)

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

// Mirror PEAK_RIGHT across X. Naive negation reverses traversal direction
// (CW → CCW) and — more importantly — sends anchor[1] (REST's right-side
// neighbour) all the way across to the left, so lerping REST → PEAK_LEFT
// makes anchors[1] and [3] cross through the centre, producing a "twist/flip"
// during deform decay. Reorder the mirrored anchors as [0, 3, 2, 1] (and swap
// handleIn/handleOut at each anchor since traversal direction reverses) so each
// PEAK_LEFT[i] stays on the same side as REST[i].
const PEAK_LEFT: Anchor[] = [0, 3, 2, 1].map(i => {
  const a = PEAK_RIGHT[i]
  return {
    pos: { x: -a.pos.x, y: a.pos.y },
    handleIn: { x: -a.handleOut.x, y: a.handleOut.y },
    handleOut: { x: -a.handleIn.x, y: a.handleIn.y },
  }
})

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
#define N 32
uniform vec2 u_res;
uniform float u_dpr;
uniform vec4 u_rect;
uniform vec4 u_radii;
uniform vec2 u_blob[N];
uniform vec3 u_color;
uniform float u_k;
// joystick の center / handle 円。xyz = (cx, cy, radius)、w = visible flag (0/1)。
// w=0 のときは smin の対象外。WebGL に統合して SVG filter 由来の env 依存を排除。
uniform vec4 u_jCenter;
uniform vec4 u_jHandle;

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

float sdCircle(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// w (visibility) が 0 なら d を非常に大きくして smin の影響をゼロにする。
float sdMaybeCircle(vec2 p, vec4 c) {
  float d = sdCircle(p, c.xy, c.z);
  return mix(1e6, d, step(0.5, c.w));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / u_dpr, u_res.y - gl_FragCoord.y / u_dpr);
  vec2 rc = u_rect.xy + u_rect.zw * 0.5;
  vec2 rh = u_rect.zw * 0.5;
  float dRect = sdRoundedBox(p - rc, rh, u_radii);
  float dBlob = sdPolygon(p);
  float dJC = sdMaybeCircle(p, u_jCenter);
  float dJH = sdMaybeCircle(p, u_jHandle);
  float d = smin(dRect, dBlob, u_k);
  d = smin(d, dJC, u_k);
  d = smin(d, dJH, u_k);
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(u_color, alpha);
}
`

/** Right-leaning peak anchors in editor-normalised coords (R = 80). */
export interface PeakAnchorTuple {
  pos: [number, number]
  handleIn: [number, number]
  handleOut: [number, number]
}

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  fabRef: RefObject<HTMLElement | null>
  sheetRef: RefObject<HTMLElement | null>
  /** Live ref to armed flag — when true, blob stays a perfect rest circle and only follows FAB scale. */
  armedRef: RefObject<boolean>
  /** Live ref to "joystick armed" flag. When true, the FAB peak smoothly
   *  shrinks away (scale → 0) so the joystick handle visually takes over the
   *  petamp circle. */
  peakHiddenRef?: RefObject<boolean>
  /** Live ref to a stored FAB rect (= arm 時点の元位置)。設定されている間は
   *  peak を live の FAB 位置ではなくこの固定位置に描画する。disarm 中の
   *  FAB slide-up と independent に peak を元位置に出して handle の
   *  flyback target と揃えるための仕組み。 */
  peakRectOverrideRef?: RefObject<DOMRect | null>
  peakVelocity?: number
  /** Right-leaning peak override (shape-editor のリアルタイムプレビュー用)。
   *  渡されなければ PEAK_RIGHT デフォルトを使う。length 4 を前提。 */
  peakAnchors?: readonly PeakAnchorTuple[]
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

export function useMetaballSheet({ canvasRef, fabRef, sheetRef, armedRef, peakHiddenRef, peakRectOverrideRef, peakVelocity = 6, peakAnchors }: Options) {
  // peakAnchors を hook 内部の Pt 形式に変換し、ref 経由で draw に渡す。
  // ref 化することで peakAnchors が変わっても useEffect (WebGL 初期化) を
  // 再実行せず、次フレームから新しい peak で描画される。
  const peakOverrideRef = useRef<Anchor[] | null>(null)
  // eslint-disable-next-line react-hooks/refs
  peakOverrideRef.current = peakAnchors && peakAnchors.length === 4
    ? peakAnchors.map(a => ({
        pos: { x: a.pos[0], y: a.pos[1] },
        handleIn: { x: a.handleIn[0], y: a.handleIn[1] },
        handleOut: { x: a.handleOut[0], y: a.handleOut[1] },
      }))
    : null
  useEffect(() => {
    const canvas = canvasRef.current
    const fab = fabRef.current
    const sheet = sheetRef.current
    if (!canvas || !fab || !sheet) return

    // ブラウザ側でキャンバスを premultiplied として合成させる。
    // blendFuncSeparate と組み合わせて FB を (C·α, α) に揃えると、画面上は
    // C·α + B·(1-α) で straight-alpha 相当の正しいエッジになる。
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true })
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
    const uJCenter = gl.getUniformLocation(program, 'u_jCenter')
    const uJHandle = gl.getUniformLocation(program, 'u_jHandle')

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

    const radius = 24
    const k = 24

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    // RGB は straight-alpha 合成、Alpha は累積で α² にならないよう分離。
    // (context は premultipliedAlpha:false なのでブラウザ側で unpremul される)
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,       gl.ONE_MINUS_SRC_ALPHA,
    )
    gl.clearColor(0, 0, 0, 0)
    gl.uniform4f(uRadii, radius, 0, radius, 0)
    gl.uniform1f(uK, k)

    // --accent をフレーム間でキャッシュ。テーマ変化があれば uniform を更新。
    // @property で <color> 型として登録された CSS 変数は getComputedStyle で
    // rgb(r, g, b) 形式に正規化されるため、hex と rgb の両方をパースする。
    // また @property の transition 補間中は値が毎フレーム変化するので、その
    // 度に uniform を更新したい。
    let lastAccentRaw = ''
    let cachedColor: [number, number, number] = [28 / 255, 151 / 255, 94 / 255]
    const refreshAccent = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (raw === lastAccentRaw) return
      lastAccentRaw = raw
      const parsed = parseCssColor(raw)
      if (parsed) cachedColor = parsed
      gl.uniform3f(uColor, cachedColor[0], cachedColor[1], cachedColor[2])
    }
    refreshAccent()

    const blobBuf = new Float32Array(N * 2)

    // Velocity / deform state.
    const st = {
      prevX: 0,
      velocity: 0,
      deform: 0,
      direction: 1 as 1 | -1,
      initialised: false,
      // peakHiddenRef を反映する 0..1 のスムージング値。joystick armed 中は
      // 0 に向かって縮み、解除されると 1 に戻る。
      peakScale: 1,
      // debug frame counter
      dbgFrame: 0,
    }

    let rafId: number | null = null

    const draw = () => {
      refreshAccent()
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
      // peak rect の決定:
      //   1. peakRectOverrideRef が設定されていれば固定位置 (joystick disarm 中の旧仕様)
      //   2. それ以外で、MapJoystick の handle 要素が可視中 (opacity > 0) なら
      //      handle の rect を使う → peak が常に handle と同位置・同サイズで
      //      重なり、disarm 中ずっと「ひとつの円」のように見える
      //   3. fallback: live の FAB 位置
      let fRect: DOMRect
      const peakOverride = peakRectOverrideRef?.current
      if (peakOverride) {
        fRect = peakOverride
      } else {
        const handleEl = document.querySelector('.map-joystick-handle')
        if (handleEl instanceof HTMLElement &&
            parseFloat(getComputedStyle(handleEl).opacity) > 0.001) {
          fRect = handleEl.getBoundingClientRect()
        } else {
          fRect = fab.getBoundingClientRect()
        }
      }
      const cx = fRect.left + fRect.width / 2
      const cy = fRect.top + fRect.height / 2
      const fabRadius = Math.min(fRect.width, fRect.height) / 2
      // peak の表示倍率: joystick armed 中は 0、idle で 1。lerp すると
      // petamp の fly-in 中 に peak がまだ縮みきってなくて二重に見えるので
      // snap (即座に切り替え)。joystick handle 側で scale animation するので
      // この snap は連続した「ひとつの円が動く」演出にとっての要。
      st.peakScale = peakHiddenRef?.current ? 0 : 1
      const scale = (fabRadius / NORM_R) * st.peakScale

      // Velocity (px/frame). Low-pass to suppress single-frame jitter.
      let v = 0
      if (st.initialised) v = cx - st.prevX
      st.prevX = cx
      st.initialised = true
      st.velocity = st.velocity * 0.7 + v * 0.3

      // Direction change → snap deform to 0 unconditionally so the new lean
      // builds back up from rest (no PEAK_RIGHT↔PEAK_LEFT direct lerp).
      // Hysteresis: require sustained velocity to flip, so end-of-motion noise
      // around 0 doesn't keep flipping direction.
      const VEL_FLIP_THRESHOLD = 1.5
      if (Math.abs(st.velocity) > VEL_FLIP_THRESHOLD) {
        const newDir = st.velocity > 0 ? 1 : -1
        if (newDir !== st.direction) {
          st.direction = newDir
          st.deform = 0
        }
      }

      let targetDeform = Math.min(1, Math.abs(st.velocity) / peakVelocity)
      if (armedRef.current) targetDeform = 0
      const easeK = targetDeform > st.deform ? 0.35 : 0.18
      st.deform += (targetDeform - st.deform) * easeK

      // peakOverride があれば優先 (shape-editor のライブプレビュー用)。
      // 左右 mirror をその場で生成する (毎フレームの追加コストは小さい)。
      const override = peakOverrideRef.current
      const baseRight: Anchor[] = override ?? PEAK_RIGHT
      const baseLeft: Anchor[] = override
        ? [0, 3, 2, 1].map(i => {
            const a = baseRight[i]
            return {
              pos: { x: -a.pos.x, y: a.pos.y },
              handleIn: { x: -a.handleOut.x, y: a.handleOut.y },
              handleOut: { x: -a.handleIn.x, y: a.handleIn.y },
            }
          })
        : PEAK_LEFT
      const peak = st.direction > 0 ? baseRight : baseLeft
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
      // joystick circle uniforms は per-joystick canvas に移行したので
      // ここでは無効化 (0, 0, 0, 0) のまま。
      gl.uniform4f(uJCenter, 0, 0, 0, 0)
      gl.uniform4f(uJHandle, 0, 0, 0, 0)

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
  }, [canvasRef, fabRef, sheetRef, armedRef, peakHiddenRef, peakRectOverrideRef, peakVelocity])
}
