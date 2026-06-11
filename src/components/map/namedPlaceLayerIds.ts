// NamedPlace 関連の mapbox source / layer ID。
// GalleryLayers が「地名タップを優先してラン遷移を抑止する」判定にも使うため共有する。
export const NP_SOURCE = 'named-places'
export const NP_LAYER_LINE = 'named-place-line'
export const NP_LAYER_POINT = 'named-place-point'
export const NP_LAYER_LINE_LABEL = 'named-place-line-label'
export const NP_LAYER_POINT_LABEL = 'named-place-point-label'
export const NP_ALL_LAYERS = [NP_LAYER_LINE, NP_LAYER_POINT, NP_LAYER_LINE_LABEL, NP_LAYER_POINT_LABEL]
