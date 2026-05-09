import {useEffect, useMemo, useRef, useState} from "react";
import {useNavigate} from "react-router-dom";
import {SimpleMeshLayer} from "@deck.gl/mesh-layers";
import {SphereGeometry, CylinderGeometry} from "@luma.gl/engine";
import {Icon} from "@iconify/react";
import {BaseMap, useMap, useMapZoom} from "../components/map/BaseMap";
import {DeckOverlay} from "../components/map/DeckOverlay";
import {LiveStats} from "../components/recording/LiveStats";
import {PathDebugPanel} from "../components/recording/PathDebugPanel";
import {useGpsRecorder} from "../hooks/useGpsRecorder";
import {useCurrentPosition} from "../hooks/useCurrentPosition";
import {useRunStore} from "../store/useRunStore";
import {buildTubeSegments, buildTubeJoints} from "../utils/tubeData";
import {acceptedPoints} from "../utils/recordingFilters";
import {RecordingDebugPanel, type RadiusSettings} from "../components/recording/RecordingDebugPanel";
import type {Run, TrackPoint} from "../types";

const sphere = new SphereGeometry({radius: 1, nlat: 20, nlong: 20});
const cylinder = new CylinderGeometry({radius: 1, height: 1, nradial: 12});
const DEFAULT_RADII: RadiusSettings = {
  tubeRadius: 1.3,
  rawTubeRadius: 1.2,
  dotRadius: 9.5,
};
const RADII_STORAGE_KEY = "petamp.recording.radii";
const MIN_ZOOM = 12.5;

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
  radii: RadiusSettings;
}) {
  const zoom = useMapZoom();
  const t = Math.max(0, Math.min(1, (zoom - (MIN_ZOOM - 0.5)) / 0.5));

  const tubeData = useMemo(
    () => buildTubeSegments(acceptedTrackPoints, radii.tubeRadius),
    [acceptedTrackPoints, radii.tubeRadius],
  );
  const jointData = useMemo(
    () => buildTubeJoints(acceptedTrackPoints, radii.tubeRadius),
    [acceptedTrackPoints, radii.tubeRadius],
  );
  const rawTubeData = useMemo(
    () => buildTubeSegments(trackPoints, radii.rawTubeRadius),
    [trackPoints, radii.rawTubeRadius],
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
        getScale: (d) => d.scale,
        getOrientation: (d) => d.orientation,
        getColor: rawTubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: "live-tube",
        data: tubeData,
        mesh: cylinder,
        getPosition: (d) => d.position,
        getScale: (d) => d.scale,
        getOrientation: (d) => d.orientation,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: "live-joints",
        data: jointData,
        mesh: sphere,
        getPosition: (d) => d.position,
        getScale: (d) => d.scale,
        getColor: tubeColor,
        material: mat,
      }),
      new SimpleMeshLayer({
        id: "live-dot",
        data: dotData,
        mesh: sphere,
        getPosition: (d: {position: [number, number]}) =>
          [d.position[0], d.position[1], 0] as [number, number, number],
        getScale: [radii.dotRadius, radii.dotRadius, radii.dotRadius],
        getColor: dotColor,
        material: mat,
      }),
    ];
  }, [tubeData, jointData, rawTubeData, dotData, t, radii.dotRadius]);

  return <DeckOverlay layers={layers} />;
}

function loadStoredRadii(): RadiusSettings {
  try {
    const raw = localStorage.getItem(RADII_STORAGE_KEY);
    if (!raw) return DEFAULT_RADII;
    const parsed = JSON.parse(raw);
    return {
      tubeRadius: typeof parsed.tubeRadius === "number" ? parsed.tubeRadius : DEFAULT_RADII.tubeRadius,
      rawTubeRadius: typeof parsed.rawTubeRadius === "number" ? parsed.rawTubeRadius : DEFAULT_RADII.rawTubeRadius,
      dotRadius: typeof parsed.dotRadius === "number" ? parsed.dotRadius : DEFAULT_RADII.dotRadius,
    };
  } catch {
    return DEFAULT_RADII;
  }
}

export function RecordingPage() {
  const navigate = useNavigate();
  const {isRecording, trackPoints, error, start, stop} = useGpsRecorder();
  const {addRun} = useRunStore();
  const [debugPoints, setDebugPoints] = useState<TrackPoint[] | null>(null);
  const [recordingDebugOpen, setRecordingDebugOpen] = useState(false);
  const [radii, setRadii] = useState<RadiusSettings>(() => loadStoredRadii());
  const initialCenter = useCurrentPosition();
  const acceptedTrackPoints = useMemo(() => acceptedPoints(trackPoints), [trackPoints]);

  useEffect(() => {
    try {
      localStorage.setItem(RADII_STORAGE_KEY, JSON.stringify(radii));
    } catch {
      // ignore storage errors
    }
  }, [radii]);

  useEffect(() => {
    start();
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFinish = () => {
    let points = trackPoints;
    if (isRecording) {
      points = stop();
    }
    setDebugPoints(points);
  };

  const handleProceed = async () => {
    const points = debugPoints;
    if (!points || points.length === 0) {
      navigate("/");
      return;
    }
    const run: Run = {
      id: crypto.randomUUID(),
      name: `ラン ${new Date().toLocaleDateString("ja-JP")}`,
      startedAt: points[0].timestamp,
      finishedAt: points.at(-1)!.timestamp,
      trackPoints: points,
      notes: [],
    };
    await addRun(run);
    navigate(`/run/${run.id}`);
  };

  const handleCancelDebug = () => {
    setDebugPoints(null);
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

      {debugPoints !== null && (
        <PathDebugPanel
          trackPoints={debugPoints}
          onProceed={handleProceed}
          onCancel={handleCancelDebug}
        />
      )}

      {recordingDebugOpen && (
        <RecordingDebugPanel
          trackPoints={trackPoints}
          radii={radii}
          onChangeRadii={setRadii}
          onResetRadii={() => setRadii(DEFAULT_RADII)}
          onClose={() => setRecordingDebugOpen(false)}
        />
      )}
    </div>
  );
}
