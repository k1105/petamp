import { useEffect, type RefObject } from 'react'

interface Refs {
  fabRef: RefObject<HTMLElement | null>
  speechBubbleRef: RefObject<HTMLElement | null>
  movementSelectorRef: RefObject<HTMLElement | null>
  startLabelRef: RefObject<HTMLElement | null>
  coRunEntryRef: RefObject<HTMLElement | null>
}

/**
 * 吹き出し・移動種別セレクタ・START ラベル・「友達と走る」ボタンを FAB の実 rect に
 * 毎フレーム追従させる (Gallery 専用)。armed 時のみ後者 3 つを配置する。
 */
export function useFabStackPositioning(
  { fabRef, speechBubbleRef, movementSelectorRef, startLabelRef, coRunEntryRef }: Refs,
  armed: boolean,
  activeBubbleText: string | null,
): void {
  // Position the speech bubble + start label relative to the FAB's actual
  // bounding rect each frame. armed 時は start-label も追従。
  useEffect(() => {
    if (!activeBubbleText && !armed) return
    let raf = 0
    const tick = () => {
      const fab = fabRef.current
      if (fab) {
        const r = fab.getBoundingClientRect()
        const cx = r.left + r.width / 2
        // 顔のすぐ上に吹き出し、その上に移動種別セレクタを積む。
        // 各要素は translate ではなく left/top を直接指定して中央寄せする
        // (pop アニメの transform が中央寄せ translate を上書きして横にずれるのを防ぐ)。
        let stackTop = r.top
        const bubble = speechBubbleRef.current
        if (bubble) {
          bubble.style.left = `${cx - bubble.offsetWidth / 2}px`
          bubble.style.top = `${r.top - 16 - bubble.offsetHeight}px`
          stackTop = r.top - 16 - bubble.offsetHeight
        }
        if (armed) {
          const selector = movementSelectorRef.current
          if (selector) {
            selector.style.left = `${cx - selector.offsetWidth / 2}px`
            selector.style.top = `${stackTop - 14 - selector.offsetHeight}px`
          }
          const label = startLabelRef.current
          if (label) {
            label.style.left = `${cx - label.offsetWidth / 2}px`
            label.style.top = `${r.bottom + 18}px`
          }
          // ペタンプの顔(FAB)の右隣に「友達と走る」アイコン+ラベルを縦中央で並べる。
          const coRun = coRunEntryRef.current
          if (coRun) {
            coRun.style.left = `${r.right + 14}px`
            coRun.style.top = `${r.top + r.height / 2 - coRun.offsetHeight / 2}px`
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [armed, activeBubbleText, fabRef, speechBubbleRef, movementSelectorRef, startLabelRef, coRunEntryRef])
}
