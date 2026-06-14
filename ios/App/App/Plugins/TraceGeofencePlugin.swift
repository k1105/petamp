import Capacitor
import CoreLocation
import Foundation

/// JS 側 registerPlugin('TraceGeofence') と対応する薄いラッパー。
/// 実体は TraceGeofenceManager (AppDelegate から起動されるシングルトン)。
@objc(TraceGeofencePlugin)
public class TraceGeofencePlugin: CAPPlugin {

    /// 候補地点を差し替える。candidates: [{ id, lat, lng, title, body }]
    /// 権限が無くても永続化だけは行い、許可された時点で監視が始まる。
    @objc func setCandidates(_ call: CAPPluginCall) {
        guard let array = call.getArray("candidates") as? [[String: Any]] else {
            call.reject("candidates is required")
            return
        }
        let candidates: [TraceGeofenceManager.Candidate] = array.compactMap { item in
            guard let id = item["id"] as? String,
                  let lat = item["lat"] as? Double,
                  let lng = item["lng"] as? Double,
                  let title = item["title"] as? String,
                  let body = item["body"] as? String
            else { return nil }
            return TraceGeofenceManager.Candidate(id: id, lat: lat, lng: lng, title: title, body: body)
        }
        TraceGeofenceManager.shared.setCandidates(candidates)
        call.resolve(["count": candidates.count])
    }

    /// 位置情報「常に許可」を要求する。結果はダイアログ操作後に
    /// locationManagerDidChangeAuthorization 経由で反映されるため、ここでは即 resolve。
    @objc func requestAlwaysPermission(_ call: CAPPluginCall) {
        TraceGeofenceManager.shared.requestAlwaysAuthorization()
        call.resolve()
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        let status: String
        switch TraceGeofenceManager.shared.authorizationStatus {
        case .authorizedAlways: status = "always"
        case .authorizedWhenInUse: status = "whenInUse"
        case .denied, .restricted: status = "denied"
        case .notDetermined: status = "prompt"
        @unknown default: status = "prompt"
        }
        call.resolve(["location": status])
    }
}
