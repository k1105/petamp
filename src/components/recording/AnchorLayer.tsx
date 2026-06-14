import {useMemo} from "react";
import {ScatterplotLayer} from "@deck.gl/layers";
import {DeckOverlay} from "../map/DeckOverlay";
import {ANCHOR_ARRIVAL_RADIUS_M} from "../../utils/anchor/anchorAudio";

/**
 * 目標アンカーを地図に描く。
 * - 到達半径 (ANCHOR_ARRIVAL_RADIUS_M) のリング (meters 単位なので地理的に正しい大きさ)
 * - 中心の塗り dot
 * 到達 (arrived) すると緑に変わる。
 */
export function AnchorLayer({
  anchor,
  arrived,
}: {
  anchor: {lng: number; lat: number} | null;
  arrived: boolean;
}) {
  const layers = useMemo(() => {
    if (!anchor) return [];
    const color: [number, number, number] = arrived ? [80, 220, 120] : [255, 90, 90];
    const data = [{position: [anchor.lng, anchor.lat] as [number, number]}];
    const ring = new ScatterplotLayer({
      id: "anchor-ring",
      data,
      getPosition: d => [d.position[0], d.position[1], 0],
      getRadius: ANCHOR_ARRIVAL_RADIUS_M,
      radiusUnits: "meters",
      filled: false,
      stroked: true,
      getLineColor: [...color, 200],
      lineWidthUnits: "meters",
      getLineWidth: 2,
      billboard: true,
      updateTriggers: {getLineColor: color},
    });
    const dot = new ScatterplotLayer({
      id: "anchor-dot",
      data,
      getPosition: d => [d.position[0], d.position[1], 0],
      getRadius: 6,
      radiusUnits: "meters",
      getFillColor: [...color, 255],
      billboard: true,
      updateTriggers: {getFillColor: color},
    });
    return [ring, dot];
  }, [anchor, arrived]);

  return <DeckOverlay layers={layers} />;
}
