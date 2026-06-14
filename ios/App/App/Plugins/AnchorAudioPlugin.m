#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// JS 側の registerPlugin('AnchorAudio') と対応。
// Capacitor は CAP_PLUGIN マクロを ObjC ランタイム経由で起動時に発見する。
CAP_PLUGIN(AnchorAudioPlugin, "AnchorAudio",
    CAP_PLUGIN_METHOD(resume, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setBpm, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(playMelody, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
