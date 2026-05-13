import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {PathLayer, ScatterplotLayer} from "@deck.gl/layers";
import {Icon} from "@iconify/react";
import {BaseMap, useMap, useMapZoom} from "../components/map/BaseMap";
import {DeckOverlay} from "../components/map/DeckOverlay";
import {AreaLabel} from "../components/map/AreaLabel";
import {LiveStats} from "../components/recording/LiveStats";
import {useGpsRecorder} from "../hooks/useGpsRecorder";
import {useCurrentPosition} from "../hooks/useCurrentPosition";
import {useActivePalette} from "../hooks/useActivePalette";
import {hexToRgb} from "../utils/themePalettes";
import {useRunStore} from "../store/useRunStore";
import {useSettingsStore, type Radii} from "../store/useSettingsStore";
import {useTransitionStore} from "../store/useTransitionStore";
import {effectiveRadius} from "../utils/effectiveRadius";
import {acceptedPoints, accuracyGate, warmupGate, minDistanceGate, maxSpeedGate} from "../utils/recordingFilters";
import {fetchAreaName} from "../hooks/useReverseGeocode";
import {RecordingDebugPanel} from "../components/recording/RecordingDebugPanel";
import type {Run, TrackPoint} from "../types";

const MIN_ZOOM = 12.5;
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2;

// 序盤はbboxが大きく変化するので密に、安定する後半は粗く再フィットする。
const FIT_INTERVAL_EARLY = 3;
const FIT_INTERVAL_LATE = 20;
const EARLY_PHASE_THRESHOLD = 100;
const INITIAL_ZOOM = 17;
const FIT_MAX_ZOOM = 18;
const FIT_DURATION_MS = 500;
const FOLLOW_DURATION_MS = 400;

type ViewMode = "follow" | "overview";

interface RunningBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

function BoundsFitter({
  trackPoints,
  enabled,
}: {
  trackPoints: TrackPoint[];
  enabled: boolean;
}) {
  const {map} = useMap();
  const lastFitLengthRef = useRef(0);
  const bboxRef = useRef<RunningBbox | null>(null);
  const scannedUpToRef = useRef(0);

  // モード切替で無効化されたらリセットして、再有効化時に最初のフィットを再実行できるようにする。
  useEffect(() => {
    if (enabled) return;
    lastFitLengthRef.current = 0;
    bboxRef.current = null;
    scannedUpToRef.current = 0;
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !map) return;
    const len = trackPoints.length;
    if (len === 0) return;

    // 新規点だけ走査してbboxをO(1)で更新する。refは差し替えのみ（mutationしない）。
    let bbox: RunningBbox | null = bboxRef.current ? {...bboxRef.current} : null;
    let bboxExpanded = false;
    for (let i = scannedUpToRef.current; i < len; i++) {
      const p = trackPoints[i];
      if (!bbox) {
        bbox = {minLng: p.lng, minLat: p.lat, maxLng: p.lng, maxLat: p.lat};
        bboxExpanded = true;
        continue;
      }
      if (p.lng < bbox.minLng) { bbox = {...bbox, minLng: p.lng}; bboxExpanded = true; }
      if (p.lat < bbox.minLat) { bbox = {...bbox, minLat: p.lat}; bboxExpanded = true; }
      if (p.lng > bbox.maxLng) { bbox = {...bbox, maxLng: p.lng}; bboxExpanded = true; }
      if (p.lat > bbox.maxLat) { bbox = {...bbox, maxLat: p.lat}; bboxExpanded = true; }
    }
    bboxRef.current = bbox;
    scannedUpToRef.current = len;

    const interval = len < EARLY_PHASE_THRESHOLD ? FIT_INTERVAL_EARLY : FIT_INTERVAL_LATE;
    const isFirst = lastFitLengthRef.current === 0;
    const isPeriodic = len - lastFitLengthRef.current >= interval;
    if (!isFirst && !isPeriodic) return;
    // 周期は来たがbboxが拡大していない場合、フィットしても見た目は同じなのでスキップ。
    if (!isFirst && !bboxExpanded) {
      lastFitLengthRef.current = len;
      return;
    }

    if (len === 1 || !bbox) {
      map.easeTo({
        center: [trackPoints[0].lng, trackPoints[0].lat],
        zoom: INITIAL_ZOOM,
        duration: FIT_DURATION_MS,
      });
    } else {
      const bounds: [[number, number], [number, number]] = [
        [bbox.minLng, bbox.minLat],
        [bbox.maxLng, bbox.maxLat],
      ];
      map.fitBounds(bounds, {
        padding: 60,
        duration: FIT_DURATION_MS,
        maxZoom: FIT_MAX_ZOOM,
      });
    }
    lastFitLengthRef.current = len;
  }, [map, trackPoints, enabled]);

  return null;
}

