import {useMemo} from "react";
import {PathLayer, ScatterplotLayer, SolidPolygonLayer} from "@deck.gl/layers";
import {useMapZoom} from "../map/MapContext";
import {DeckOverlay} from "../map/DeckOverlay";
import {useActivePalette} from "../../hooks/useActivePalette";
import {useBpmDotScale} from "../../hooks/useBpmDotScale";
import {useDeviceHeading} from "../../hooks/useDeviceHeading";
import {hexToRgb} from "../../utils/ui/themePalettes";
import {buildHeadingCone} from "../../utils/geo/headingCone";
import {effectiveRadius} from "../../utils/path/effectiveRadius";
import type {Radii} from "../../store/useSettingsStore";
import type {TrackPoint} from "../../types";

const MIN_ZOOM = 12.5;
// 現在位置(=自己位置)dotは過去ランの軌跡dotより少し大きく強調する。
const CURRENT_DOT_SCALE = 1.2;
// heading レーダー扇形の長さ。自己位置 dot 半径の何倍まで伸ばすか。
const CONE_LENGTH_DOT_SCALE = 8;

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
  // 端末コンパス (device orientation) が第一候補。WKWebView で取れない/未許可の
  // 間は GPS の進行方位 (TrackPoint.heading = ネイティブ bearing) にフォールバック
  // して、移動中は確実に向きを出す。bearing は停止中 -1 になるので >=0 のみ採用。
  const deviceHeading = useDeviceHeading();
  const gpsHeading = useMemo<number | null>(() => {
    for (let i = trackPoints.length - 1; i >= 0; i--) {
      const h = trackPoints[i].heading;
      if (h != null && h >= 0) return h;
    }
    return null;
  }, [trackPoints]);
  const heading = deviceHeading ?? gpsHeading;

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

  // heading レーダー扇形。端末の向きが取れていて、かつ現在地が分かるときだけ出す。
  // dot 半径基準で長さを決めるので寄り引きで自然に追従する。色は accent で
  // 中心→外側のグラデーション、最後に zoom フェード(t)を掛ける。
  const coneData = useMemo(() => {
    const pos = dotData[0]?.position;
    if (heading == null || !pos) return [] as {polygon: [number, number][]; color: [number, number, number, number]}[];
    const lengthM = dotRadius * CONE_LENGTH_DOT_SCALE;
    return buildHeadingCone(pos, heading, lengthM).map(band => ({
      polygon: band.polygon,
      color: [...accentRgb, Math.round(255 * band.alpha * t)] as [number, number, number, number],
    }));
  }, [heading, dotData, dotRadius, accentRgb, t]);

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
    const coneLayer = coneData.length
      ? new SolidPolygonLayer({
          id: "heading-cone",
          data: coneData,
          getPolygon: (d: {polygon: [number, number][]}) => d.polygon,
          getFillColor: (d: {color: [number, number, number, number]}) => d.color,
          filled: true,
          stroked: false,
          extruded: false,
          updateTriggers: {getFillColor: coneData},
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
      ...(coneLayer ? [coneLayer] : []),
      dotLayer,
    ];
  }, [acceptedPath, rawPath, dotData, coneData, t, tubeWidth, rawTubeWidth, dotRadius, tubeColor, rawTubeColor, dotColor, showRawTube, bpmDotScale]);

  return <DeckOverlay layers={layers} />;
}
