import {useMemo} from "react";
import {PathLayer, ScatterplotLayer} from "@deck.gl/layers";
import {useMapZoom} from "../map/MapContext";
import {DeckOverlay} from "../map/DeckOverlay";
import {useActivePalette} from "../../hooks/useActivePalette";
import {useBpmDotScale} from "../../hooks/useBpmDotScale";
import {hexToRgb} from "../../utils/ui/themePalettes";
import {effectiveRadius} from "../../utils/path/effectiveRadius";
import type {Radii} from "../../store/useSettingsStore";
import type {TrackPoint} from "../../types";

const MIN_ZOOM = 12.5;
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2;

/**
 * 記録中のライブ軌跡 + 自己位置 dot。デバッグ用に raw 軌跡 (フィルタ前) も
 * showRawTube で重ねられる。自己位置 dot は BPM に合わせて脈動する。
 */
export function RecordingLayers({
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
