import {useEffect, useRef} from "react";
import {useMap} from "../map/MapContext";
import {INITIAL_ZOOM, FIT_DURATION_MS} from "./recordingMapConstants";
import type {TrackPoint} from "../../types";

const FOLLOW_DURATION_MS = 400;

/** 記録中の follow モード: 最新の自己位置へ進行方向 (heading) 付きで追従する。 */
export function FollowUpdater({
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
