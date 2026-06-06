#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// JS 側の registerPlugin('LiveActivity') と対応。
// Capacitor は CAP_PLUGIN マクロを ObjC ランタイム経由で起動時に発見する。
CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(end, CAPPluginReturnPromise);
)
