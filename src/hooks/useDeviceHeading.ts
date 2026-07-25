import { useEffect, useRef, useState } from 'react'

/**
 * 端末の向き (コンパス方位) を 0=北・時計回り (東=90) の度数で返す。
 * Google Map の現在地ビーム同様、進行方向ではなく「端末が向いている向き」を使う。
 *
 * - iOS (Safari / WKWebView): event.webkitCompassHeading が真北基準の方位を直接くれる。
 * - その他 (Android 等): absolute な alpha を 360-alpha でコンパス方位へ変換する。
 *
 * iOS 13+ は DeviceOrientationEvent.requestPermission() をユーザージェスチャ内で
 * 呼ぶ必要があるため、マウント直後に一度試し、ダメなら最初のタップで再要求する。
 * 値は rAF ループで円環ローパスして揺れを抑え、0.5° 以上動いたときだけ更新する。
 */
export function useDeviceHeading(): number | null {
  const [heading, setHeading] = useState<number | null>(null)
  const rawRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    let logged = false
    const onOrient = (e: DeviceOrientationEvent) => {
      const h = extractHeading(e)
      if (!logged) {
        logged = true
        const wk = (e as DeviceOrientationEvent & {webkitCompassHeading?: number}).webkitCompassHeading
        console.log('[heading] first event', {heading: h, webkitCompassHeading: wk, absolute: e.absolute, alpha: e.alpha})
      }
      if (h != null) rawRef.current = h
    }

    const attach = () => {
      if (cancelled) return
      window.addEventListener('deviceorientation', onOrient, true)
      window.addEventListener('deviceorientationabsolute', onOrient as EventListener, true)
    }

    const DOE = window.DeviceOrientationEvent as
      | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
      | undefined
    let removeGesture: (() => void) | null = null

    const hasReq = !!DOE && typeof DOE.requestPermission === 'function'
    console.log('[heading] init', {hasDOE: !!DOE, hasRequestPermission: hasReq})

    if (DOE && hasReq) {
      const tryRequest = () => {
        DOE.requestPermission!()
          .then(res => {
            console.log('[heading] requestPermission ->', res)
            if (res === 'granted') attach()
          })
          .catch(e => console.log('[heading] requestPermission rejected', String(e)))
      }
      // 既にこのセッションで許可済みなら即時に成功する。
      tryRequest()
      // iOS はジェスチャ必須なので、最初のタップで一度だけ再要求する。
      const onGesture = () => {
        tryRequest()
        removeGesture?.()
      }
      removeGesture = () => {
        window.removeEventListener('pointerdown', onGesture)
        window.removeEventListener('touchend', onGesture)
        removeGesture = null
      }
      window.addEventListener('pointerdown', onGesture)
      window.addEventListener('touchend', onGesture)
    } else {
      attach()
    }

    // 円環ローパス: 角度差を [-180,180] に畳んで補間する。
    let raf = 0
    let smoothed: number | null = null
    let lastEmitted: number | null = null
    const SMOOTH = 0.2
    const tick = () => {
      const target = rawRef.current
      if (target != null) {
        if (smoothed == null) {
          smoothed = target
        } else {
          const d = ((target - smoothed + 540) % 360) - 180
          smoothed = (smoothed + d * SMOOTH + 360) % 360
        }
        if (
          lastEmitted == null ||
          Math.abs(((smoothed - lastEmitted + 540) % 360) - 180) > 0.5
        ) {
          lastEmitted = smoothed
          setHeading(smoothed)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('deviceorientation', onOrient, true)
      window.removeEventListener('deviceorientationabsolute', onOrient as EventListener, true)
      removeGesture?.()
    }
  }, [])

  return heading
}

function extractHeading(e: DeviceOrientationEvent): number | null {
  const wk = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
  if (typeof wk === 'number' && !Number.isNaN(wk)) return wk
  if (e.absolute && typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
    return (360 - e.alpha) % 360
  }
  return null
}