function FollowUpdater({
  trackPoints,
  enabled,
}: {
  trackPoints: TrackPoint[];
  enabled: boolean;
}) {
  const {map} = useMap();
  const wasEnabledRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      wasEnabledRef.current = false;
      return;
    }
    const last = trackPoints.at(-1);
    if (!last) {
      wasEnabledRef.current = true;
      return;
    }
    const justEnabled = !wasEnabledRef.current;
    wasEnabledRef.current = true;

    const opts: {
      center: [number, number];
      pitch: number;
      duration: number;
      zoom?: number;
      bearing?: number;
    } = {
      center: [last.lng, last.lat],
      pitch: 45,
      duration: justEnabled ? FIT_DURATION_MS : FOLLOW_DURATION_MS,
    };
    if (justEnabled) {
      opts.zoom = INITIAL_ZOOM;
    }
    // GPS headingは停止時nullやNaNになるので、その場合は前回のbearingを維持。
    if (last.heading != null && !Number.isNaN(last.heading) && last.heading >= 0) {
      opts.bearing = last.heading;
    }
    map.easeTo(opts);
  }, [map, trackPoints, enabled]);

  return null;
}

function OverviewPitchReset({enabled}: {enabled: boolean}) {
  const {map} = useMap();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      appliedRef.current = false;
      return;
    }
    if (appliedRef.current) return;
    appliedRef.current = true;
    // overview突入時にだけpitch/bearingをリセット。以降のfitBoundsはこの角度を維持する。
    map.easeTo({pitch: 0, bearing: 0, duration: FIT_DURATION_MS});
  }, [map, enabled]);

  return null;
}

function RecordingLayers({
  trackPoints,
  acceptedTrackPoints,
  fallbackPosition,
  radii,
  showRawTube,
}: {
  trackPoints: TrackPoint[];
  acceptedTrackPoints: TrackPoint[];
  fallbackPosition: [number, number] | null;
  radii: Radii;
  showRawTube: boolean;
}) {
  const zoom = useMapZoom();
  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5));
  const {palette} = useActivePalette();
  const accentRgb = useMemo<[number, number, number]>(
    () => hexToRgb(palette.accent),
    [palette.accent],
  );

  const tubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius) * 2;
  const rawTubeWidth = effectiveRadius(zoom, radii.zoomThreshold, radii.rawTubeRadius) * 2;
  const baseDotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius);
  const dotRadius = baseDotRadius * CURRENT_DOT_SCALE;

  const acceptedPath = useMemo(
    () => acceptedTrackPoints.map(p => [p.lng, p.lat, 0] as [number, number, number]),
    [acceptedTrackPoints],
  );
  const rawPath = useMemo(
    () => trackPoints.map(p => [p.lng, p.lat, 0] as [number, number, number]),
    [trackPoints],
  );
  const dotData = useMemo(() => {
    const last = acceptedTrackPoints.at(-1);
    const pos: [number, number] | null = last
      ? [last.lng, last.lat]
      : fallbackPosition;
    return pos ? [{position: pos}] : [];
  }, [acceptedTrackPoints, fallbackPosition]);

  const tubeColor: [number, number, number, number] = [
    ...accentRgb,
    Math.round(128 * t),
  ];
  const rawTubeColor: [number, number, number, number] = [
    230,
    60,
    60,
    Math.round(255 * t),
  ];
  const dotColor: [number, number, number, number] = [
    ...accentRgb,
    Math.round(255 * t),
  ];

  const layers = useMemo(() => {
    if (t === 0) return [];
    const rawTubeLayer = showRawTube && rawPath.length >= 2
      ? new PathLayer({
          id: "raw-tube",
          data: [rawPath],
          getPath: d => d,
          getColor: rawTubeColor,
          getWidth: rawTubeWidth,
          widthUnits: "meters",
          capRounded: true,
          jointRounded: true,
          billboard: true,
          updateTriggers: {getColor: rawTubeColor},
        })
      : null;
    const liveTubeLayer = acceptedPath.length >= 2
      ? new PathLayer({
          id: "live-tube",
          data: [acceptedPath],
          getPath: d => d,
          getColor: tubeColor,
          getWidth: tubeWidth,
          widthUnits: "meters",
          capRounded: true,
          jointRounded: true,
          billboard: true,
          updateTriggers: {getColor: tubeColor},
        })
      : null;
    const dotLayer = new ScatterplotLayer({
      id: "live-dot",
      data: dotData,
      getPosition: (d: {position: [number, number]}) => [d.position[0], d.position[1], 0],
      getRadius: dotRadius,
      radiusUnits: "meters",
      getFillColor: dotColor,
      billboard: true,
      updateTriggers: {getFillColor: dotColor},
    });
    return [
      ...(rawTubeLayer ? [rawTubeLayer] : []),
      ...(liveTubeLayer ? [liveTubeLayer] : []),
      dotLayer,
    ];
  }, [acceptedPath, rawPath, dotData, t, tubeWidth, rawTubeWidth, dotRadius, tubeColor, rawTubeColor, dotColor, showRawTube]);

  return <DeckOverlay layers={layers} />;
}

