// useMetaballSheet / useJoystickMetaball で共有する WebGL ユーティリティ。
// 両 hook は「フルスクリーン quad + SDF fragment shader + --accent 色」という
// 同じ構成なので、shader コンパイル・色解決をここに集約する。

/** フルスクリーン quad の頂点シェーダ (両レンダラー共通)。 */
export const FULLSCREEN_QUAD_VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

/** フルスクリーン quad (2 triangle) の頂点配列。 */
export const FULLSCREEN_QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])

/** 円 SDF + smin merge の GLSL ヘルパ群。fragment shader に文字列結合で挿入する。 */
export const SDF_CIRCLE_GLSL = `
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
`

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  src: string,
  label = 'shader',
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(`${label} compile error:`, gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export interface ShaderProgram {
  program: WebGLProgram
  vs: WebGLShader
  fs: WebGLShader
}

/** vert/frag をコンパイルして link 済み program を返す。失敗時は null (エラーは console へ)。 */
export function createShaderProgram(
  gl: WebGLRenderingContext,
  vertSrc: string,
  fragSrc: string,
  label = 'shader',
): ShaderProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc, label)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc, label)
  if (!vs || !fs) return null
  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`${label} link error:`, gl.getProgramInfoLog(program))
    return null
  }
  return { program, vs, fs }
}

export function deleteShaderProgram(gl: WebGLRenderingContext, sp: ShaderProgram): void {
  gl.deleteProgram(sp.program)
  gl.deleteShader(sp.vs)
  gl.deleteShader(sp.fs)
}

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

/** --accent が解決できないときのフォールバック (ブランドの緑)。 */
const DEFAULT_ACCENT_RGB: [number, number, number] = [28 / 255, 151 / 255, 94 / 255]

/**
 * --accent をフレーム間でキャッシュし、変化したときだけ u_color uniform を更新する
 * 関数を返す。@property の transition 補間中は値が毎フレーム変化するので、
 * 返り値の関数は draw ループの先頭で毎フレーム呼ぶ。パース失敗時は直前の有効値を保つ。
 */
export function makeAccentUniformRefresher(
  gl: WebGLRenderingContext,
  uColor: WebGLUniformLocation | null,
): () => void {
  let lastAccentRaw = ''
  let cachedColor: [number, number, number] = DEFAULT_ACCENT_RGB
  return () => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    if (raw === lastAccentRaw) return
    lastAccentRaw = raw
    const parsed = parseCssColor(raw)
    if (parsed) cachedColor = parsed
    gl.uniform3f(uColor, cachedColor[0], cachedColor[1], cachedColor[2])
  }
}
