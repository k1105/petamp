import ActivityKit
import SwiftUI
import WidgetKit

// 累計距離の表示フォーマット。1km 以上は km、未満は m。
func formatRunDistance(_ meters: Double) -> String {
    if meters >= 1000 {
        return String(format: "%.2f km", meters / 1000)
    }
    return String(format: "%.0f m", meters)
}

// "#RRGGBB" / "#RGB" を Color に変換。失敗時はフォールバック色。
func colorFromHex(_ hex: String, fallback: Color = Color(red: 0.1, green: 0.6, blue: 0.4)) -> Color {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 {
        s = s.map { "\($0)\($0)" }.joined()
    }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return fallback }
    let r = Double((v & 0xFF0000) >> 16) / 255.0
    let g = Double((v & 0x00FF00) >> 8) / 255.0
    let b = Double(v & 0x0000FF) / 255.0
    return Color(red: r, green: g, blue: b)
}

// 正規化済み軌跡 (0...255 量子化) を rect 内にレターボックスして描く Shape。
@available(iOS 16.2, *)
struct RunPathShape: Shape {
    let pathQuant: [UInt8]
    let aspect: Double  // 元 bbox の 幅/高さ

    func path(in rect: CGRect) -> Path {
        var p = Path()
        guard pathQuant.count >= 4 else { return p }

        // アスペクト比を保ったまま rect 内に収める。
        let targetAspect = aspect > 0 ? aspect : 1
        var drawW = rect.width
        var drawH = rect.height
        if rect.width / rect.height > targetAspect {
            drawW = rect.height * targetAspect
        } else {
            drawH = rect.width / targetAspect
        }
        let ox = rect.minX + (rect.width - drawW) / 2
        let oy = rect.minY + (rect.height - drawH) / 2

        func pt(_ i: Int) -> CGPoint {
            let x = CGFloat(pathQuant[i * 2]) / 255.0
            let y = CGFloat(pathQuant[i * 2 + 1]) / 255.0
            return CGPoint(x: ox + x * drawW, y: oy + y * drawH)
        }

        p.move(to: pt(0))
        for i in 1 ..< (pathQuant.count / 2) {
            p.addLine(to: pt(i))
        }
        return p
    }
}

// ロック画面に出るライブアクティビティ本体。
@available(iOS 16.2, *)
struct LockScreenView: View {
    let state: RunActivityAttributes.ContentState

    var body: some View {
        ZStack {
            colorFromHex(state.bgColor)

            RunPathShape(pathQuant: state.pathQuant, aspect: state.aspect)
                .stroke(
                    Color.white,
                    style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
                )
                .padding(16)

            VStack {
                HStack {
                    Text(formatRunDistance(state.distanceMeters))
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Spacer()
                }
                Spacer()
            }
            .padding(16)
        }
        .frame(height: 160)
        .activityBackgroundTint(colorFromHex(state.bgColor))
        .activitySystemActionForegroundColor(Color.white)
    }
}

@available(iOS 16.2, *)
struct RunLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RunActivityAttributes.self) { context in
            LockScreenView(state: context.state)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    Text(formatRunDistance(context.state.distanceMeters))
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                }
            } compactLeading: {
                Image(systemName: "figure.run")
                    .foregroundStyle(.white)
            } compactTrailing: {
                Text(formatRunDistance(context.state.distanceMeters))
                    .font(.caption2)
                    .bold()
                    .foregroundStyle(.white)
            } minimal: {
                Image(systemName: "figure.run")
                    .foregroundStyle(.white)
            }
        }
    }
}
