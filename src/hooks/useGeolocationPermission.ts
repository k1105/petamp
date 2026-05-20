import { useEffect, useState } from 'react'

export type GeolocationPermissionState =
  | 'unknown'      // 初期 / 解決前
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'unsupported'  // navigator.permissions が無い (古い Safari など)

/**
 * ブラウザの geolocation 権限状態を購読する。Permissions API の
 * change イベントに追従するので、ユーザーが設定で許可/拒否を
 * 切り替えると自動で反映される。
 *
 * Capacitor 等のネイティブ環境では navigator.permissions が
 * 期待通りに動かないことがあるため、呼び出し側で
 * Capacitor.isNativePlatform() を見て分岐すること。
 */
export function useGeolocationPermission(): GeolocationPermissionState {
  const [state, setState] = useState<GeolocationPermissionState>('unknown')

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const permissions = navigator.permissions
    if (!permissions || typeof permissions.query !== 'function') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState('unsupported')
      return
    }
    let status: PermissionStatus | null = null
    let cancelled = false
    const onChange = () => {
      if (status && !cancelled) {
        setState(status.state as GeolocationPermissionState)
      }
    }
    permissions
      .query({ name: 'geolocation' as PermissionName })
      .then(s => {
        if (cancelled) return
        status = s
        setState(s.state as GeolocationPermissionState)
        s.addEventListener('change', onChange)
      })
      .catch(() => {
        if (!cancelled) setState('unsupported')
      })
    return () => {
      cancelled = true
      if (status) status.removeEventListener('change', onChange)
    }
  }, [])

  return state
}
