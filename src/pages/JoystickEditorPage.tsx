import { useMemo, useState } from 'react'
import { Icon } from '@iconify/react'
import { EyesIcon } from '../components/gallery/EyesIcon'
import type { EyeParams } from '../store/useSettingsStore'

type PreviewState = 'idle' | 'fly-in-mid' | 'armed' | 'fly-out-mid'

interface Params {
  handleSize: number
  centerSize: number
  petampSize: number
  /** drag なし時の目の rest 位置 (anchor 真上 px) */
  eyeRestY: number
  /** drag 中の eye 半径 (顔の中心から px) */
  eyeDragRadius: number
  /** fly 端点での handle の scale (FAB peak のサイズに合わせる) */
  handleFabScale: number
  /** fly tween 長さ (ms) — 静的 preview では未使用、参考表示 */
  flyDurationMs: number
  /** joystick anchor の bottom (screen-bottom から px) */
  anchorBottom: number
  /** FAB peak の直径 (現状は live fab rect から算出されるが editor 用に固定) */
  fabPeakSize: number
  /** FAB ボタンの中心の bottom (screen-bottom から px) — preview の参考用 */
  fabCenterBottom: number
}

const DEFAULT_PARAMS: Params = {
  handleSize: 88,
  centerSize: 72,
  petampSize: 52,
  eyeRestY: 20,
  eyeDragRadius: 24,
  handleFabScale: 64 / 88,
  flyDurationMs: 320,
  anchorBottom: 150,
  fabPeakSize: 64,
  fabCenterBottom: 38,
}

const STATES: { id: PreviewState; label: string; desc: string }[] = [
  { id: 'idle', label: 'idle', desc: '未タップ。小さな dot のみ。FAB に顔と peak。' },
  { id: 'fly-in-mid', label: 'fly-in (mid)', desc: 'tap 直後。petamp が FAB → joystick へ移動中。' },
  { id: 'armed', label: 'armed', desc: 'petamp が joystick に乗った状態。FAB は画面外。' },
  { id: 'fly-out-mid', label: 'fly-out (mid)', desc: '外側 tap 直後。petamp が joystick → FAB へ移動中。' },
]

export function JoystickEditorPage() {
  const [state, setState] = useState<PreviewState>('idle')
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS)

  return (
    <div className="joystick-editor">
      <aside className="joystick-editor-controls">
        <h2>MapJoystick Editor</h2>

        <section>
          <h3>状態</h3>
          {STATES.map(s => (
            <label key={s.id} className="joystick-editor-state-radio">
              <input
                type="radio"
                name="state"
                checked={state === s.id}
                onChange={() => setState(s.id)}
              />
              <span>
                <strong>{s.label}</strong>
                <span className="joystick-editor-state-desc">{s.desc}</span>
              </span>
            </label>
          ))}
        </section>

        <section>
          <h3>パラメータ</h3>
          <Slider label="handle size" value={params.handleSize} min={40} max={140} step={1}
            onChange={v => setParams(p => ({ ...p, handleSize: v }))} />
          <Slider label="center size" value={params.centerSize} min={40} max={120} step={1}
            onChange={v => setParams(p => ({ ...p, centerSize: v }))} />
          <Slider label="petamp face size" value={params.petampSize} min={30} max={100} step={1}
            onChange={v => setParams(p => ({ ...p, petampSize: v }))} />
          <Slider label="eye rest Y (anchor 上)" value={params.eyeRestY} min={0} max={60} step={1}
            onChange={v => setParams(p => ({ ...p, eyeRestY: v }))} />
          <Slider label="eye drag radius" value={params.eyeDragRadius} min={0} max={60} step={1}
            onChange={v => setParams(p => ({ ...p, eyeDragRadius: v }))} />
          <Slider label="handle FAB scale" value={params.handleFabScale} min={0.3} max={1.5} step={0.01}
            onChange={v => setParams(p => ({ ...p, handleFabScale: v }))} />
          <Slider label="fly duration (ms)" value={params.flyDurationMs} min={100} max={800} step={10}
            onChange={v => setParams(p => ({ ...p, flyDurationMs: v }))} />
          <Slider label="joystick anchor bottom" value={params.anchorBottom} min={50} max={400} step={1}
            onChange={v => setParams(p => ({ ...p, anchorBottom: v }))} />
          <Slider label="FAB peak size" value={params.fabPeakSize} min={32} max={128} step={1}
            onChange={v => setParams(p => ({ ...p, fabPeakSize: v }))} />
          <Slider label="FAB center bottom" value={params.fabCenterBottom} min={10} max={120} step={1}
            onChange={v => setParams(p => ({ ...p, fabCenterBottom: v }))} />
        </section>

        <section>
          <h3>現在値 (コピペ用)</h3>
          <pre className="joystick-editor-output">{JSON.stringify(params, null, 2)}</pre>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(params, null, 2))
            }}
          >
            コピー
          </button>
          <button
            type="button"
            onClick={() => setParams(DEFAULT_PARAMS)}
            style={{ marginLeft: 8 }}
          >
            リセット
          </button>
        </section>
      </aside>

      <main className="joystick-editor-stage">
        <PreviewStage state={state} params={params} />
      </main>
    </div>
  )
}

