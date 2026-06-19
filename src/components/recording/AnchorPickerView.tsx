import {useEffect, useRef, useState} from "react";
import type {Map as MapboxMap} from "mapbox-gl";
import {Icon} from "@iconify/react";
import {BaseMap} from "../map/BaseMap";
import {useMap} from "../map/MapContext";
import {suggestPlaces, retrievePlace, type PlaceSuggestion} from "../../utils/geo/geocodeSearch";

/** BaseMap の子として map インスタンスを親へ引き上げる。 */
function MapGrabber({onMap}: {onMap: (map: MapboxMap | null) => void}) {
  const {map} = useMap();
  useEffect(() => {
    onMap(map);
  }, [map, onMap]);
  return null;
}

/**
 * 目標アンカーを設置する専用フルマップビュー。
 * - 建物まで含めて全レイヤー描画 (showAllLayers)
 * - 自由にパン/ズーム (interactive)
 * - 上部に地名検索窓
 * - 画面中央のレティクル位置 (= map.getCenter()) を決定で確定
 */
export function AnchorPickerView({
  initialCenter,
  onCancel,
  onConfirm,
  onClear,
  canClear = false,
}: {
  initialCenter: [number, number];
  onCancel: () => void;
  onConfirm: (lng: number, lat: number) => void;
  /** 設置済みアンカーの解除。canClear のときだけ「解除」ボタンを出す。 */
  onClear?: () => void;
  canClear?: boolean;
}) {
  const [map, setMap] = useState<MapboxMap | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const reqIdRef = useRef(0);
  // suggest 群 + retrieve を束ねるセッショントークン。retrieve 完了ごとに更新する。
  const sessionTokenRef = useRef(crypto.randomUUID());
  // 候補選択直後の setQuery による再検索を 1 回だけ抑止する。
  const justSelectedRef = useRef(false);

  // 入力に応じて候補を取得 (300ms デバウンス)。
  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    const q = query.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setSearching(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const proximity = map
        ? ([map.getCenter().lng, map.getCenter().lat] as [number, number])
        : initialCenter;
      const found = await suggestPlaces(q, sessionTokenRef.current, proximity);
      // 競合する後発リクエストが来ていたら破棄。
      if (reqId !== reqIdRef.current) return;
      setResults(found);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, map, initialCenter]);

  const selectResult = async (s: PlaceSuggestion) => {
    justSelectedRef.current = true;
    setQuery(s.name);
    setResults([]);
    setSearching(false);
    const place = await retrievePlace(s.mapboxId, sessionTokenRef.current);
    // 1 セッション完了。次の検索用に新しいトークンへ。
    sessionTokenRef.current = crypto.randomUUID();
    if (place) {
      map?.flyTo({center: [place.lng, place.lat], zoom: 17, duration: 800});
    }
  };

  const handleConfirm = () => {
    if (!map) return;
    const c = map.getCenter();
    onConfirm(c.lng, c.lat);
  };

  return (
    <div className="anchor-picker">
      <BaseMap
        initialCenter={initialCenter}
        initialZoom={16}
        initialPitch={0}
        interactive
        showAllLayers
        showJoystick={false}
      >
        <MapGrabber onMap={setMap} />
      </BaseMap>

      {/* 中央レティクル (確定される地点) */}
      <div className="anchor-picker-reticle">
        <Icon icon="lucide:map-pin" />
      </div>

      {/* 検索窓 */}
      <div className="anchor-picker-search">
        <form
          className="anchor-picker-search-row"
          onSubmit={e => e.preventDefault()}
        >
          <Icon icon="lucide:search" className="anchor-picker-search-icon" />
          <input
            className="anchor-picker-search-input"
            type="text"
            inputMode="search"
            placeholder="場所を検索"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button
              type="button"
              className="anchor-picker-search-clear"
              onClick={() => {
                setQuery("");
                setResults([]);
              }}
              aria-label="検索をクリア"
            >
              <Icon icon="lucide:x" />
            </button>
          )}
        </form>
        {(searching || results.length > 0) && (
          <ul className="anchor-picker-results">
            {searching && results.length === 0 && (
              <li className="anchor-picker-result is-loading">検索中…</li>
            )}
            {results.map((r, i) => (
              <li key={`${r.mapboxId},${i}`}>
                <button
                  type="button"
                  className="anchor-picker-result"
                  onClick={() => void selectResult(r)}
                >
                  <span className="anchor-picker-result-name">{r.name}</span>
                  {r.placeFormatted && (
                    <span className="anchor-picker-result-sub">{r.placeFormatted}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 現在地に戻る */}
      <button
        className="anchor-picker-locate"
        onClick={() => map?.flyTo({center: initialCenter, duration: 600})}
        title="現在地に戻る"
        aria-label="現在地に戻る"
      >
        <Icon icon="lucide:locate-fixed" />
      </button>

      {/* キャンセル / 解除 / 決定 */}
      <div className="anchor-picker-actions">
        <button className="anchor-picker-btn anchor-picker-cancel" onClick={onCancel}>
          キャンセル
        </button>
        {canClear && onClear && (
          <button className="anchor-picker-btn anchor-picker-clear" onClick={onClear}>
            解除
          </button>
        )}
        <button
          className="anchor-picker-btn anchor-picker-confirm"
          onClick={handleConfirm}
          disabled={!map}
        >
          決定
        </button>
      </div>
    </div>
  );
}
