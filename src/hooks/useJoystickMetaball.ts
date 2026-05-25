import { useEffect, type RefObject } from 'react'

// MapJoystick の center + handle 円を smin merge して描画する per-joystick
// WebGL canvas のレンダラー。canvas は button の中に配置されるので、面・
// アイコンと自然な z-index 関係になる (canvas が button stacking 内 →
// 自然に icon/petamp face の下に来る)。各 joystick インスタンスが独立した
// canvas を持つことで「複数 joystick が画面に存在しても干渉しない」も
// 解決される。

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
precision mediump float;
uniform vec2 u_canvasSize;     // canvas の CSS 上のサイズ (px)
uniform float u_dpr;
uniform vec3 u_color;
uniform float u_k;
uniform vec4 u_center;          // (cx, cy, radius, visible) — canvas-local px
uniform vec4 u_handle;

float sdCircle(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdMaybeCircle(vec2 p, vec4 c) {
  float d = sdCircle(p, c.xy, c.z);
  return mix(1e6, d, step(0.5, c.w));
}

void main() {
  // canvas CSS pixel coord, origin top-left
  vec2 p = vec2(gl_FragCoord.x / u_dpr, u_canvasSize.y - gl_FragCoord.y / u_dpr);
  float dC = sdMaybeCircle(p, u_center);
  float dH = sdMaybeCircle(p, u_handle);
  float d = smin(dC, dH, u_k);
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(u_color, alpha);
}
`

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('joystick metaball shader compile error:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function parseAccent(raw: string): [number, number, number] {
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
    return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255]
  }
  return [28 / 255, 151 / 255, 94 / 255]
}

export function useJoystickMetaball(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  buttonRef: RefObject<HTMLElement | null>,
  centerRef: RefObject<HTMLElement | null>,
  handleRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const canvas = canvasRef.current
    const buttonEl = buttonRef.current
    if (!canvas || !buttonEl) return

    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: true, alpha: true })
    if (!gl) return

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC)
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('joystick metaball program link error:', gl.getProgramInfoLog(program))
      return
    }

    const aPos = gl.getAttribLocation(program, 'a_pos')
    const uCanvasSize = gl.getUniformLocation(program, 'u_canvasSize')
    const uDpr = gl.getUniformLocation(program, 'u_dpr')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uK = gl.getUniformLocation(program, 'u_k')
    const uCenter = gl.getUniformLocation(program, 'u_center')
    const uHandle = gl.getUniformLocation(program, 'u_handle')

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    gl.uniform1f(uK, 24)

    let lastAccentRaw = ''
    let cachedColor: [number, number, number] = [28 / 255, 151 / 255, 94 / 255]
    const refreshAccent = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      if (raw === lastAccentRaw) return
      lastAccentRaw = raw
      cachedColor = parseAccent(raw)
      gl.uniform3f(uColor, cachedColor[0], cachedColor[1], cachedColor[2])
    }
    refreshAccent()

    let rafId: number | null = null

    const queryCircle = (el: HTMLElement | null, btnRect: DOMRect): [number, number, number, number] => {
      if (!el) return [0, 0, 0, 0]
      const opacity = parseFloat(getComputedStyle(el).opacity)
      if (!(opacity > 0.001)) return [0, 0, 0, 0]
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return [0, 0, 0, 0]
      // canvas-local coord = screen coord - canvas top-left.
      // canvas top-left = canvasRect.left/top. But canvas is inside button
      // with inset:-X; canvas size differs from button.
      // Compute canvas rect each frame.
      const cnvRect = canvas.getBoundingClientRect()
      const cxLocal = r.left + r.width / 2 - cnvRect.left
      const cyLocal = r.top + r.height / 2 - cnvRect.top
      const radius = Math.min(r.width, r.height) / 2
      // Buttonに対する相対位置を保ったまま使う (btnRect は将来 visibility 判定
      // 用に取っておく)
      void btnRect
      return [cxLocal, cyLocal, radius, 1]
    }

    const draw = () => {
      refreshAccent()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      const dw = Math.round(cw * dpr)
      const dh = Math.round(ch * dpr)
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw
        canvas.height = dh
        gl.viewport(0, 0, dw, dh)
      }
      if (cw === 0 || ch === 0) return

      const btnEl = buttonRef.current
      if (!btnEl) return
      const btnRect = btnEl.getBoundingClientRect()
      if (btnRect.width === 0 || btnRect.height === 0) return

      const center = queryCircle(centerRef.current, btnRect)
      const handle = queryCircle(handleRef.current, btnRect)

      gl.clear(gl.COLOR_BUFFER_BIT)
      // 両方 invisible なら early return (描画スキップ)
      if (center[3] < 0.5 && handle[3] < 0.5) return

      gl.uniform2f(uCanvasSize, cw, ch)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4f(uCenter, center[0], center[1], center[2], center[3])
      gl.uniform4f(uHandle, handle[0], handle[1], handle[2], handle[3])

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const tick = () => {
      draw()
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)

    const onResize = () => requestAnimationFrame(draw)
    window.addEventListener('resize', onResize)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [canvasRef, buttonRef, centerRef, handleRef])
}
