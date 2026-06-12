import { useEffect, type RefObject } from 'react'

interface BubblePositioningOptions {
  /** 吹き出し右端をアンカー中心からどれだけ右へ出すか (px)。 */
  offsetX: number
  /** アンカー上端と吹き出し下端の間隔 (px)。 */
  gap: number
  /** 画面端からの最小マージン (px)。指定時は左右と上をクランプする。 */
  clampMargin?: number
}

/**
 * ペタンプの目玉 (アンカー) の真上に吹き出しを配置し続ける。
 * multi-line で吹き出しの高さが変わるため、アンカー / 吹き出し双方を
 * ResizeObserver で監視し、window resize でも再計測する。
 * RunDetailPage / RunResultPage で共用。
 *
 * @param active false の間は何もしない (吹き出し非表示)
 * @param remeasureKey 吹き出しの内容が変わったときに再配置を強制する値
 */
export function useRunBubblePositioning(
  anchorRef: RefObject<Element | null>,
  bubbleRef: RefObject<HTMLElement | null>,
  active: boolean,
  remeasureKey: unknown,
  { offsetX, gap, clampMargin }: BubblePositioningOptions,
) {
  useEffect(() => {
    if (!active) return
    const place = () => {
      const anchor = anchorRef.current
      const bubble = bubbleRef.current
      if (!anchor || !bubble) return
      const r = anchor.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const w = bubble.offsetWidth
      const h = bubble.offsetHeight
      let left = cx - w + offsetX
      let top = r.top - gap - h
      if (clampMargin != null) {
        left = Math.max(clampMargin, Math.min(window.innerWidth - w - clampMargin, left))
        top = Math.max(clampMargin, top)
      }
      bubble.style.left = `${left}px`
      bubble.style.top = `${top}px`
    }
    place()
    const ro = new ResizeObserver(place)
    if (anchorRef.current) ro.observe(anchorRef.current)
    if (bubbleRef.current) ro.observe(bubbleRef.current)
    window.addEventListener('resize', place)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [active, remeasureKey, offsetX, gap, clampMargin, anchorRef, bubbleRef])
}
