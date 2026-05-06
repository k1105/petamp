import { useEffect, type RefObject } from 'react'

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>
  fabRef: RefObject<HTMLElement | null>
  sheetRef: RefObject<HTMLElement | null>
}

export function useMetaballSheet({ canvasRef, fabRef, sheetRef }: Options) {
  useEffect(() => {
    const canvas = canvasRef.current
    const fab = fabRef.current
    const sheet = sheetRef.current
    if (!canvas || !fab || !sheet) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
      'rgb(28, 151, 94)'

    let rafId: number | null = null
    let activeTransitions = 0

    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = window.innerWidth
      const h = window.innerHeight

      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      ctx.save()
      ctx.filter = 'blur(12px) contrast(22)'
      ctx.fillStyle = accent

      const sRect = sheet.getBoundingClientRect()
      const radius = 24
      const sx = sRect.left
      const sy = sRect.top
      const sw = sRect.width
      const sh = sRect.height
      ctx.beginPath()
      ctx.moveTo(sx, sy + radius)
      ctx.quadraticCurveTo(sx, sy, sx + radius, sy)
      ctx.lineTo(sx + sw - radius, sy)
      ctx.quadraticCurveTo(sx + sw, sy, sx + sw, sy + radius)
      ctx.lineTo(sx + sw, sy + sh + 4)
      ctx.lineTo(sx, sy + sh + 4)
      ctx.closePath()
      ctx.fill()

      const fRect = fab.getBoundingClientRect()
      const cx = fRect.left + fRect.width / 2
      const cy = fRect.top + fRect.height / 2
      const r = Math.min(fRect.width, fRect.height) / 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()

      ctx.restore()
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
    }
  }, [canvasRef, fabRef, sheetRef])
}
