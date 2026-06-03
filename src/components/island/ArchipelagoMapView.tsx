import { useEffect, useRef, useState } from 'react'
import {
  AmbientLight,
  Deck,
  LightingEffect,
  MapView as DeckMapView,
  WebMercatorViewport,
  type Layer,
} from '@deck.gl/core'
import { MapJoystick } from '../map/MapJoystick'

const JOYSTICK_PAN_SPEED = 0.05
const JOYSTICK_BEARING_SPEED = 0.03
const JOYSTICK_PITCH_SPEED = 0.02

// マットな表現にするため単一の環境光のみ。deck.gl デフォルトの
// directional ライトだと頂点色とズレるため上書き。
const FLAT_LIGHTING = new LightingEffect({
  ambient: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
})

export interface ArchipelagoBbox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

interface ViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch: number
  bearing: number
  maxPitch?: number
  minPitch?: number
  minZoom?: number
  maxZoom?: number
}

const DEFAULT_VIEW_STATE: ViewState = {
  longitude: 0,
  latitude: 35,
  zoom: 1,
  pitch: 0,
  bearing: 0,
  maxPitch: 85,
  minPitch: 0,
  minZoom: 0,
  maxZoom: 22,
}

interface PanBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  minZoom: number
  maxZoom: number
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

interface Props {
  layers: Layer[]
  fitBbox: ArchipelagoBbox | null
  /** キャンバスの下に敷く背景色。海色と一致させると、fit 完了前のチラ見えを防げる。 */
  background?: string
}

/**
 * 群島マップ専用ビュー。Mapbox 基盤を経由せず deck.gl が直接 canvas に描画する。
 * Mapbox との同期遅延・depth バッファ競合・camera matrix 浮動小数点ブレといった
 * 振動の原因を排除する。群島は架空地形なので地理タイルも不要。
 */
