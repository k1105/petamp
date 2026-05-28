import { useEffect, useRef } from 'react'
import { useSpotifyStore } from '../store/useSpotifyStore'
import { useJoystickStore } from '../store/useJoystickStore'
import type { SpotifyTrackSnapshot } from '../spotify/types'
import { fetchSongInfoForTrack, getCachedSongInfo } from '../services/bpmCache'
import type { SongInfo } from '../services/getsongbpm'

const BOB_AMPLITUDE_PX = 6
// Head moves in sync with the eyes but at reduced amplitude — gives a subtle
// "body bobbing along" feel without overpowering the eye bounce.
const HEAD_AMPLITUDE_RATIO = 0.3
// 1 = bob on every beat (snappy); 2 = bob every other beat (chill).
const BOBS_PER_BEAT = 1
// Downbeat (beat 1 of each bar) gets boosted amplitude + pulse, giving a
// "ち、ち、ち、ドン！" feel even though we can't sync to true downbeats
// (audio-analysis is gone — our beat 0 starts at progress_ms=0 which is
// arbitrary relative to the song's musical bar).
const DOWNBEAT_BOOST = 1.5
// Used when GetSongBPM has no entry for the playing track (or is still
// fetching). danceability=0 keeps the bob alive (BPM-driven motion) but
// suppresses the pulse — we'd rather under-react than fake a confidence
// we don't have for unknown tracks.
const FALLBACK_INFO: SongInfo = { bpm: 120, beatsPerBar: 4, danceability: 0 }

const FAB_ICON_SELECTOR = '.fab.fab-sheet .fab-icon'
const ACTIVE_BODY_CLASS = 'bpm-bob-active'

// Module-level mutables: useMetaballSheet reads these each frame to (a)
// translate the blob peak with the head bob, and (b) scale-pulse the blob
// on each beat. Kept outside React state to avoid per-frame re-renders.
export const headBobOffsetRef: { current: number } = { current: 0 }
export const headPulseScaleRef: { current: number } = { current: 1 }
// Drives the size of the current-position marker on the map. 1 = idle (no
// Spotify), >1 while audio is playing. Larger amplitude than headPulseScale
// because the dot is small and needs visible motion at map scale.
export const currentDotPulseScaleRef: { current: number } = { current: 1 }

// Map danceability 0..100 to amplitude multiplier 0.6..1.4 — keeps a
// reasonable "always animating" floor even for ballads, gives extra punch
// for dance tracks.
function danceabilityToScale(d: number): number {
  const clamped = Math.max(0, Math.min(100, d))
  return 0.6 + (clamped / 100) * 0.8
}

