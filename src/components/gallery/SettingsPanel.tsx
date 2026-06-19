import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@iconify/react'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useActivePalette } from '../../hooks/useActivePalette'
import { useAuth } from '../../hooks/useAuth'
import { signOutUser } from '../../firebase/auth'
import {
  WEATHERS,
  TIMES,
  WEATHER_LABEL,
  TIME_LABEL,
  getDefaultPalette,
  paletteKey,
  type Palette,
  type TimeOfDay,
  type Weather,
} from '../../utils/ui/themePalettes'
import {
  resetAllCharacterMemory,
  resetOnboarding,
  resetPromptLog,
} from '../../character'
import { useSpotifyStore } from '../../store/useSpotifyStore'
import { startLogin } from '../../spotify/auth'
import { confirm } from '../../store/useConfirmStore'

type AsyncActionKey = 'onboarding' | 'log' | 'all'

function formatPalettesAsTs(overrides: Record<string, Partial<Palette> | undefined>): string {
  const lines: string[] = ['{']
  for (const w of WEATHERS) {
    lines.push(`  ${w}: {`)
    for (const t of TIMES) {
      const def = getDefaultPalette(w, t)
      const merged: Palette = { ...def, ...(overrides[paletteKey(w, t)] ?? {}) }
      const pad = t.length < 7 ? ' '.repeat(7 - t.length) : ''
      lines.push(`    ${t}:${pad} { bg: '${merged.bg.toUpperCase()}', accent: '${merged.accent.toUpperCase()}' },`)
    }
    lines.push('  },')
  }
  lines.push('}')
  return lines.join('\n')
}

