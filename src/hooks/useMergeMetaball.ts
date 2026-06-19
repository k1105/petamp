import { useEffect, useRef, type RefObject } from 'react'
import {
  FULLSCREEN_QUAD_VERT_SRC,
  FULLSCREEN_QUAD_VERTS,
  SDF_CIRCLE_GLSL,
  createShaderProgram,
  deleteShaderProgram,
  makeAccentUniformRefresher,
} from '../utils/ui/glShaderUtils'

// 複数の DOM 要素 (角丸矩形 / 円) を毎フレーム getBoundingClientRect で読み取り、
// SDF + smin で merge して WebGL canvas に描画する汎用メタボールレンダラー。
//
// SVG の `filter: url(#goo)` は、フィルタを当てた要素の中身が CSS transition で
// 動いても Safari/WebKit が毎フレーム再ラスタライズしないため、アニメーション中に
// メタボールが追従しないバグがある。本フックは rAF で毎フレーム DOM 矩形 (transition
// 補間後の座標) を読み直して再描画するので、全ブラウザで動きに追従する。
// トップの useMetaballSheet / useJoystickMetaball と同じ WebGL SDF 方式。

const N = 8

const FRAG_SRC = `
precision mediump float;
#define N ${N}
uniform vec2 u_canvasSize;     // canvas の CSS 上のサイズ (px)
uniform float u_dpr;
uniform vec3 u_color;
uniform float u_k;
uniform vec4 u_box[N];          // (cx, cy, halfW, halfH) — canvas-local px
uniform vec2 u_meta[N];         // (cornerRadius, visible)

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

${SDF_CIRCLE_GLSL}
void main() {
  vec2 p = vec2(gl_FragCoord.x / u_dpr, u_canvasSize.y - gl_FragCoord.y / u_dpr);
  float d = 1e6;
  for (int i = 0; i < N; i++) {
    if (u_meta[i].y < 0.5) continue;
    vec2 c = u_box[i].xy;
    vec2 b = u_box[i].zw;
    float r = min(u_meta[i].x, min(b.x, b.y));
    float di = sdRoundedBox(p - c, b, r);
    d = smin(d, di, u_k);
  }
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(u_color, alpha);
}
`

/**
 * shapeRefs の各要素を角丸矩形 SDF として merge し canvasRef へ描画する。
 * border-radius は computed style から読み (px のみ対応)、円・ピルは大きな半径で表現する。
 * 各要素の opacity が 0 のときは merge 対象外。
 *
 * @param k smin の係数 (neck の太さ / 膨らみ)。大きいほど接合部が太る。
 *   joystick の円結合は 24 だが、小さめのピル結合では太って見えるので既定 12。
 */
export function useMergeMetaball(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  shapeRefs: ReadonlyArray<RefObject<HTMLElement | null>>,
  k = 12,
) {
  // shapeRefs は毎レンダーで新しい配列になるが ref 自体は安定。effect を貼り直さず
  // 最新の配列を draw ループから参照できるよう ref に退避する。
  const shapeRefsRef = useRef(shapeRefs)
  shapeRefsRef.current = shapeRefs

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: true,
      antialias: true,
      alpha: true,
    })
    if (!gl) return

    const sp = createShaderProgram(gl, FULLSCREEN_QUAD_VERT_SRC, FRAG_SRC, 'merge metaball')
    if (!sp) return
    const { program } = sp

    const aPos = gl.getAttribLocation(program, 'a_pos')
    const uCanvasSize = gl.getUniformLocation(program, 'u_canvasSize')
    const uDpr = gl.getUniformLocation(program, 'u_dpr')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uK = gl.getUniformLocation(program, 'u_k')
    const uBox = gl.getUniformLocation(program, 'u_box')
    const uMeta = gl.getUniformLocation(program, 'u_meta')

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
    gl.uniform1f(uK, k)

    const refreshAccent = makeAccentUniformRefresher(gl, uColor)
    refreshAccent()

    const boxData = new Float32Array(N * 4)
    const metaData = new Float32Array(N * 2)
    let rafId: number | null = null

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

      const cnvRect = canvas.getBoundingClientRect()
      const shapes = shapeRefsRef.current
      let anyVisible = false
      for (let i = 0; i < N; i++) {
        const el = i < shapes.length ? shapes[i].current : null
        if (!el) {
          metaData[i * 2 + 1] = 0
          continue
        }
        const cs = getComputedStyle(el)
        const opacity = parseFloat(cs.opacity)
        const r = el.getBoundingClientRect()
        if (!(opacity > 0.001) || r.width === 0 || r.height === 0) {
          metaData[i * 2 + 1] = 0
          continue
        }
        boxData[i * 4] = r.left + r.width / 2 - cnvRect.left
        boxData[i * 4 + 1] = r.top + r.height / 2 - cnvRect.top
        boxData[i * 4 + 2] = r.width / 2
        boxData[i * 4 + 3] = r.height / 2
        metaData[i * 2] = parseFloat(cs.borderTopLeftRadius) || 0
        metaData[i * 2 + 1] = 1
        anyVisible = true
      }

      gl.clear(gl.COLOR_BUFFER_BIT)
      if (!anyVisible) return

      gl.uniform2f(uCanvasSize, cw, ch)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4fv(uBox, boxData)
      gl.uniform2fv(uMeta, metaData)
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
  }, [canvasRef, k])
}
