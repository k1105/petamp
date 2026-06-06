import SwiftUI
import WidgetKit

@main
struct PetampWidgetBundle: WidgetBundle {
    var body: some Widget {
        // ライブアクティビティは iOS 16.2+ のみ。古い OS では空の bundle になる。
        if #available(iOS 16.2, *) {
            RunLiveActivity()
        }
    }
}