export function SettingsPanel() {
  const navigate = useNavigate()
  const ui = useSettingsStore(s => s.ui)
  const setUi = useSettingsStore(s => s.setUi)
  const resetUi = useSettingsStore(s => s.resetUi)
  const radii = useSettingsStore(s => s.radii)
  const setRadii = useSettingsStore(s => s.setRadii)
  const resetRadii = useSettingsStore(s => s.resetRadii)
  const theme = useSettingsStore(s => s.theme)
  const setTheme = useSettingsStore(s => s.setTheme)
  const setPaletteOverride = useSettingsStore(s => s.setPaletteOverride)
  const experimental = useSettingsStore(s => s.experimental)
  const setExperimental = useSettingsStore(s => s.setExperimental)
  const { weather, time, palette, autoWeather, autoTime } = useActivePalette()
  const { user } = useAuth()

  const [busy, setBusy] = useState<AsyncActionKey | null>(null)
  const [done, setDone] = useState<AsyncActionKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const spotifyAuth = useSpotifyStore(s => s.auth)
  const spotifyCurrent = useSpotifyStore(s => s.current)
  const disconnectSpotify = useSpotifyStore(s => s.disconnect)
  const [connectingSpotify, setConnectingSpotify] = useState(false)

  const onConnectSpotify = async () => {
    if (connectingSpotify) return
    setConnectingSpotify(true)
    try {
      await startLogin()
    } catch (e) {
      console.error('spotify connect failed', e)
      setConnectingSpotify(false)
    }
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOutUser()
    } catch (e) {
      console.error('signOut failed', e)
    } finally {
      setSigningOut(false)
    }
  }

  const onCopyPalettes = async () => {
    const code = formatPalettesAsTs(theme.overrides)
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // フォールバック: textarea 経由
      const ta = document.createElement('textarea')
      ta.value = code
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const runAction = async (key: AsyncActionKey, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    try {
      await fn()
      setDone(key)
      window.setTimeout(() => setDone(d => (d === key ? null : d)), 1800)
    } finally {
      setBusy(null)
    }
  }

  const onResetOnboarding = async () => {
    if (!(await confirm({
      title: 'オンボーディングをやり直す',
      message: 'オンボーディング画面が次のホームアクセスで再表示されます。\n登録済みの名前を消します。よろしいですか？',
      confirmLabel: 'やり直す',
      destructive: true,
    }))) return
    void runAction('onboarding', async () => {
      await resetOnboarding()
      navigate('/', { replace: true })
    })
  }

  const onResetLog = async () => {
    if (!(await confirm({
      title: 'プロンプトログを削除',
      message: 'プロンプトログをすべて削除します。\nペタンプの記憶は残ります。よろしいですか？',
      confirmLabel: '削除',
      destructive: true,
    }))) return
    void runAction('log', resetPromptLog)
  }

  const onResetAll = async () => {
    if (!(await confirm({
      title: 'ペタンプをまっさらに戻す',
      message: 'ペタンプに関するすべてのデータを消します。\n（過去の対話・要約・関係値・名前・プロンプトログ）\n\nRunの記録は消えません。よろしいですか？',
      confirmLabel: 'すべて消す',
      destructive: true,
    }))) return
    void runAction('all', async () => {
      await resetAllCharacterMemory()
      navigate('/', { replace: true })
    })
  }

  return (
    <div className="settings-content">
      <Section title="マップ">
        <SliderRow
          label="軌跡周辺の余白"
          value={ui.mapPaddingMeters}
          min={50} max={1000} step={10} unit="m"
          onChange={v => setUi({ mapPaddingMeters: v })}
        />
      </Section>

      <Section title="背景テーマ">
        <SegmentRow<Weather | 'auto'>
          label="天気"
          hint={theme.weatherMode === 'auto' ? `自動: ${autoWeather ? WEATHER_LABEL[autoWeather] : '取得中…'}` : undefined}
          value={theme.weatherMode}
          options={[
            { value: 'auto', label: '自動' },
            ...WEATHERS.map(w => ({ value: w, label: WEATHER_LABEL[w] })),
          ]}
          onChange={v => setTheme({ weatherMode: v })}
        />
        <SegmentRow<TimeOfDay | 'auto'>
          label="時間帯"
          hint={theme.timeMode === 'auto' ? `自動: ${TIME_LABEL[autoTime]}` : undefined}
          value={theme.timeMode}
          options={[
            { value: 'auto', label: '自動' },
            ...TIMES.map(t => ({ value: t, label: TIME_LABEL[t] })),
          ]}
          onChange={v => setTheme({ timeMode: v })}
        />

        <div className="settings-palette-head">
          <span className="settings-slider-label">現在のパレット</span>
          <span className="settings-slider-value">
            {WEATHER_LABEL[weather]} × {TIME_LABEL[time]}
          </span>
        </div>
        <ColorRow
          label="背景色"
          value={palette.bg}
          onChange={c => setPaletteOverride(paletteKey(weather, time), { bg: c })}
        />
        <ColorRow
          label="アクセント色"
          value={palette.accent}
          onChange={c => setPaletteOverride(paletteKey(weather, time), { accent: c })}
        />
        <div className="settings-row-actions">
          <button
            className="settings-btn-secondary"
            onClick={() => setPaletteOverride(paletteKey(weather, time), null)}
            disabled={!theme.overrides[paletteKey(weather, time)]}
          >
            <Icon icon="lucide:rotate-ccw" />
            <span>このパレットをリセット</span>
          </button>
          <button className="settings-btn-secondary" onClick={onCopyPalettes}>
            <Icon icon={copied ? 'lucide:check' : 'lucide:clipboard-copy'} />
            <span>{copied ? 'コピーしました' : 'TS としてコピー'}</span>
          </button>
        </div>
        <PalettePreview overrides={theme.overrides} />
      </Section>

      <Section title="軌跡サイズ">
        <SegmentRow
          label="軌跡の表現"
          hint="トップ画面マップの軌跡。線 / 半透明の点群"
          value={ui.galleryTrailStyle}
          options={[
            { value: 'tube', label: '線' },
            { value: 'points', label: '点群' },
          ]}
          onChange={v => setUi({ galleryTrailStyle: v })}
        />
        <SliderRow
          label="閾値zoom"
          hint="以上はm一定 / 未満は画面ピクセル一定"
          value={radii.zoomThreshold}
          min={10} max={20} step={0.5} unit=""
          onChange={v => setRadii({ zoomThreshold: v })}
        />
        <SliderRow
          label="チューブ半径 (m@閾値zoom)"
          value={radii.tubeRadius}
          min={0.1} max={10} step={0.1} unit="m"
          onChange={v => setRadii({ tubeRadius: v })}
        />
        <SliderRow
          label="ドット半径 (m@閾値zoom)"
          value={radii.dotRadius}
          min={0.2} max={20} step={0.1} unit="m"
          onChange={v => setRadii({ dotRadius: v })}
        />
        <SliderRow
          label="高度倍率 (単色表現)"
          hint="0 で平面"
          value={ui.altitudeScale}
          min={0} max={30} step={0.5} unit="x"
          onChange={v => setUi({ altitudeScale: v })}
        />
        <div className="settings-row-actions">
          <button className="settings-btn-secondary" onClick={resetRadii}>
            <Icon icon="lucide:rotate-ccw" />
            <span>軌跡サイズをリセット</span>
          </button>
          <button className="settings-btn-secondary" onClick={resetUi}>
            <Icon icon="lucide:rotate-ccw" />
            <span>UIをリセット</span>
          </button>
        </div>
      </Section>

      <Section title="実験機能">
        <ToggleRow
          label="環世界記譜法"
          hint="ペタンプの足音で軌跡を書き起こす実験画面 (Run詳細から開ける)"
          value={experimental.notation}
          onChange={v => setExperimental({ notation: v })}
        />
      </Section>

      <Section title="ペタンプ">
        <button className="settings-btn-secondary" onClick={() => navigate('/prompt-logs')}>
          <Icon icon="lucide:scroll-text" />
          <span>プロンプトログを見る</span>
        </button>
        <button
          className="settings-btn-secondary"
          onClick={onResetLog}
          disabled={busy !== null}
        >
          <Icon icon="lucide:eraser" />
          <span>{labelFor('log', busy, done, 'プロンプトログを削除')}</span>
        </button>
        <button
          className="settings-btn-secondary"
          onClick={onResetOnboarding}
          disabled={busy !== null}
        >
          <Icon icon="lucide:user-round-x" />
          <span>{labelFor('onboarding', busy, done, 'オンボーディングをやり直す')}</span>
        </button>
        <button
          className="settings-btn-danger"
          onClick={onResetAll}
          disabled={busy !== null}
        >
          <Icon icon="lucide:trash-2" />
          <span>{labelFor('all', busy, done, 'ペタンプをまっさらに戻す')}</span>
        </button>
      </Section>

      {user && (
        <Section title="アカウント">
          <button
            className="settings-btn-secondary"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            <Icon icon="lucide:log-out" />
            <span>{signingOut ? 'ログアウト中…' : 'ログアウト'}</span>
          </button>
        </Section>
      )}

      <Section title="Spotify連携">
        {spotifyAuth ? (
          <>
            <p className="settings-credit" style={{ margin: 0 }}>
              {spotifyCurrent
                ? `${spotifyCurrent.isPlaying ? '再生中' : '一時停止'}: ${spotifyCurrent.name} — ${spotifyCurrent.artists.join(', ')}`
                : '接続中（再生中の曲なし）'}
            </p>
            <button className="settings-btn-secondary" onClick={disconnectSpotify}>
              <Icon icon="lucide:unplug" />
              <span>解除</span>
            </button>
          </>
        ) : (
          <button
            className="settings-btn-secondary"
            onClick={onConnectSpotify}
            disabled={connectingSpotify}
          >
            <Icon icon="lucide:music" />
            <span>{connectingSpotify ? '接続中…' : 'Spotifyに接続'}</span>
          </button>
        )}
      </Section>

      <Section title="クレジット">
        <p className="settings-credit">
          BPM data provided by{' '}
          <a
            className="settings-credit-link"
            href="https://getsongbpm.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            GetSongBPM
          </a>
        </p>
      </Section>
    </div>
  )
}

