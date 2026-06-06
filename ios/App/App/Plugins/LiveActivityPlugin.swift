import ActivityKit
import Capacitor
import Foundation

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin {

    // 直近に開始したラン ID。update/end で runId 未指定時のフォールバックに使う。
    private var currentRunId: String?

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("LIVE_ACTIVITY_UNSUPPORTED")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("LIVE_ACTIVITY_DISABLED")
            return
        }
        let runId = call.getString("runId") ?? UUID().uuidString
        let state = parseState(call)
        let attributes = RunActivityAttributes(runId: runId)
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil),
                pushType: nil  // ローカル更新のみ。APNs は使わない。
            )
            currentRunId = runId
            call.resolve(["runId": runId, "activityId": activity.id])
        } catch {
            call.reject("LIVE_ACTIVITY_START_FAILED: \(error.localizedDescription)")
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.reject("LIVE_ACTIVITY_UNSUPPORTED")
            return
        }
        let runId = call.getString("runId") ?? currentRunId
        let state = parseState(call)
        Task {
            for activity in Activity<RunActivityAttributes>.activities
            where runId == nil || activity.attributes.runId == runId {
                await activity.update(.init(state: state, staleDate: nil))
            }
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        let runId = call.getString("runId") ?? currentRunId
        Task {
            for activity in Activity<RunActivityAttributes>.activities
            where runId == nil || activity.attributes.runId == runId {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            currentRunId = nil
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private func parseState(_ call: CAPPluginCall) -> RunActivityAttributes.ContentState {
        let raw = call.getArray("pathQuant", Int.self) ?? []
        let quant = raw.map { UInt8(max(0, min(255, $0))) }
        let aspect = call.getDouble("aspect") ?? 1.0
        let dist = call.getDouble("distanceMeters") ?? 0
        let bgColor = call.getString("bgColor") ?? "#1C975E"
        return .init(pathQuant: quant, aspect: aspect, distanceMeters: dist, bgColor: bgColor)
    }
}
