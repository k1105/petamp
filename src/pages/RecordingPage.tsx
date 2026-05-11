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
import {useRunStore} from "../store/useRunStore";
import {useSettingsStore, type Radii} from "../store/useSettingsStore";
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

const FIT_INTERVAL = 20;
const INITIAL_ZOOM = 17;
const FIT_MAX_ZOOM = 18;

function BoundsFitter({trackPoints}: {trackPoints: TrackPoint[]}) {
  const {map} = useMap();
  const lastFitLengthRef = useRef(0);

  useEffect(() => {
    if (!map) return;
    const len = trackPoints.length;
    if (len === 0) return;

    const isFirst = lastFitLengthRef.current === 0;
    const isPeriodic = len - lastFitLengthRef.current >= FIT_INTERVAL;
    if (!isFirst && !isPeriodic) return;

    if (len === 1) {
      map.easeTo({
        center: [trackPoints[0].lng, trackPoints[0].lat],
        zoom: INITIAL_ZOOM,
        duration: 500,
      });
    } else {
      const lngs = trackPoints.map((p) => p.lng);
      const lats = trackPoints.map((p) => p.lat);
      const bounds: [[number, number], [number, number]] = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(bounds, {padding: 60, duration: 500, maxZoom: FIT_MAX_ZOOM});
    }
    lastFitLengthRef.current = len;
  }, [map, trackPoints]);

  return null;
}

function RecordingLayers({
  trackPoints,
  acceptedTrackPoints,
  fallbackPosition,
  radii,
}: {
  trackPoints: TrackPoint[];
  acceptedTrackPoints: TrackPoint[];
  fallbackPosition: [number, number] | null;
  radii: Radii;
}) {
  const zoom = useMapZoom();
  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5));

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
    160,
    160,
    160,
    Math.round(255 * t),
  ];
  const rawTubeColor: [number, number, number, number] = [
    230,
    60,
    60,
    Math.round(255 * t),
  ];
  const dotColor: [number, number, number, number] = [
    28,
    151,
    94,
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
    return [
      new SimpleMeshLayer({
        id: "raw-tube",
        data: rawTubeData,
        mesh: cylinder,
        getPosition: (d) => d.position,
        getScale: (d) => [rawTubeRadius, d.length, rawTubeRadius],
        getOrientation: (d) => d.orientation,
        getColor: rawTubeColor,
        material: mat,
        updateTriggers: {getScale: rawTubeRadius},
      }),
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
  }, [tubeData, jointData, rawTubeData, dotData, t, tubeRadius, rawTubeRadius, dotRadius, jointRadius]);

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
          <BaseMap initialCenter={initialCenter ?? undefined} initialZoom={INITIAL_ZOOM}>
            <BoundsFitter trackPoints={acceptedTrackPoints} />
            <RecordingLayers
              trackPoints={trackPoints}
              acceptedTrackPoints={acceptedTrackPoints}
              fallbackPosition={initialCenter ?? null}
              radii={radii}
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
          onClose={() => setRecordingDebugOpen(false)}
        />
      )}
    </div>
  );
}
