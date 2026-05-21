// 画像 URL を円形にクロップしたデータ URL に変換してキャッシュする。
// deck.gl の IconLayer は WebGL テクスチャ上に画像をそのまま貼るため、
// CSS の border-radius が効かない。事前に Canvas で円形マスクを焼き込む。

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string | null>>()

const SIZE = 128

export function getCircularAvatar(url: string): string | null {
  return cache.get(url) ?? null
}

export async function loadCircularAvatar(url: string): Promise<string | null> {
  const cached = cache.get(url)
  if (cached) return cached
  const inflight = pending.get(url)
  if (inflight) return inflight

  const p = renderCircular(url)
    .then((dataUrl) => {
      if (dataUrl) cache.set(url, dataUrl)
      pending.delete(url)
      return dataUrl
    })
    .catch(() => {
      pending.delete(url)
      return null
    })
  pending.set(url, p)
  return p
}

function renderCircular(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.save()
        ctx.beginPath()
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
        ctx.closePath()
        ctx.clip()

        // contain → cover で短辺基準にして中央クロップ
        const s = Math.min(img.naturalWidth, img.naturalHeight)
        const sx = (img.naturalWidth - s) / 2
        const sy = (img.naturalHeight - s) / 2
        ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE)
        ctx.restore()
        resolve(canvas.toDataURL('image/png'))
      } catch {
        // CORS で tainted な場合など
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
