import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../gallery/EyesIcon'
import { useJoystickButton } from '../../hooks/useJoystickButton'
import { useJoystickMetaball } from '../../hooks/useJoystickMetaball'
import { useJoystickStore } from '../../store/useJoystickStore'
import type { EyeParams } from '../../store/useSettingsStore'

interface Props {
  orbit: boolean
  onToggleOrbit: () => void
  onJoystickFrame: (dx: number, dy: number, orbit: boolean) => void
}

// rest 時に目は非表示にするので eyeYOffset の base shift は不要。0 にして
// 目を face center (= handle 中心) に置き、SVG transform で drag 方向に
// 動かす。CSS の .map-joystick-petamp svg { overflow: visible } で sclera が
// viewBox を越えてもクリップされない。
const JOYSTICK_EYE_PARAMS: EyeParams = {
  fabIconSize: 52,
  eyeYOffset: 0,
  eyeXOffset: 0,
  eyeSizeScale: 1.15,
  pupilSizeScale: 1.1,
}

// petamp が FAB から飛び込む / FAB に戻る tween 長さ。CSS の
// .map-joystick-petamp / .map-joystick-handle transition と揃える。
const FLY_DURATION_MS = 320

// 目を pivot 中心の円周上に置くときの「顔の中心から目までの距離」。
// rest (d=0) では eye が anchor の真上 R_BASE px、drag 中は drag 方向に
// R_BASE px の位置 (= pivot から見ると R_BASE + d の半径)。
const EYE_RADIUS_FROM_FACE = 24

// FAB peak の見た目サイズに合わせるために handle を縮める scale。
// FAB は 64×64 (fab-icon を内包する peak)、joystick handle は 88×88。
// fly 開始/終了時は handle を FAB サイズに揃えて、peak と差し替わった瞬間が
// 連続して見えるようにする。
const HANDLE_FAB_SCALE = 64 / 88

// mode toggle のヒット判定半径。armed 中の center 円 (72×72 = 半径 36) の
// 中で tap された時だけ mode 切替を発火させる。
const TOGGLE_HIT_RADIUS = 36

// petamp の顔 (= handle 円、88×88 = 半径 44) の外側で tap されたら dismiss。
// この radius と TOGGLE_HIT_RADIUS の間 (36 < d ≤ 44) は「顔の上だが中心
// 外」のリング領域で、tap しても何もしない (ambiguous zone)。
const PETAMP_FACE_HIT_RADIUS = 44

// FAB button rect。Gallery 以外のページでは存在しない。
// 旧: `.fab-icon` (52×52) を query していたが、これは内部のアイコン要素で、
// useMetaballSheet の peak が見る `fabRef` = `.fab.fab-sheet` (64×64 button)
// とサイズが違っていた → peak が 52→64 と急に大きくなる現象の原因。
// 同じ button 要素を query することで peak / handle / 着地点のサイズが揃う。
function getFabIconRect(): DOMRect | null {
  const el = document.querySelector('.fab.fab-sheet')
  return el instanceof HTMLElement ? el.getBoundingClientRect() : null
}

