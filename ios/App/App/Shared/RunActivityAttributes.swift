import ActivityKit
import Foundation

// App ターゲットと PetampWidget 拡張ターゲットの両方でコンパイルされる共有定義。
// ライブアクティビティの状態をここで一元管理する。
@available(iOS 16.2, *)
struct RunActivityAttributes: ActivityAttributes {
    public typealias ContentState = RunContentState

    struct RunContentState: Codable, Hashable {
        /// 正規化済み軌跡。x,y を交互に並べた 0...255 の配列 (偶数=x, 奇数=y)。
        /// y は SwiftUI のスクリーン座標 (上=0) になるよう JS 側で反転済み。
        var pathQuant: [UInt8]
        /// 元 bbox のアスペクト比 (幅/高さ)。レターボックスして実際の形を保つ。
        var aspect: Double
        /// 今回ラン中の累計移動距離 (メートル)。JS 側 totalDistance で算出。
        var distanceMeters: Double
        /// 背景に使うテーマカラー ("#RRGGBB")。アプリの現在パレット bg を渡す。
        var bgColor: String
    }

    /// アクティビティのライフタイム中不変の識別子。
    var runId: String
}
