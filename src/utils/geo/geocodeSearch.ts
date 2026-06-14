// Mapbox Search Box API による場所検索 (駅・施設などの POI も検索できる)。
// Geocoding API は POI 精度が弱いため、対話検索には Search Box を使う。
//
// フロー: suggest (候補一覧) → retrieve (選択した候補の座標取得)。
// session_token で suggest 群 + 1 retrieve を 1 セッションとして束ねる (課金単位)。
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export interface PlaceSuggestion {
  /** 主名称 (例: "名古屋駅")。 */
  name: string
  /** 文脈付き住所 (例: "名古屋市中村区, 愛知県")。 */
  placeFormatted?: string
  /** retrieve に渡す ID。 */
  mapboxId: string
}

/**
 * 検索候補を取得する (座標は含まれない。確定時に retrievePlace を呼ぶ)。
 * @param query 検索文字列。
 * @param sessionToken セッショントークン (UUIDv4)。
 * @param proximity 結果をバイアスする中心 [lng, lat] (任意)。
 */
export async function suggestPlaces(
  query: string,
  sessionToken: string,
  proximity?: [number, number],
): Promise<PlaceSuggestion[]> {
  if (!TOKEN) return []
  const q = query.trim()
  if (!q) return []
  try {
    const params = new URLSearchParams({
      q,
      access_token: TOKEN,
      session_token: sessionToken,
      language: 'ja',
      limit: '6',
    })
    if (proximity) params.set('proximity', `${proximity[0]},${proximity[1]}`)
    const url = `https://api.mapbox.com/search/searchbox/v1/suggest?${params.toString()}`
    const res = await fetch(url)
    const data = await res.json()
    const suggestions: unknown[] = Array.isArray(data?.suggestions) ? data.suggestions : []
    return suggestions.flatMap((s): PlaceSuggestion[] => {
      const sug = s as { name?: string; place_formatted?: string; mapbox_id?: string }
      if (!sug.mapbox_id || !sug.name) return []
      return [{ name: sug.name, placeFormatted: sug.place_formatted, mapboxId: sug.mapbox_id }]
    })
  } catch {
    return []
  }
}

/**
 * 候補 (mapboxId) の座標を取得する。
 * @param sessionToken suggest と同じセッショントークン。
 */
export async function retrievePlace(
  mapboxId: string,
  sessionToken: string,
): Promise<{ lng: number; lat: number } | null> {
  if (!TOKEN) return null
  try {
    const params = new URLSearchParams({
      access_token: TOKEN,
      session_token: sessionToken,
    })
    const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?${params.toString()}`
    const res = await fetch(url)
    const data = await res.json()
    const feature = Array.isArray(data?.features) ? data.features[0] : null
    const coords = feature?.geometry?.coordinates
    if (!Array.isArray(coords) || coords.length < 2) return null
    return { lng: coords[0], lat: coords[1] }
  } catch {
    return null
  }
}
