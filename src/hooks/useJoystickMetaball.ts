import { useEffect, type RefObject } from 'react'
import {
  FULLSCREEN_QUAD_VERT_SRC,
  FULLSCREEN_QUAD_VERTS,
  SDF_CIRCLE_GLSL,
  createShaderProgram,
  deleteShaderProgram,
  makeAccentUniformRefresher,
} from '../utils/glShaderUtils'

// MapJoystick の center + handle 円を smin merge して描画する per-joystick
// WebGL canvas のレンダラー。canvas は button の中に配置されるので、面・
// アイコンと自然な z-index 関係になる (canvas が button stacking 内 →
// 自然に icon/petamp face の下に来る)。各 joystick インスタンスが独立した
// canvas を持つことで「複数 joystick が画面に存在しても干渉しない」も
// 解決される。

const FRAG_SRC = `
precision mediump float;
uniform vec2 u_canvasSize;     // canvas の CSS 上のサイズ (px)
uniform float u_dpr;
uniform vec3 u_color;
uniform float u_k;
uniform vec4 u_center;          // (cx, cy, radius, visible) — canvas-local px
uniform vec4 u_handle;

${SDF_CIRCLE_GLSL}
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

    const sp = createShaderProgram(gl, FULLSCREEN_QUAD_VERT_SRC, FRAG_SRC, 'joystick metaball')
    if (!sp) return
    const { program } = sp

    const aPos = gl.getAttribLocation(program, 'a_pos')
    const uCanvasSize = gl.getUniformLocation(program, 'u_canvasSize')
    const uDpr = gl.getUniformLocation(program, 'u_dpr')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uK = gl.getUniformLocation(program, 'u_k')
    const uCenter = gl.getUniformLocation(program, 'u_center')
    const uHandle = gl.getUniformLocation(program, 'u_handle')

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD_VERTS, gl.STATIC_DRAW)

    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.clearColor(0, 0, 0, 0)
    gl.uniform1f(uK, 24)

    const refreshAccent = makeAccentUniformRefresher(gl, uColor)
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
      deleteShaderProgram(gl, sp)
      gl.deleteBuffer(buf)
    }
  }, [canvasRef, buttonRef, centerRef, handleRef])
}