function Slider({
  label, value, min, max, step, onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="joystick-editor-slider">
      <div className="joystick-editor-slider-row">
        <label>{label}</label>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={e => onChange(Number(e.target.value))}
        />
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function PreviewStage({ state, params }: { state: PreviewState; params: Params }) {
  // 各 state でどの要素がどの位置・サイズで表示されるかを算出。
  const layout = useMemo(() => computeLayout(state, params), [state, params])

  return (
    <div className="joystick-editor-screen">
      {/* SVG defs: metaball filter (本物の useMetaballSheet と同じ) */}
      <svg className="joystick-editor-defs" width="0" height="0" aria-hidden focusable="false">
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

      {/* FAB の metaball blob: sheet 矩形 + peak 円を 1 つの metaball filter
          でまとめて描画 (real の useMetaballSheet と同じ smin merge を SVG
          filter で近似)。 */}
      <div className="joystick-editor-fab-blob">
        <div className="joystick-editor-sheet" />
        {layout.showFabPeak && (
          <div
            className="joystick-editor-fab-peak"
            style={{
              bottom: layout.fabCenterY - params.fabPeakSize / 2,
              width: params.fabPeakSize,
              height: params.fabPeakSize,
            }}
          />
        )}
      </div>

      {/* FAB face (目) — peak と同じ縦中心 */}
      {layout.showFabFace && (
        <div
          className="joystick-editor-fab-face"
          style={{
            bottom: layout.fabCenterY - params.petampSize / 2,
            width: params.petampSize,
            height: params.petampSize,
          }}
        >
          <EyesIcon params={getEyeParams(params, 'fab')} />
        </div>
      )}

      {/* Joystick (button + 中の各要素) */}
      <button
        type="button"
        className={`map-joystick joystick-editor-joystick ${layout.armedClass}`}
        style={{
          bottom: params.anchorBottom,
        }}
      >
        <span className="map-joystick-blob">
          <span
            className="map-joystick-center"
            style={{
              width: params.centerSize,
              height: params.centerSize,
              transform: `translate(-50%, -50%) scale(${layout.centerScale})`,
            }}
          />
          {layout.showHandle && (
            <span
              className="map-joystick-handle"
              style={{
                width: params.handleSize,
                height: params.handleSize,
                opacity: 1,
                transform: `translate(calc(-50% + ${layout.handleX}px), calc(-50% + ${layout.handleY}px)) scale(${layout.handleScale})`,
              }}
            />
          )}
        </span>
        {layout.showIcon && (
          <span
            className="map-joystick-icon"
            style={{ opacity: 1 }}
            aria-hidden
          >
            <Icon icon="lucide:move" />
          </span>
        )}
        {layout.showPetamp && (
          <span
            className="map-joystick-petamp"
            style={{
              width: params.petampSize,
              height: params.petampSize,
              opacity: 1,
              transform: `translate(calc(-50% + ${layout.petampX}px), calc(-50% + ${layout.petampY}px))`,
            }}
            aria-hidden
          >
            <EyesIcon params={getEyeParams(params, 'joystick')} />
          </span>
        )}
      </button>

      {/* anchor 位置の indicator (debug) */}
      <div
        className="joystick-editor-anchor-mark"
        style={{ bottom: params.anchorBottom }}
      >
        anchor
      </div>
      <div
        className="joystick-editor-anchor-mark joystick-editor-anchor-mark-fab"
        style={{ bottom: params.fabCenterBottom }}
      >
        FAB
      </div>
    </div>
  )
}

interface Layout {
  /** FAB 中心の bottom (screen-bottom から px)。slide 中は元位置から下にズレる。 */
  fabCenterY: number
  showFabFace: boolean
  showFabPeak: boolean
  armedClass: string
  centerScale: number
  showHandle: boolean
  handleX: number
  handleY: number
  handleScale: number
  showIcon: boolean
  showPetamp: boolean
  petampX: number
  petampY: number
}

function computeLayout(state: PreviewState, p: Params): Layout {
  // anchor は p.anchorBottom (joystick の中心位置)。
  // FAB center は p.fabCenterBottom (FAB ボタンの中心位置)。
  // joystick から FAB への delta Y (CSS y axis = top-positive):
  //   FAB - anchor = anchorBottom - fabCenterBottom (正なら FAB が下)
  const flyDy = p.anchorBottom - p.fabCenterBottom

  switch (state) {
    case 'idle':
      return {
        fabCenterY: p.fabCenterBottom,
        showFabFace: true,
        showFabPeak: true,
        armedClass: '',
        centerScale: 0.25,
        showHandle: false,
        handleX: 0, handleY: 0, handleScale: 1,
        showIcon: false,
        showPetamp: false,
        petampX: 0, petampY: 0,
      }
    case 'fly-in-mid':
      return {
        fabCenterY: p.fabCenterBottom - 50, // slide-out 半分 (下方向に下がる)
        showFabFace: false, // body class で instant hide
        showFabPeak: false, // peakHiddenRef → 0 で snap
        armedClass: 'is-armed',
        centerScale: 0.625, // 0.25 → 1 の中間
        showHandle: true,
        handleX: 0,
        handleY: flyDy / 2, // anchor から FAB の中間
        handleScale: (p.handleFabScale + 1) / 2,
        showIcon: true,
        showPetamp: true,
        petampX: 0,
        petampY: flyDy / 2,
      }
    case 'armed':
      return {
        fabCenterY: p.fabCenterBottom - 100, // 完全 slide-out
        showFabFace: false,
        showFabPeak: false,
        armedClass: 'is-armed',
        centerScale: 1,
        showHandle: true,
        handleX: 0, handleY: 0, handleScale: 1,
        showIcon: true,
        showPetamp: true,
        petampX: 0, petampY: 0,
      }
    case 'fly-out-mid':
      return {
        fabCenterY: p.fabCenterBottom - 50, // slide back up 半分
        showFabFace: false, // body class まだ on (T=520 まで hidden)
        showFabPeak: true,  // peak は handle 位置に追従して visible
        armedClass: 'is-armed',
        centerScale: 1,
        showHandle: true,
        handleX: 0,
        handleY: flyDy / 2,
        handleScale: (1 + p.handleFabScale) / 2,
        showIcon: true,
        showPetamp: true,
        petampX: 0,
        petampY: flyDy / 2,
      }
  }
}

function getEyeParams(p: Params, source: 'fab' | 'joystick'): EyeParams {
  if (source === 'fab') {
    return {
      fabIconSize: p.petampSize,
      eyeYOffset: -12, // BASE_EYE_PARAMS の default
      eyeXOffset: 0,
      eyeSizeScale: 1.15,
      pupilSizeScale: 1.1,
    }
  }
  return {
    fabIconSize: p.petampSize,
    eyeYOffset: 0,
    eyeXOffset: 0,
    eyeSizeScale: 1.15,
    pupilSizeScale: 1.1,
  }
}
