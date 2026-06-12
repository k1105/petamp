import {useEffect, useRef} from "react";
import {useMap} from "../map/MapContext";
import {INITIAL_ZOOM, FIT_DURATION_MS} from "./recordingMapConstants";
import type {TrackPoint} from "../../types";

// 序盤はbboxが大きく変化するので密に、安定する後半は粗く再フィットする。
const FIT_INTERVAL_EARLY = 3;
const FIT_INTERVAL_LATE = 20;
const EARLY_PHASE_THRESHOLD = 100;
const FIT_MAX_ZOOM = 18;

interface RunningBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

/** 記録中の overview モード: 軌跡全体の bbox に周期的に再フィットする。 */
export function BoundsFitter({
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
