#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// JS 側の registerPlugin('TraceGeofence') と対応。
// Capacitor は CAP_PLUGIN マクロを ObjC ランタイム経由で起動時に発見する。
CAP_PLUGIN(TraceGeofencePlugin, "TraceGeofence",
    CAP_PLUGIN_METHOD(setCandidates, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestAlwaysPermission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(checkPermissions, CAPPluginReturnPromise);
)