export function ArchipelagoMapView({ layers, fitBbox, background = 'rgb(30, 110, 180)' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const deckRef = useRef<Deck<DeckMapView> | null>(null)
  const viewStateRef = useRef<ViewState>(DEFAULT_VIEW_STATE)
  const panBoundsRef = useRef<PanBounds | null>(null)
  const [, forceTick] = useState(0)
  const lastFitKeyRef = useRef<string | null>(null)
  // 回転モード: 1 本指ドラッグを pan / rotate のどちらに割り当てるか。
  const [orbit, setOrbit] = useState(false)

  const handleJoystickFrame = (dx: number, dy: number, orbitNow: boolean) => {
    const deck = deckRef.current
    const container = containerRef.current
    if (!deck || !container) return
    const vs = viewStateRef.current
    let next: ViewState
    if (orbitNow) {
      next = {
        ...vs,
        bearing: vs.bearing - dx * JOYSTICK_BEARING_SPEED,
        // pitch は drag 下方向 = カメラ上向き (look up) になるように + dy。
        pitch: Math.max(0, Math.min(85, vs.pitch + dy * JOYSTICK_PITCH_SPEED)),
      }
    } else {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      try {
        // bearing を渡して、ドラッグの前後左右をカメラの向き基準にする。
        // (pitch は渡さない。透視で上下の移動量が不均一にならないよう平面で unproject する)
        const vp = new WebMercatorViewport({
          width: w,
          height: h,
          longitude: vs.longitude,
          latitude: vs.latitude,
          zoom: vs.zoom,
          bearing: vs.bearing,
        })
        const [lng, lat] = vp.unproject([
          w / 2 + dx * JOYSTICK_PAN_SPEED,
          h / 2 + dy * JOYSTICK_PAN_SPEED,
        ])
        const b = panBoundsRef.current
        next = {
          ...vs,
          longitude: b ? clamp(lng, b.minLng, b.maxLng) : lng,
          latitude: b ? clamp(lat, b.minLat, b.maxLat) : lat,
        }
      } catch {
        return
      }
    }
    viewStateRef.current = next
    deck.setProps({ initialViewState: next })
    forceTick(t => t + 1)
  }

  useEffect(() => {
    if (!canvasRef.current) return
    const deck = new Deck({
      canvas: canvasRef.current,
      views: new DeckMapView({ controller: true }),
      initialViewState: DEFAULT_VIEW_STATE,
      controller: {
        dragPan: true,
        dragRotate: true,
        scrollZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        touchRotate: true,
        keyboard: true,
        inertia: 300,
      },
      useDevicePixels: true,
      effects: [FLAT_LIGHTING],
      layers: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onViewStateChange: (({ viewState }: any) => {
        const vs = viewState as ViewState
        const b = panBoundsRef.current
        if (b) {
          vs.longitude = clamp(vs.longitude, b.minLng, b.maxLng)
          vs.latitude = clamp(vs.latitude, b.minLat, b.maxLat)
          vs.zoom = clamp(vs.zoom, b.minZoom, b.maxZoom)
        }
        viewStateRef.current = vs
        return vs
      }) as never,
    })
    deckRef.current = deck
    return () => {
      deck.finalize()
      deckRef.current = null
    }
  }, [])

  useEffect(() => {
    deckRef.current?.setProps({ layers })
  }, [layers])

  // orbit トグル: ON のとき deck の dragPan を切り、canvas 上で 1 本指ドラッグを
  // 手動でハンドリングして bearing / pitch を更新する。deck.gl は組み込みでは
  // modifier 付き drag / 2 本指 でしか回転しないため、本実装で 1 本指回転を実現する。
  useEffect(() => {
    const deck = deckRef.current
    const canvas = canvasRef.current
    if (!deck || !canvas) return
    deck.setProps({
      controller: {
        dragPan: !orbit,
        dragRotate: true,
        scrollZoom: true,
        doubleClickZoom: true,
        touchZoom: true,
        touchRotate: true,
        keyboard: true,
        inertia: 300,
      },
    })
    if (!orbit) return

    const prevTouchAction = canvas.style.touchAction
    canvas.style.touchAction = 'none'

    let activeId: number | null = null
    let startX = 0
    let startY = 0
    let startBearing = 0
    let startPitch = 0

    const applyDelta = (dx: number, dy: number) => {
      const vs = viewStateRef.current
      const next: ViewState = {
        ...vs,
        bearing: startBearing - dx * 0.4,
        pitch: Math.max(0, Math.min(85, startPitch - dy * 0.3)),
      }
      viewStateRef.current = next
      deck.setProps({ initialViewState: next })
      forceTick((t) => t + 1)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (activeId !== null) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      activeId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startBearing = viewStateRef.current.bearing
      startPitch = viewStateRef.current.pitch
      canvas.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return
      applyDelta(e.clientX - startX, e.clientY - startY)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return
      activeId = null
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.style.touchAction = prevTouchAction
    }
  }, [orbit])

  useEffect(() => {
    const container = containerRef.current
    const deck = deckRef.current
    if (!fitBbox || !container || !deck) return
    const key = `${fitBbox.minLng},${fitBbox.minLat},${fitBbox.maxLng},${fitBbox.maxLat}`
    if (lastFitKeyRef.current === key) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    lastFitKeyRef.current = key
    try {
      const vp = new WebMercatorViewport({ width: w, height: h })
      const fitted = vp.fitBounds(
        [
          [fitBbox.minLng, fitBbox.minLat],
          [fitBbox.maxLng, fitBbox.maxLat],
        ],
        { padding: 80 },
      )
      const next: ViewState = {
        ...DEFAULT_VIEW_STATE,
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
        pitch: viewStateRef.current.pitch,
        bearing: viewStateRef.current.bearing,
      }
      const lngHalf = (fitBbox.maxLng - fitBbox.minLng) / 2
      const latHalf = (fitBbox.maxLat - fitBbox.minLat) / 2
      const cLng = (fitBbox.maxLng + fitBbox.minLng) / 2
      const cLat = (fitBbox.maxLat + fitBbox.minLat) / 2
      const pad = 0.3
      panBoundsRef.current = {
        minLng: cLng - lngHalf * (1 + pad),
        maxLng: cLng + lngHalf * (1 + pad),
        minLat: cLat - latHalf * (1 + pad),
        maxLat: cLat + latHalf * (1 + pad),
        // fitBounds 時点で padding:80 を含めて島全体が収まっている。これより
        // 引くと島が小さく沈んでしまうので、fit zoom を最小値とする。
        minZoom: fitted.zoom,
        maxZoom: Math.min(22, fitted.zoom + 4),
      }
      viewStateRef.current = next
      deck.setProps({ initialViewState: next })
      // fitBbox 反映後に親 children へ最新 viewport を伝えるため tick を1進める。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      forceTick((t) => t + 1)
    } catch (e) {
      console.error('archipelago fit failed', e)
    }
  }, [fitBbox])

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        // absolute + inset:0 で親 .island-view-wrap の padding box 全体を覆う
        // (height: 100% だと wrap の content area = padding を除いた範囲しか
        // 覆えず、内部の MapJoystick が wrap padding-bottom 分上にずれてしまう)。
        position: 'absolute',
        inset: 0,
        background,
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
      />
      <MapJoystick
        orbit={orbit}
        onToggleOrbit={() => setOrbit(v => !v)}
        onJoystickFrame={handleJoystickFrame}
      />
    </div>
  )
}