export function RecordingPage() {
  const navigate = useNavigate();
  const radii = useSettingsStore(s => s.radii);
  const setRadii = useSettingsStore(s => s.setRadii);
  const resetRadii = useSettingsStore(s => s.resetRadii);
  const filterSettings = useSettingsStore(s => s.filterSettings);
  const setFilterSettings = useSettingsStore(s => s.setFilterSettings);
  const resetFilterSettings = useSettingsStore(s => s.resetFilterSettings);
  const filters = useMemo(
    () => [
      accuracyGate(9),
      warmupGate(3000),
      minDistanceGate(5),
      maxSpeedGate(filterSettings.maxSpeed),
    ],
    [filterSettings.maxSpeed],
  );
  const kalmanConfig = useMemo(
    () => ({
      sigmaA: filterSettings.kalmanSigmaA,
      gateChi2: filterSettings.kalmanGateChi2,
      fallbackVarianceM2: 400,
      initialVelVariance: 100,
    }),
    [filterSettings.kalmanSigmaA, filterSettings.kalmanGateChi2],
  );
  const {isRecording, trackPoints, error, consecutiveRejections, lastMahalanobis2, start, stop} = useGpsRecorder(filters, kalmanConfig);
  const {addRun} = useRunStore();
  const [recordingDebugOpen, setRecordingDebugOpen] = useState(false);
  const [showRawTube, setShowRawTube] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("follow");
  const [warningOpen, setWarningOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const warningShownRef = useRef(false);
  const transitionPhase = useTransitionStore(s => s.phase);
  // マウント時点で flag を snapshot。reset() 後では失われるため。
  const [fromOnboarding] = useState(() => useTransitionStore.getState().fromOnboarding);

  // 入場時の円アニメーション（iris系phase）が終わって idle に戻ったタイミングで
  // popup を出す。onboarding 経由のときは初回チュートリアルを、それ以外は
  // 既存の「注意！」を表示する (2連打を避けるため排他)。
  useEffect(() => {
    if (warningShownRef.current) return;
    if (transitionPhase !== "idle") return;
    warningShownRef.current = true;
    if (fromOnboarding) setIntroOpen(true);
    else setWarningOpen(true);
  }, [transitionPhase, fromOnboarding]);
  const initialCenter = useCurrentPosition();
  const acceptedTrackPoints = useMemo(() => acceptedPoints(trackPoints), [trackPoints]);

  useEffect(() => {
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFinish = async () => {
    let points = trackPoints;
    if (isRecording) {
      points = await stop();
    }
    if (points.length === 0) {
      navigate("/");
      return;
    }
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const areaName = (await fetchAreaName(centerLng, centerLat)) ?? undefined;
    const run: Run = {
      id: crypto.randomUUID(),
      name: `ラン ${new Date().toLocaleDateString("ja-JP")}`,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      trackPoints: points,
      notes: [],
      areaName,
    };
    await addRun(run);
    navigate(`/run/${run.id}/result`);
  };

  return (
    <div className="page">
      <div className="map-container">
        {initialCenter !== undefined && (
          <BaseMap
            initialCenter={initialCenter ?? undefined}
            initialZoom={INITIAL_ZOOM}
            interactive={false}
          >
            <BoundsFitter
              trackPoints={acceptedTrackPoints}
              enabled={viewMode === "overview"}
            />
            <FollowUpdater
              trackPoints={acceptedTrackPoints}
              enabled={viewMode === "follow"}
            />
            <OverviewPitchReset enabled={viewMode === "overview"} />
            <RecordingLayers
              trackPoints={trackPoints}
              acceptedTrackPoints={acceptedTrackPoints}
              fallbackPosition={initialCenter ?? null}
              radii={radii}
              showRawTube={showRawTube}
            />
            <AreaLabel />
          </BaseMap>
        )}
      </div>

      <button
        className="back-btn"
        onClick={() => navigate("/")}
        aria-label="閉じる"
      >
        <Icon icon="lucide:x" />
      </button>

      <button
        className="debug-btn"
        onClick={() => setRecordingDebugOpen(true)}
        title="記録デバッグ"
        aria-label="記録デバッグ"
      >
        <Icon icon="lucide:braces" />
      </button>

      <div className="bottom-bar">
        {error && <div className="error-banner">{error}</div>}
        <button
          className="view-mode-toggle"
          onClick={() => setViewMode(m => (m === "follow" ? "overview" : "follow"))}
          title={viewMode === "follow" ? "全体表示" : "現在位置"}
          aria-label={viewMode === "follow" ? "全体表示に切り替え" : "現在位置に切り替え"}
        >
          <Icon icon={viewMode === "follow" ? "lucide:maximize" : "lucide:locate-fixed"} />
        </button>
        <LiveStats trackPoints={acceptedTrackPoints} />
        <div className="bottom-bar-actions">
          <button
            className="toggle-btn"
            onClick={isRecording ? stop : start}
            aria-label={isRecording ? "停止" : "再開"}
          >
            <Icon icon={isRecording ? "lucide:pause" : "lucide:play"} />
          </button>
          <button className="finish-btn" onClick={handleFinish}>
            <span>FINISH</span>
          </button>
        </div>
      </div>

      {warningOpen && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-warning">
            <p className="recording-warning-title">注意！</p>
            <p className="chat-modal-text">
              ブラウザ版では、記録中に画面をオフにしたりアプリを切り替えると、レコーディングが停止してしまいます。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => setWarningOpen(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {introOpen && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-intro">
            <p className="chat-modal-text">
              このアプリは、速く走るためのものではありません。
            </p>
            <p className="chat-modal-text">
              歩いても、走っても、休んでも大丈夫です。あなたのペースで進んでください。
            </p>
            <p className="chat-modal-text">
              動いたぶんだけ、ペタンプのセカイが広がっていきます。
            </p>
            <p className="chat-modal-text">
              終わるときは、下の "FINISH" を押してください。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => {
                  setIntroOpen(false);
                  // intro を閉じた直後に通常の注意モーダルへ繋ぐ。
                  setWarningOpen(true);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {recordingDebugOpen && (
        <RecordingDebugPanel
          trackPoints={trackPoints}
          consecutiveRejections={consecutiveRejections}
          lastMahalanobis2={lastMahalanobis2}
          radii={radii}
          onChangeRadii={setRadii}
          onResetRadii={resetRadii}
          filterSettings={filterSettings}
          onChangeFilterSettings={setFilterSettings}
          onResetFilterSettings={resetFilterSettings}
          showRawTube={showRawTube}
          onToggleRawTube={setShowRawTube}
          onClose={() => setRecordingDebugOpen(false)}
        />
      )}
    </div>
  );
}