// 中央に鎮座する円と、petamp の顔を載せた円 (handle) を SVG metaball filter
// で繋ぐマップ操作 UI。tap で armed (petamp が FAB から飛んでくる、FAB の
// 円ごと handle 位置へ移動するように見える)、外側タップで idle (FAB に戻る)、
// armed 中の tap でモードトグル、ドラッグで毎フレーム onJoystickFrame。
export function MapJoystick({ orbit, onToggleOrbit, onJoystickFrame }: Props) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const centerRef = useRef<HTMLSpanElement>(null)
  const handleRef = useRef<HTMLSpanElement>(null)
  const petampRef = useRef<HTMLSpanElement>(null)

  const [armed, setArmed] = useState(false)
  const [flying, setFlying] = useState(false)
  // disarm 開始時に true、disarm 完了時に false。center の scale を「FAB に戻る
  // アニメーション開始」と同タイミングで小さくするための class 切替に使う。
  const [disarming, setDisarming] = useState(false)
  const [flyOffset, setFlyOffset] = useState<{ x: number; y: number } | null>(null)
  const setStoreArmed = useJoystickStore(s => s.setArmed)
  const setStoredFabRect = useJoystickStore(s => s.setStoredFabRect)

  // 各 joystick 専用の WebGL canvas で center/handle を smin merge して描画。
  // canvas は button 内に配置されるので、face/icon (z:2/3 within button stacking)
  // が自然に canvas (default z:0) より上に来る → 覆い被さらない。
  // peak は global canvas (useMetaballSheet) が担当。
  useJoystickMetaball(canvasRef, buttonRef, centerRef, handleRef)

  // pointer ハンドラから現在値を読むための ref 同期。
  const armedRef = useRef(armed)
  // eslint-disable-next-line react-hooks/refs
  armedRef.current = armed
  const orbitRef = useRef(orbit)
  // eslint-disable-next-line react-hooks/refs
  orbitRef.current = orbit
  // 「この tap が armed トリガだったか」を覚えておくフラグ。armed 化した tap
  // の pointerup で onTap がそのまま発火しても、モードトグルは抑制したい。
  const justArmedRef = useRef(false)

  // disarm の 2 段 timer:
  //   phase1 (T=320): handle が FAB 着地。joystick 顔/icon/handle instant hide
  //     (.is-disarming 中は opacity 0s transition)。同時に body class 外して
  //     FAB 顔 fade-in (0.2s)。arm の対称 (FAB instant hide + joystick fade-in)。
  //   phase2 (T=570): 不可視中に flyOffset リセット + disarming 解除。
  const disarmTimersRef = useRef<{ phase1: number; phase2: number } | null>(null)

  // arm 時点での FAB rect を保存しておき、disarm 時に flyback の target として
  // 再利用する (body class で FAB は画面外に slide しているため、disarm 時点で
  // getBoundingClientRect しても元の位置が取れない)。
  const fabRectAtArmRef = useRef<DOMRect | null>(null)
  const clearDisarmTimers = () => {
    const t = disarmTimersRef.current
    if (!t) return
    window.clearTimeout(t.phase1)
    window.clearTimeout(t.phase2)
    disarmTimersRef.current = null
  }

  useJoystickButton(buttonRef, {
    onTap: (relX, relY) => {
      if (justArmedRef.current) {
        justArmedRef.current = false
        return
      }
      if (!armedRef.current) return
      const d = Math.hypot(relX, relY)
      // 中心円内: mode toggle
      if (d <= TOGGLE_HIT_RADIUS) {
        onToggleOrbit()
        return
      }
      // petamp 顔の外 (handle 円の外側): dismiss
      if (d > PETAMP_FACE_HIT_RADIUS) {
        performDisarmRef.current()
        return
      }
      // 中心 (36) と顔外周 (44) の間: 何もしない (ambiguous zone)
    },
    onJoystickFrame: (dx, dy) => {
      if (!armedRef.current) return
      onJoystickFrame(dx, dy, orbitRef.current)
      // 目の位置: pivot 中心の円周上 (半径 d + EYE_RADIUS_FROM_FACE)、
      // 角度 = drag 方向。SVG transform で face 中心から見た offset を
      // セットする (face は handle と一緒に jx/jy 動くので、SVG transform は
      // 「face から見て drag 方向に EYE_RADIUS_FROM_FACE px」固定)。
      const el = buttonRef.current
      if (!el) return
      const d = Math.hypot(dx, dy)
      if (d <= 0) return
      const ex = (EYE_RADIUS_FROM_FACE * dx) / d
      const ey = (EYE_RADIUS_FROM_FACE * dy) / d
      el.style.setProperty('--eye-x', `${ex}px`)
      el.style.setProperty('--eye-y', `${ey}px`)
    },
    onDragEnd: () => {
      // drag 終了で目を rest 位置 (真上) に戻す。CSS の default (0, -20px) に
      // 戻すために inline 値を削除して transition を発火させる。
      const el = buttonRef.current
      if (!el) return
      el.style.removeProperty('--eye-x')
      el.style.removeProperty('--eye-y')
    },
  })

  // idle 中の pointerdown で armed 化 (FAB → handle 位置への fly-in を準備)。
  useEffect(() => {
    const el = buttonRef.current
    if (!el) return
    const onDown = () => {
      if (armedRef.current) return
      // disarm 進行中ならキャンセル (素早く再 arm された時の整合性)。
      clearDisarmTimers()
      // disarm 中だった可能性をクリア。
      setDisarming(false)

      // FAB rect は body class 追加 (= FAB slide-down 開始) 前に query する。
      // class が付いた後だと getBoundingClientRect は slide 後の値を返すので、
      // fly-in の起点が間違う。disarm 時にも使い回すので ref に保存する。
      // 同じ rect を store にも入れて useMetaballSheet の peak position 固定
      // に使う (disarm 中の FAB slide-up と independent に peak を元位置に出す)。
      const handleEl = handleRef.current
      const fabRect = getFabIconRect()
      fabRectAtArmRef.current = fabRect
      setStoredFabRect(fabRect)

      // ref を同期更新。直後の pointermove でも armed 判定が正しく効くように。
      armedRef.current = true
      justArmedRef.current = true
      setArmed(true)
      setStoreArmed(true)
      // 2 系統: armed = 顔の hide (cross-fade に使う)、fab-out = bottom-sheet
      // slide。arm では同時に on、disarm では別タイミングで off にする。
      document.body.classList.add('map-joystick-armed')
      document.body.classList.add('map-joystick-fab-out')

      if (!handleEl || !fabRect) return
      const hRect = handleEl.getBoundingClientRect()
      const offset = {
        x: fabRect.left + fabRect.width / 2 - (hRect.left + hRect.width / 2),
        y: fabRect.top + fabRect.height / 2 - (hRect.top + hRect.height / 2),
      }
      setFlying(true)
      setFlyOffset(offset)
      // 1 フレーム待って初期値 (FAB 位置) をコミットし、もう 1 フレームで
      // flying/offset をクリアして CSS transition による handle 位置への
      // 着地を発火させる (二段 rAF は確実に「初期値→目的値」を遷移させるため)。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setFlying(false)
          setFlyOffset(null)
        })
      })
    }
    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [setStoreArmed])

  // disarm (handle → FAB の fly-back) を発火する関数。document の outside-tap
  // listener と、button 内 petamp 顔外側 tap の両方から呼ばれる。
  // ref に最新版を入れておくことで stale closure を避ける。
  const performDisarmRef = useRef<() => void>(() => {})
  // eslint-disable-next-line react-hooks/refs
  performDisarmRef.current = () => {
    if (!armedRef.current) return
    const handleEl = handleRef.current
    // FAB は body class で画面外に slide しているので、現在の rect ではなく
    // arm 時点で保存しておいた rect (= 元位置) を target に使う。
    const fabRect = fabRectAtArmRef.current
    if (!handleEl || !fabRect) {
      armedRef.current = false
      setArmed(false)
      setStoreArmed(false)
      document.body.classList.remove('map-joystick-armed')
      document.body.classList.remove('map-joystick-fab-out')
      return
    }
    const hRect = handleEl.getBoundingClientRect()
    const offset = {
      x: fabRect.left + fabRect.width / 2 - (hRect.left + hRect.width / 2),
      y: fabRect.top + fabRect.height / 2 - (hRect.top + hRect.height / 2),
    }
    // body class change と handle/petamp の inline transform を完全に同フレーム
    // で commit する (React state 経由だと 1〜2 フレーム遅れて scale 動作の
    // 開始タイミングが「外れるモーション」と揃わない)。React state は cleanup
    // 用に setFlyOffset(offset) で同期しておくが、視覚的な transition の起点
    // は ref 経由の直書きで保証する。
    const handleTransform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${HANDLE_FAB_SCALE})`
    const petampTransform = `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`
    handleEl.style.transform = handleTransform
    if (petampRef.current) petampRef.current.style.transform = petampTransform
    document.body.classList.remove('map-joystick-fab-out')
    // peak の表示は phase1 (T=320) まで遅らせる。disarm 中は handle (per-
    // joystick canvas) が唯一の円として joystick から FAB に flyback する。
    // T=phase1 で handle が FAB 着地と同タイミングで peak が出現 (instant
    // swap、同位置・同サイズ = 同じ円として連続して見える)。
    // disarming on → center scale が FAB return アニメと同タイミング (T=0) で
    // 縮み始める + .is-disarming で T=phase1 に handle/petamp/icon を
    // instant hide する。peak は per-joystick canvas が一手に描画 (global は
    // 常に peak 抑制) なので store フラグは不要。
    setDisarming(true)
    setFlyOffset(offset)
    // phase1 (T=320): handle が FAB に到着した瞬間に同時にスワップ:
    //   - setArmed(false) で .is-armed を外す → .is-disarming 残ったままなので
    //     joystick 顔/icon/handle は transition opacity 0s で instant hide
    //   - body class を外す → FAB 顔が default 0.2s で fade-in
    // = 「joystick 顔が消えて FAB 顔がフェードイン」(arm の対称: arm は
    //   「FAB 顔が消えて joystick 顔がフェードイン」)。同じ顔が連続して場所を
    //   変えたように見える。
    const phase1 = window.setTimeout(() => {
      armedRef.current = false
      setArmed(false)
      // setStoreArmed(false) で peakHiddenRef → false → peak が global canvas
      // に instant 出現。同タイミングで .is-armed が外れて handle/petamp/icon
      // も instant hide (.is-disarming の opacity 0s)。peak position は
      // storedFabRect override 経由で元 FAB 位置 = handle 着地点 = 完全に
      // 同位置で swap される。
      setStoreArmed(false)
      document.body.classList.remove('map-joystick-armed')
    }, FLY_DURATION_MS)
    // phase2 (T=570): 不可視中に flyOffset と stored fab rect を解除。
    // disarming も false に戻す (次の arm で center scale が正しく動くように)。
    // transform の rebound は不可視中に行われるのでユーザーには見えない。
    const phase2 = window.setTimeout(() => {
      setFlyOffset(null)
      setStoredFabRect(null)
      // local disarming 解除 (CSS .is-disarming class が外れる)。store の方は
      // phase1 で既に false にしてあるので、ここでは local だけ。
      setDisarming(false)
      disarmTimersRef.current = null
    }, FLY_DURATION_MS + 250)
    disarmTimersRef.current = { phase1, phase2 }
  }

  // armed 中の button 外タップで disarm。button 内かつ petamp 顔外側 tap で
  // disarm するのは別経路 (onTap callback)。
  useEffect(() => {
    if (!armed) return
    const onDoc = (e: PointerEvent) => {
      const el = buttonRef.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      performDisarmRef.current()
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [armed])

  // アンマウント時に body class と store と pending timer を必ずリセット。
  useEffect(() => {
    return () => {
      clearDisarmTimers()
      document.body.classList.remove('map-joystick-armed')
      document.body.classList.remove('map-joystick-fab-out')
      setStoreArmed(false)
      setStoredFabRect(null)
    }
  }, [setStoreArmed, setStoredFabRect])

  // handle は fly 中に FAB peak と同じサイズ (scale 64/88) に縮める →
  // peak ↔ handle の差し替えが同位置・同サイズで起き、ひとつの円が変化して
  // いるように見える。petamp の顔は FAB の .fab-icon と同じ 52px なので
  // scale 不要 (位置だけ移動)。
  const flyStyleHandle = flyOffset
    ? {
        transform: `translate(calc(-50% + ${flyOffset.x}px), calc(-50% + ${flyOffset.y}px)) scale(${HANDLE_FAB_SCALE})`,
      }
    : undefined
  const flyStylePetamp = flyOffset
    ? {
        transform: `translate(calc(-50% + ${flyOffset.x}px), calc(-50% + ${flyOffset.y}px))`,
      }
    : undefined

  return (
    <>
      <svg className="map-joystick-defs" width="0" height="0" aria-hidden focusable="false">
        <defs>
          <filter
            id="map-joystick-metaball"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 22 -10"
            />
          </filter>
        </defs>
      </svg>
      <button
        ref={buttonRef}
        type="button"
        className={`map-joystick${armed ? ' is-armed' : ''}${flying ? ' is-flying' : ''}${disarming ? ' is-disarming' : ''}${orbit ? ' is-orbit' : ''}`}
        title={armed ? (orbit ? 'パンモード' : '回転モード') : 'マップ操作'}
        aria-label={armed ? (orbit ? 'パンモード' : '回転モード') : 'マップ操作を開始'}
      >
        {/* per-joystick metaball canvas. button 内に配置することで stacking
            order 上自然に face/icon の下に来る。inset:-40px で blob が button
            外に extend してもクリップされない。 */}
        <canvas
          ref={canvasRef}
          className="map-joystick-metaball-canvas"
          aria-hidden
        />
        <span className="map-joystick-blob" aria-hidden>
          <span ref={centerRef} className="map-joystick-center" />
          <span ref={handleRef} className="map-joystick-handle" style={flyStyleHandle} />
        </span>
        <span className="map-joystick-icon" aria-hidden>
          <Icon icon={orbit ? 'lucide:rotate-3d' : 'lucide:move'} />
        </span>
        <span ref={petampRef} className="map-joystick-petamp" style={flyStylePetamp} aria-hidden>
          <EyesIcon params={JOYSTICK_EYE_PARAMS} />
        </span>
      </button>
    </>
  )
}