function labelFor(
  key: AsyncActionKey,
  busy: AsyncActionKey | null,
  done: AsyncActionKey | null,
  base: string,
): string {
  if (busy === key) return '実行中…'
  if (done === key) return '完了しました'
  return base
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3 className="settings-section-title">{title}</h3>
      <div className="settings-section-body">{children}</div>
    </section>
  )
}

interface SliderRowProps {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onChange: (v: number) => void
}

function SliderRow({ label, hint, value, min, max, step, unit, onChange }: SliderRowProps) {
  const decimals = step < 1 ? 2 : 0
  return (
    <div className="settings-slider-row">
      <div className="settings-slider-head">
        <span className="settings-slider-label">{label}</span>
        <span className="settings-slider-value">
          {value.toFixed(decimals)}{unit}
        </span>
      </div>
      {hint && <div className="settings-slider-hint">{hint}</div>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}

interface SegmentRowProps<T extends string> {
  label: string
  hint?: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}

function SegmentRow<T extends string>({ label, hint, value, options, onChange }: SegmentRowProps<T>) {
  return (
    <div className="settings-slider-row">
      <div className="settings-slider-head">
        <span className="settings-slider-label">{label}</span>
        {hint && <span className="settings-slider-value">{hint}</span>}
      </div>
      <div className="settings-segment">
        {options.map(o => (
          <button
            key={o.value}
            className={`settings-segment-btn${value === o.value ? ' is-active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface ColorRowProps {
  label: string
  value: string
  onChange: (v: string) => void
}

interface ToggleRowProps {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}

function ToggleRow({ label, hint, value, onChange }: ToggleRowProps) {
  return (
    <div className="settings-slider-row">
      <div className="settings-slider-head">
        <span className="settings-slider-label">{label}</span>
        <button
          type="button"
          className={`settings-segment-btn${value ? ' is-active' : ''}`}
          onClick={() => onChange(!value)}
          aria-pressed={value}
        >
          {value ? 'ON' : 'OFF'}
        </button>
      </div>
      {hint && <div className="settings-slider-hint">{hint}</div>}
    </div>
  )
}

function ColorRow({ label, value, onChange }: ColorRowProps) {
  return (
    <div className="settings-color-row">
      <span className="settings-slider-label">{label}</span>
      <div className="settings-color-control">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.currentTarget.value)}
          aria-label={label}
        />
        <span className="settings-color-hex">{value.toUpperCase()}</span>
      </div>
    </div>
  )
}

function PalettePreview({ overrides }: { overrides: Record<string, Partial<Palette> | undefined> }) {
  return (
    <div className="settings-palette-grid">
      {WEATHERS.map(w => (
        <div key={w} className="settings-palette-row">
          <span className="settings-palette-row-label">{WEATHER_LABEL[w]}</span>
          {TIMES.map(t => {
            const def = getDefaultPalette(w, t)
            const ov = overrides[paletteKey(w, t)] ?? {}
            const p: Palette = { ...def, ...ov }
            return (
              <div
                key={t}
                className="settings-palette-swatch"
                title={`${WEATHER_LABEL[w]} × ${TIME_LABEL[t]}\nbg ${p.bg} / accent ${p.accent}`}
                style={{ background: p.bg }}
              >
                <span className="settings-palette-accent" style={{ background: p.accent }} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