// Drives the FAB icon's vertical bob and the metaball blob's scale pulse
// from Spotify playback position when the user is connected and audio is
// playing. Reverts to the CSS keyframe animation (petamp-idle-bob) otherwise.
// Mount once near the app root (alongside useSpotifyPlaybackPoller).
export function useBpmSyncedBob(): void {
  const auth = useSpotifyStore((s) => s.auth)
  const current = useSpotifyStore((s) => s.current)
  // armed = ジョイスティック化中。.fab-icon に scale(1/1.8) が CSS で当たって
  // いる時間帯なので、インライン transform で上書きすると目だけ巨大化する。
  const armed = useJoystickStore((s) => s.armed)
  const isActive = !!auth && !!current && current.isPlaying && !armed

  const snapshotRef = useRef<SpotifyTrackSnapshot | null>(current)
  useEffect(() => {
    snapshotRef.current = current
  }, [current])

  // Per-track song info (BPM + beatsPerBar + danceability). Read synchronously
  // from cache on track change; if cache misses (undefined), kick off a fetch
  // and adopt the result. `null` (looked up but no entry) sticks with fallback.
  const trackId = current?.trackId
  const infoRef = useRef<SongInfo>(FALLBACK_INFO)

  useEffect(() => {
    if (!trackId || !current) {
      infoRef.current = FALLBACK_INFO
      return
    }
    const cached = getCachedSongInfo(trackId)
    if (cached !== undefined) {
      infoRef.current = cached ?? FALLBACK_INFO
      return
    }
    infoRef.current = FALLBACK_INFO
    let cancelled = false
    fetchSongInfoForTrack(trackId, current.name, current.artists[0] ?? '')
      .then((result) => {
        if (cancelled) return
        infoRef.current = result ?? FALLBACK_INFO
      })
      .catch(() => {
        // already logged in cache layer; keep fallback
      })
    return () => {
      cancelled = true
    }
    // current.name/artists are stable for a given trackId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId])

  useEffect(() => {
    if (!isActive) {
      document.body.classList.remove(ACTIVE_BODY_CLASS)
      const el = document.querySelector<HTMLElement>(FAB_ICON_SELECTOR)
      if (el) el.style.transform = ''
      headBobOffsetRef.current = 0
      headPulseScaleRef.current = 1
      currentDotPulseScaleRef.current = 1
      return
    }
    document.body.classList.add(ACTIVE_BODY_CLASS)

    let raf = 0
    const tick = () => {
      const snap = snapshotRef.current
      if (snap && snap.isPlaying) {
        const info = infoRef.current
        const beatPeriodMs = 60_000 / info.bpm
        const bobPeriodMs = beatPeriodMs * BOBS_PER_BEAT
        const positionMs =
          snap.serverProgressMs + (Date.now() - snap.localReceivedAt)

        // Bob position (continuous half-sine over each bob cycle).
        const bobPhase = (positionMs % bobPeriodMs) / bobPeriodMs
        const bobBaseY = -BOB_AMPLITUDE_PX * Math.sin(bobPhase * Math.PI)

        // Downbeat detection: which beat of the current bar are we in?
        // (Our "beat 0" is arbitrary — anchored to progress_ms=0, not the
        // song's actual musical downbeat.)
        const beatIndex = Math.floor(positionMs / beatPeriodMs)
        const isDownbeat = beatIndex % info.beatsPerBar === 0
        const downbeatBoost = isDownbeat ? DOWNBEAT_BOOST : 1
        const danceScale = danceabilityToScale(info.danceability)

        const eyesY = bobBaseY * danceScale * downbeatBoost
        const el = document.querySelector<HTMLElement>(FAB_ICON_SELECTOR)
        if (el) el.style.transform = `translateY(${eyesY.toFixed(2)}px)`
        headBobOffsetRef.current = eyesY * HEAD_AMPLITUDE_RATIO

        // Metaball pulse: punchy expansion on beat onset, exponential decay
        // over the rest of the beat. Amplitude is fully proportional to
        // danceability so ballads (low danceability) have no pulse at all.
        const beatPhase = (positionMs % beatPeriodMs) / beatPeriodMs
        const pulseEnv = Math.exp(-3 * beatPhase) // 1 at onset → ~0.05 at end
        const pulseAmp = (info.danceability / 100) * 0.10 * downbeatBoost
        headPulseScaleRef.current = 1 + pulseAmp * pulseEnv

        // Map current-position marker pulse: follows the same sin curve as
        // the eye bob (continuous, not punchy), gated by danceability so
        // unknown/ballad tracks leave the marker static.
        const dotAmp = (info.danceability / 100) * 0.3 * downbeatBoost
        currentDotPulseScaleRef.current = 1 + dotAmp * Math.sin(bobPhase * Math.PI)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      document.body.classList.remove(ACTIVE_BODY_CLASS)
      const el = document.querySelector<HTMLElement>(FAB_ICON_SELECTOR)
      if (el) el.style.transform = ''
      headBobOffsetRef.current = 0
      headPulseScaleRef.current = 1
      currentDotPulseScaleRef.current = 1
    }
  }, [isActive])
}
