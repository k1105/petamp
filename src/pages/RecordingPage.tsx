import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {SimpleMeshLayer} from "@deck.gl/mesh-layers";
import {SphereGeometry, CylinderGeometry} from "@luma.gl/engine";
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
import {buildTubeSegments, buildTubeJoints} from "../utils/tubeData";
import {effectiveRadius} from "../utils/effectiveRadius";
import {acceptedPoints, accuracyGate, warmupGate, minDistanceGate, maxSpeedGate} from "../utils/recordingFilters";
import {fetchAreaName} from "../hooks/useReverseGeocode";
import {RecordingDebugPanel} from "../components/recording/RecordingDebugPanel";
import type {Run, TrackPoint} from "../types";

const sphere = new SphereGeometry({radius: 1, nlat: 20, nlong: 20});
const cylinder = new CylinderGeometry({radius: 1, height: 1, nradial: 12});
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

  const tubeRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.tubeRadius);
  const rawTubeRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.rawTubeRadius);
  const baseDotRadius = effectiveRadius(zoom, radii.zoomThreshold, radii.dotRadius);
  const dotRadius = baseDotRadius * CURRENT_DOT_SCALE;
  const jointRadius = tubeRadius * 1.02;

  const tubeData = useMemo(
    () => buildTubeSegments(acceptedTrackPoints),
    [acceptedTrackPoints],
  );
  const jointData = useMemo(
    () => buildTubeJoints(acceptedTrackPoints),
    [acceptedTrackPoints],
  );
  const rawTubeData = useMemo(
    () => buildTubeSegments(trackPoints),
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
  const mat = {
    ambient: 1,
    diffuse: 0,
    shininess: 0,
    specularColor: [0, 0, 0] as [number, number, number],
  };

  const layers = useMemo(() => {
    if (t === 0) return [];
    const rawTubeLayer = showRawTube
      ? new SimpleMeshLayer({
          id: "raw-tube",
          data: rawTubeData,
          mesh: cylinder,
          getPosition: (d) => d.position,
          getScale: (d) => [rawTubeRadius, d.length, rawTubeRadius],
          getOrientation: (d) => d.orientation,
          getColor: rawTubeColor,
          material: mat,
          updateTriggers: {getScale: rawTubeRadius},
        })
      : null;
    return [
      ...(rawTubeLayer ? [rawTubeLayer] : []),
      new SimpleMeshLayer({
        id: "live-tube",
        data: tubeData,
        mesh: cylinder,
        getPosition: (d) => d.position,
        getScale: (d) => [tubeRadius, d.length, tubeRadius],
        getOrientation: (d) => d.orientation,
        getColor: tubeColor,
        material: mat,
        updateTriggers: {getScale: tubeRadius},
      }),
      new SimpleMeshLayer({
        id: "live-joints",
        data: jointData,
        mesh: sphere,
        getPosition: (d) => d.position,
        getScale: [jointRadius, jointRadius, jointRadius],
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: "live-dot",
        data: dotData,
        mesh: sphere,
        getPosition: (d: {position: [number, number]}) =>
          [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [dotRadius, dotRadius, dotRadius],
        getColor: dotColor,
        material: mat,
      }),
    ];
  }, [tubeData, jointData, rawTubeData, dotData, t, tubeRadius, rawTubeRadius, dotRadius, jointRadius, accentRgb, showRawTube]);

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
      accuracyGate(25),
      warmupGate(3000),
      minDistanceGate(2),
      maxSpeedGate(filterSettings.maxSpeed),
    ],
    [filterSettings.maxSpeed],
  );
  const {isRecording, trackPoints, error, consecutiveRejections, start, stop} = useGpsRecorder(filters);
  const {addRun} = useRunStore();
  const [recordingDebugOpen, setRecordingDebugOpen] = useState(false);
  const [showRawTube, setShowRawTube] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("follow");
  const [warningOpen, setWarningOpen] = useState(false);
  const warningShownRef = useRef(false);
  const transitionPhase = useTransitionStore(s => s.phase);

  // 入場時の円アニメーション（iris系phase）が終わって idle に戻ったタイミングで警告を出す。
  useEffect(() => {
    if (warningShownRef.current) return;
    if (transitionPhase !== "idle") return;
    warningShownRef.current = true;
    setWarningOpen(true);
  }, [transitionPhase]);
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
      points = stop();
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
                className="chat-modal-btn chat-modal-btn-confirm"
                onClick={() => setWarningOpen(false)}
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
