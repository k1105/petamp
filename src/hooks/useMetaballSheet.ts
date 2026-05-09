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
uniform vec3 u_trail;
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
  float dTrail = sdCircle(p - u_trail.xy, u_trail.z);
  float d = smin(dRect, dCircle, u_k);
  d = smin(d, dTrail, u_k);
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
    const uTrail = gl.getUniformLocation(program, 'u_trail')
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

    let rafId: number | null = null
    let activeTransitions = 0

    // Trail follows the FAB centre with damped lerp; lags behind during fast
    // motion to produce the asymmetric teardrop blob, settles back to centre at rest.
    const TRAIL_LERP = 0.18
    const TRAIL_R_FACTOR = 0.7
    const TRAIL_REST_EPS = 0.5
    let trailX = -1
    let trailY = -1
    let lastTs = 0
    let trailMoving = false

    const draw = (ts: number) => {
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
      const cr = Math.min(fRect.width, fRect.height) / 2

      // First frame seeds trail at FAB position so it doesn't snap from (0,0)
      if (trailX < 0) {
        trailX = cx
        trailY = cy
      } else {
        // Frame-rate-independent damping: ~60fps reference
        const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60
        const k = 1 - Math.pow(1 - TRAIL_LERP, dt * 60)
        trailX += (cx - trailX) * k
        trailY += (cy - trailY) * k
      }
      lastTs = ts
      trailMoving = Math.hypot(cx - trailX, cy - trailY) > TRAIL_REST_EPS

      const tr = cr * TRAIL_R_FACTOR

      const margin = k + radius + 4
      const minX = Math.max(0, Math.min(sRect.left, cx - cr, trailX - tr) - margin)
      const maxX = Math.min(w, Math.max(sRect.right, cx + cr, trailX + tr) + margin)
      const minY = Math.max(0, Math.min(sRect.top, cy - cr, trailY - tr) - margin)
      const maxY = Math.min(h, Math.max(sRect.bottom + 4, cy + cr, trailY + tr) + margin)

      gl.disable(gl.SCISSOR_TEST)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const ssw = Math.max(0, Math.ceil((maxX - minX) * dpr))
      const ssh = Math.max(0, Math.ceil((maxY - minY) * dpr))
      if (ssw === 0 || ssh === 0) return

      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(
        Math.floor(minX * dpr),
        Math.floor((h - maxY) * dpr),
        ssw,
        ssh
      )

      gl.uniform2f(uRes, w, h)
      gl.uniform1f(uDpr, dpr)
      gl.uniform4f(uRect, sRect.left, sRect.top, sRect.width, sRect.height + 4)
      gl.uniform3f(uCircle, cx, cy, cr)
      gl.uniform3f(uTrail, trailX, trailY, tr)

      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }

    const tick = (ts: number) => {
      draw(ts)
      if (activeTransitions > 0 || trailMoving) {
        rafId = requestAnimationFrame(tick)
      } else {
        rafId = null
      }
    }

    const onTransitionStart = () => {
      activeTransitions++
      if (rafId === null) rafId = requestAnimationFrame(tick)
    }

    const onTransitionEnd = () => {
      activeTransitions = Math.max(0, activeTransitions - 1)
      if (activeTransitions === 0) {
        if (rafId === null) rafId = requestAnimationFrame(tick)
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
