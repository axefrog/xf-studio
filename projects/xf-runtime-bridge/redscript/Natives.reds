// Native globals implemented by XFRuntimeBridge.dll (RED4ext plugin, src/plugin/Natives.cpp).
//
// This file deliberately has no `module` line: redscript prefixes module names onto globals,
// and the plugin registers these under their plain names (as Codeware does for Print/ModLog).
// The whole Scripts folder is added to compilation by the plugin itself
// (sdk->scripts->Add), so these declarations never exist without the DLL that backs them.

public static native func XFBridge_Ping(layer: String, cid: String) -> String
public static native func XFBridge_Info() -> String
public static native func XFBridge_Log(layer: String, level: String, cid: String, message: String) -> Void
public static native func XFBridge_Announce(layer: String, detail: String) -> Void
public static native func XFBridge_Kill(reason: String) -> Bool
