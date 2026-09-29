// XF Runtime Bridge: photo mode's camera presets rewritten while the game runs (bridge 0.6, research: photo.camera.preset).
//
// Session 6 found that photo mode puts its camera back when its entity is moved (photo.camera.place held false), so this is
// the second route (knowledge/photo-mode.md §4): photo mode's camera presets are TweakDB records
// (photo_mode.std_preset_1..9: dist, pitchDeg, yawDeg, rollDeg, distUpDown, distLeftRight, fov), and TweakXL's script API
// rewrites flats in the running game (TweakDBManager.SetFlat, then UpdateRecord) [source] TweakXL v1.11.4
// scripts/TweakDBManager.reds. Selecting the preset (attribute 23) should then place the camera relative to V by photo
// mode's own code. Whether photo mode reads the record when the preset is selected (or cached it when it opened) is the
// question the first run answers: the plugin reads the camera back after selecting. Nothing is saved (TweakDB changes live
// in memory until the game restarts); the undo writes the earlier values back. TweakXL is detected, never required.

module XFRuntimeBridge

@if(ModuleExists("TweakXL"))
public abstract class XFPresetRewrite {
  public static func Names() -> array<String> {
    let names: array<String>;
    ArrayPush(names, "dist");
    ArrayPush(names, "pitchDeg");
    ArrayPush(names, "yawDeg");
    ArrayPush(names, "rollDeg");
    ArrayPush(names, "distUpDown");
    ArrayPush(names, "distLeftRight");
    ArrayPush(names, "fov");
    return names;
  }

  public static func Record(preset: Int32) -> String {
    return "photo_mode.std_preset_" + IntToString(preset);
  }

  // The preset's seven flats as they are now.
  public static func Read(cid: String, preset: Int32) -> String {
    if preset < 1 || preset > 9 {
      return XFJson.Fail("bad_params", "photo mode's camera presets are 1-9");
    }
    let out = "{\"ok\":true,\"preset\":" + IntToString(preset) + ",\"record\":" + XFJson.Str(XFPresetRewrite.Record(preset)) + ",\"flats\":{";
    let names = XFPresetRewrite.Names();
    let i = 0;
    while i < ArraySize(names) {
      if i > 0 {
        out += ",";
      }
      out += XFJson.Str(names[i]) + ":" + XFJson.Num(TweakDBInterface.GetFloat(TDBID.Create(XFPresetRewrite.Record(preset) + "." + names[i]), 0.0));
      i += 1;
    }
    return out + "}}";
  }

  // One flat (the plugin checks the name and the value's range first).
  public static func Write(cid: String, preset: Int32, name: String, value: Float) -> String {
    let names = XFPresetRewrite.Names();
    if !ArrayContains(names, name) || preset < 1 || preset > 9 {
      return XFJson.Fail("bad_params", "unknown camera preset value '" + name + "'");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    if !TweakDBManager.SetFlat(TDBID.Create(XFPresetRewrite.Record(preset) + "." + name), ToVariant(value)) {
      return XFJson.Fail("failed", "TweakXL refused to set " + XFPresetRewrite.Record(preset) + "." + name);
    }
    return "{\"ok\":true}";
  }

  // The record rebuilt from its flats, so a lookup of the record sees the new values.
  public static func Commit(cid: String, preset: Int32) -> String {
    let updated = TweakDBManager.UpdateRecord(TDBID.Create(XFPresetRewrite.Record(preset)));
    XFBridgeLog.Info(cid, "camera preset " + IntToString(preset) + " rewritten (UpdateRecord " + (updated ? "ok" : "refused") + "); undo: write the earlier values back");
    return "{\"ok\":true,\"record_updated\":" + XFJson.Flag(updated) + ",\"tweakxl\":" + XFJson.Str(TweakXL.Version()) + "}";
  }
}

@if(!ModuleExists("TweakXL"))
public abstract class XFPresetRewrite {
  public static func Read(cid: String, preset: Int32) -> String {
    return XFJson.Fail("tweakxl_missing", "rewriting a camera preset needs TweakXL, which the game hasn't loaded");
  }

  public static func Write(cid: String, preset: Int32, name: String, value: Float) -> String {
    return XFJson.Fail("tweakxl_missing", "rewriting a camera preset needs TweakXL, which the game hasn't loaded");
  }

  public static func Commit(cid: String, preset: Int32) -> String {
    return XFJson.Fail("tweakxl_missing", "rewriting a camera preset needs TweakXL, which the game hasn't loaded");
  }
}
