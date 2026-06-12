function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'run'
}

/**
 * SVG 要素を width x height の PNG にラスタライズし、OS のシェアシート
 * (Web Share API) で共有する。ファイル共有非対応環境（主にデスクトップ）では
 * URL のみで共有にフォールバックする。
 *
 * navigator.share の存在確認は呼び出し側で行うこと。失敗時は throw する
 * (ユーザーがシートを閉じただけの AbortError も含む — 呼び出し側で判別)。
 */
export async function shareSvgAsPng(
  svgEl: SVGSVGElement,
  opts: { width: number; height: number; name: string; fallbackUrl: string },
): Promise<void> {
  const { width, height, name, fallbackUrl } = opts
  let svgUrl: string | null = null
  try {
    const clone = svgEl.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    const svgString = new XMLSerializer().serializeToString(clone)
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    svgUrl = URL.createObjectURL(svgBlob)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg load failed'))
      img.src = svgUrl!
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('encode failed')
    const file = new File([blob], `${safeFileName(name)}.png`, { type: 'image/png' })
    const canShareFiles =
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
    if (canShareFiles) {
      await navigator.share({ files: [file], title: name })
    } else {
      // ファイル共有非対応（主にデスクトップ）→ URL のみで OS シェアシートを開く
      await navigator.share({ title: name, url: fallbackUrl })
    }
  } finally {
    if (svgUrl) URL.revokeObjectURL(svgUrl)
  }
}
