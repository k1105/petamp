import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {Capacitor} from "@capacitor/core";
import {useGeolocationPermission} from "../hooks/useGeolocationPermission";
import {PathLayer, ScatterplotLayer} from "@deck.gl/layers";
import {Icon} from "@iconify/react";
import {BaseMap} from "../components/map/BaseMap";
import {useMap, useMapZoom} from "../components/map/MapContext";
import {DeckOverlay} from "../components/map/DeckOverlay";
import {AreaLabel} from "../components/map/AreaLabel";
import {NowPlayingLabel} from "../components/map/NowPlayingLabel";
import {LiveStats} from "../components/recording/LiveStats";
import {useGpsRecorder} from "../hooks/useGpsRecorder";
import {useCurrentPosition} from "../hooks/useCurrentPosition";
import {useActivePalette} from "../hooks/useActivePalette";
import {hexToRgb} from "../utils/themePalettes";
import {useRunStore} from "../store/useRunStore";
import {useSettingsStore, type Radii} from "../store/useSettingsStore";
import {useTransitionStore} from "../store/useTransitionStore";
import {usePostRunLoadingStore} from "../store/usePostRunLoadingStore";
import {effectiveRadius} from "../utils/effectiveRadius";
import {useBpmDotScale} from "../hooks/useBpmDotScale";
import {acceptedPoints, accuracyGate, warmupGate, minDistanceGate, maxSpeedGate} from "../utils/recordingFilters";
import {fetchAreaName} from "../hooks/useReverseGeocode";
import {fetchWeatherForCoords} from "../utils/fetchWeather";
import {RecordingDebugPanel} from "../components/recording/RecordingDebugPanel";
import type {Run, TrackPoint} from "../types";

const MIN_ZOOM = 12.5;
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2;

// 序盤はbboxが大きく変化するので密に、安定する後半は粗く再フィットする。
const FIT_INTERVAL_EARLY = 3;
const FIT_INTERVAL_LATE = 20;
const EARLY_PHASE_THRESHOLD = 100;
const INITIAL_ZOOM = 18;
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
        pitch: 0,
        bearing: 0,
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
        pitch: 0,
        bearing: 0,
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
  const bpmDotScale = useBpmDotScale();

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
      getRadius: dotRadius * bpmDotScale,
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
  }, [acceptedPath, rawPath, dotData, t, tubeWidth, rawTubeWidth, dotRadius, tubeColor, rawTubeColor, dotColor, showRawTube, bpmDotScale]);

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
      accuracyGate(15),
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
  const finishBtnRef = useRef<HTMLButtonElement>(null);
  const startPostRunLoading = usePostRunLoadingStore(s => s.start);
  const resetPostRunLoading = usePostRunLoadingStore(s => s.reset);
  const [recordingDebugOpen, setRecordingDebugOpen] = useState(false);
  const [showRawTube, setShowRawTube] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("follow");
  const [warningOpen, setWarningOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const warningShownRef = useRef(false);
  const transitionPhase = useTransitionStore(s => s.phase);
  // マウント時点で flag を snapshot。reset() 後では失われるため。
  const [fromOnboarding] = useState(() => useTransitionStore.getState().fromOnboarding);

  // Web (非 native) で geolocation が拒否されているとランは始められない。
  // Permissions API の状態 変化を購読し、拒否時はモーダルで案内する。
  const permissionState = useGeolocationPermission();
  const isNative = Capacitor.isNativePlatform();
  const isPermissionDenied = !isNative && permissionState === "denied";

  // 入場時の円アニメーション（iris系phase）が終わって idle に戻ったタイミングで
  // popup を出す。onboarding 経由のときは初回チュートリアルを、それ以外は
  // 既存の「注意！」を表示する (2連打を避けるため排他)。注意モーダルは
  // バックグラウンド継続できる native アプリでは出さない (web のみ)。
  // 位置情報拒否時は許可案内モーダルが排他的に出るので、ここでは何も出さない。
  useEffect(() => {
    if (warningShownRef.current) return;
    if (transitionPhase !== "idle") return;
    if (permissionState === "unknown") return; // 権限状態の確定待ち
    if (isPermissionDenied) return;
    warningShownRef.current = true;
    // iris アニメ完了 (transitionPhase==='idle') の1ショットでのみ発火する。
    if (fromOnboarding) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIntroOpen(true);
    } else if (!isNative) {
      setWarningOpen(true);
    }
  }, [transitionPhase, fromOnboarding, permissionState, isPermissionDenied, isNative]);
  const initialCenter = useCurrentPosition();
  const acceptedTrackPoints = useMemo(() => acceptedPoints(trackPoints), [trackPoints]);

  // 位置情報が拒否されていない場合だけ記録を開始する。
  // 途中で拒否に切り替わったら cleanup の stop() で停止する。
  useEffect(() => {
    if (isPermissionDenied) return;
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPermissionDenied]);

  const handleFinish = async () => {
    // FINISH を起点に iris-out → ローディング画面で覆い、対話準備完了で iris-in で抜ける。
    // origin は FINISH ボタン中心。取得できなければ画面下端中央にフォールバック。
    const rect = finishBtnRef.current?.getBoundingClientRect();
    const origin = rect
      ? {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
      : {x: window.innerWidth / 2, y: window.innerHeight - 80};
    startPostRunLoading(origin);

    let points = trackPoints;
    if (isRecording) {
      points = await stop();
    }
    if (points.length === 0) {
      // 記録が空のときは対話画面に進まないので loading を解除して戻す。
      resetPostRunLoading();
      navigate("/");
      return;
    }
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const [areaNameRaw, weatherRaw] = await Promise.all([
      fetchAreaName(centerLng, centerLat),
      fetchWeatherForCoords(centerLat, centerLng),
    ]);
    const areaName = areaNameRaw ?? undefined;
    const weather = weatherRaw ?? "sunny";
    const run: Run = {
      id: crypto.randomUUID(),
      name: `ラン ${new Date().toLocaleDateString("ja-JP")}`,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      trackPoints: points,
      notes: [],
      areaName,
      weather,
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
            <RecordingLayers
              trackPoints={trackPoints}
              acceptedTrackPoints={acceptedTrackPoints}
              fallbackPosition={initialCenter ?? null}
              radii={radii}
              showRawTube={showRawTube}
            />
            <AreaLabel />
            <NowPlayingLabel />
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
          <button ref={finishBtnRef} className="finish-btn" onClick={handleFinish}>
            <span>FINISH</span>
          </button>
        </div>
      </div>

      {isPermissionDenied && (
        <div className="chat-modal-backdrop" role="dialog" aria-modal="true">
          <div className="chat-modal recording-warning">
            <p className="recording-warning-title">位置情報の許可が必要です</p>
            <p className="chat-modal-text">
              ペタンプはランの軌跡を記録するために位置情報を使用します。
              現在ブラウザ側でブロックされているため、記録を開始できません。
            </p>
            <p className="chat-modal-text">
              アドレスバー左の鍵 / 情報アイコンから「位置情報」を「許可」に変更し、ページを再読み込みしてください。
            </p>
            <div className="chat-modal-actions">
              <button
                className="chat-modal-btn chat-modal-btn-primary"
                onClick={() => navigate("/")}
              >
                戻る
              </button>
            </div>
          </div>
        </div>
      )}

      {warningOpen && !isPermissionDenied && (
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
