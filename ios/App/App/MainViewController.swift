import Capacitor
import UIKit

// アプリローカルのカスタムプラグインを登録するためのブリッジ VC サブクラス。
// Capacitor 7 は packageClassList (npm プラグイン由来) からのみ自動登録するため、
// ローカルプラグインは capacitorDidLoad() で明示的に instance 登録する。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
