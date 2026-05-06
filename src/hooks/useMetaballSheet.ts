import { useEffect, type RefObject } from 'react'

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
precision mediump float;
uniform vec2 u_res;
uniform float u_dpr;
uniform vec4 u_rect;
uniform vec4 u_radii;
uniform vec3 u_circle;
uniform vec3 u_color;
uniform float u_k;

float sdRoundedBox(vec2 p, vec2 b, vec4 r) {
  vec2 rx = (p.x > 0.0) ? r.xy : r.zw;
  float radius = (p.y < 0.0) ? rx.x : rx.y;
  vec2 q = abs(p) - b + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}
float sdCircle(vec2 p, float r) { return length(p) - r; }
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x / u_dpr, u_res.y - gl_FragCoord.y / u_dpr);
  vec2 rc = u_rect.xy + u_rect.zw * 0.5;
  vec2 rh = u_rect.zw * 0.5;
  float dRect = sdRoundedBox(p - rc, rh, u_radii);
  float dCircle = sdCircle(p - u_circle.xy, u_circle.z);
  float d = smin(dRect, dCircle, u_k);
  float alpha = 1.0 - smoothstep(-1.0, 1.0, d);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(u_color, alpha);
}
`

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  fabRef: RefObject<HTMLElement | null>
  sheetRef: RefObject<HTMLElement | null>
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

export function useMetaballSheet({ canvasRef, fabRef, sheetRef }: Options) {
  useEffect(() => {
    const canvas = canvasRef.current
    const fab = fabRef.current
    const sheet = sheetRef.current
    if (!canvas || !fab || !sheet) return

    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false,
      antialias: true,
      alpha: true,
    })
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
    const uCircle = gl.getUniformLocation(program, 'u_circle')
    const uColor = gl.getUniformLocation(program, 'u_color')
    const uK = gl.getUniformLocation(program, 'u_k')

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    )

    const color = parseAccent()
    const radius = 24
    const k = 24

    let rafId: number | null = null
    let activeTransitions = 0

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight
      const dw = Math.round(w * dpr)
      const dh = Math.round(h * dpr)
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw
        canvas.height = dh
      }
      gl.viewport(0, 0, dw, dh)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

      gl.useProgram(program)

      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      const sRect = sheet.getBoundingClientRect()
      const fRect = fab.getBoundingClientRect()
      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4f(uRect, sRect.left, sRect.top, sRect.width, sRect.height + 4)
      gl.uniform4f(uRadii, radius, 0, radius, 0)
      gl.uniform3f(
        uCircle,
        fRect.left + fRect.width / 2,
        fRect.top + fRect.height / 2,
        Math.min(fRect.width, fRect.height) / 2
      )
      gl.uniform3f(uColor, color[0], color[1], color[2])
      gl.uniform1f(uK, k)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const tick = () => {
      draw()
      if (activeTransitions > 0) {
        rafId = requestAnimationFrame(tick)
      } else {
        rafId = null
      }
    }

    const onTransitionStart = () => {
      activeTransitions++
      if (rafId === null) tick()
    }

    const onTransitionEnd = () => {
      activeTransitions = Math.max(0, activeTransitions - 1)
      if (activeTransitions === 0) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        requestAnimationFrame(draw)
      }
    }

    fab.addEventListener('transitionstart', onTransitionStart)
    fab.addEventListener('transitionend', onTransitionEnd)
    fab.addEventListener('transitioncancel', onTransitionEnd)
    sheet.addEventListener('transitionstart', onTransitionStart)
    sheet.addEventListener('transitionend', onTransitionEnd)
    sheet.addEventListener('transitioncancel', onTransitionEnd)

    const onResize = () => requestAnimationFrame(draw)
    window.addEventListener('resize', onResize)

    const ro = new ResizeObserver(() => requestAnimationFrame(draw))
    ro.observe(fab)
    ro.observe(sheet)

    requestAnimationFrame(draw)

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      fab.removeEventListener('transitionstart', onTransitionStart)
      fab.removeEventListener('transitionend', onTransitionEnd)
      fab.removeEventListener('transitioncancel', onTransitionEnd)
      sheet.removeEventListener('transitionstart', onTransitionStart)
      sheet.removeEventListener('transitionend', onTransitionEnd)
      sheet.removeEventListener('transitioncancel', onTransitionEnd)
      window.removeEventListener('resize', onResize)
      ro.disconnect()

      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.deleteBuffer(buf)
    }
  }, [canvasRef, fabRef, sheetRef])
}
