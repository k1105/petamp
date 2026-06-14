import CoreLocation
import Foundation
import UserNotifications

/// 「過去の自分/友人の軌跡に近づいたら通知」の中核。
///
/// 仕組み:
/// - JS (useTraceGeofences) が軌跡をクラスタリングした候補地点を setCandidates で渡す。
///   候補は UserDefaults に永続化し、アプリが kill されても使えるようにする。
/// - 候補のうち現在地に近い最大 18 件だけを CLCircularRegion として OS に登録する
///   (iOS のリージョン上限は 20/アプリ)。
/// - 大幅位置変更 (SLC) で監視リージョンを選び直す。SLC とリージョン進入は
///   アプリが起動していなくても OS がバックグラウンドで再起動して届けてくれるため、
///   常時 GPS は不要。
/// - リージョン進入でローカル通知を出す。同じ地点の連続通知はクールダウンで抑制。
///
/// AppDelegate.didFinishLaunching から start() を呼ぶこと。位置イベントによる
/// バックグラウンド再起動時に delegate を張り直さないとイベントを取りこぼす。
final class TraceGeofenceManager: NSObject, CLLocationManagerDelegate {
    static let shared = TraceGeofenceManager()

    struct Candidate: Codable {
        let id: String
        let lat: Double
        let lng: Double
        let title: String
        let body: String
    }

    private static let candidatesKey = "traceGeofence.candidates"
    private static let lastNotifiedKeyPrefix = "traceGeofence.lastNotified."
    /// 他プラグイン (background-geolocation 等) が登録するリージョンと区別する接頭辞
    private static let regionPrefix = "trace:"
    /// iOS のアプリあたり上限 20 のうち、他用途のために 2 枠残す
    private static let maxRegions = 18
    private static let regionRadius: CLLocationDistance = 150
    /// 同じ地点について再通知するまでの最短間隔
    private static let cooldown: TimeInterval = 12 * 60 * 60

    private let manager = CLLocationManager()
    private let defaults = UserDefaults.standard

    private override init() {
        super.init()
    }

    func start() {
        manager.delegate = self
        if hasAlwaysAuthorization {
            manager.startMonitoringSignificantLocationChanges()
        }
    }

    var hasAlwaysAuthorization: Bool {
        manager.authorizationStatus == .authorizedAlways
    }

    var authorizationStatus: CLAuthorizationStatus {
        manager.authorizationStatus
    }

    func requestAlwaysAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    /// 候補地点を差し替えて監視リージョンを選び直す。
    func setCandidates(_ candidates: [Candidate]) {
        if let data = try? JSONEncoder().encode(candidates) {
            defaults.set(data, forKey: Self.candidatesKey)
        }
        refreshRegions(around: manager.location)
    }

    private func loadCandidates() -> [Candidate] {
        guard let data = defaults.data(forKey: Self.candidatesKey),
              let candidates = try? JSONDecoder().decode([Candidate].self, from: data)
        else { return [] }
        return candidates
    }

    /// 現在地に近い候補から最大 maxRegions 件を OS のリージョン監視に登録し直す。
    private func refreshRegions(around location: CLLocation?) {
        guard hasAlwaysAuthorization,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        else { return }

        for region in manager.monitoredRegions where region.identifier.hasPrefix(Self.regionPrefix) {
            manager.stopMonitoring(for: region)
        }

        let candidates = loadCandidates()
        guard !candidates.isEmpty else { return }

        let selected: ArraySlice<Candidate>
        if let loc = location {
            selected = candidates
                .sorted {
                    distance(of: $0, from: loc) < distance(of: $1, from: loc)
                }
                .prefix(Self.maxRegions)
        } else {
            selected = candidates.prefix(Self.maxRegions)
        }

        let radius = min(Self.regionRadius, manager.maximumRegionMonitoringDistance)
        for candidate in selected {
            let region = CLCircularRegion(
                center: CLLocationCoordinate2D(latitude: candidate.lat, longitude: candidate.lng),
                radius: radius,
                identifier: Self.regionPrefix + candidate.id
            )
            region.notifyOnEntry = true
            region.notifyOnExit = false
            manager.startMonitoring(for: region)
        }
    }

    private func distance(of candidate: Candidate, from location: CLLocation) -> CLLocationDistance {
        CLLocation(latitude: candidate.lat, longitude: candidate.lng).distance(from: location)
    }

    // MARK: - CLLocationManagerDelegate

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard hasAlwaysAuthorization else { return }
        manager.startMonitoringSignificantLocationChanges()
        refreshRegions(around: manager.location)
    }

    /// SLC (約 500m 規模の移動) で発火。近傍の監視リージョンを選び直す。
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        refreshRegions(around: location)
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        guard region.identifier.hasPrefix(Self.regionPrefix) else { return }
        let id = String(region.identifier.dropFirst(Self.regionPrefix.count))

        let cooldownKey = Self.lastNotifiedKeyPrefix + id
        let now = Date().timeIntervalSince1970
        guard now - defaults.double(forKey: cooldownKey) > Self.cooldown else { return }
        guard let candidate = loadCandidates().first(where: { $0.id == id }) else { return }
        defaults.set(now, forKey: cooldownKey)

        let content = UNMutableNotificationContent()
        content.title = candidate.title
        content.body = candidate.body
        content.sound = .default
        content.userInfo = ["type": "trace-geofence", "id": id]
        let request = UNNotificationRequest(
            identifier: "trace-geofence-" + id,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }
}
