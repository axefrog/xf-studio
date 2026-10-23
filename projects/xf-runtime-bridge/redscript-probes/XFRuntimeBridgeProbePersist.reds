// XF Runtime Bridge 0.8.7, a TEST PROBE (the -writes package only; [bridge] allow_test_hooks): save-identity rows 11 and 12.
// A ScriptableSystem with persistent fields: a value and an array of a chosen size, set by test.save.identity {persist}, so a
// session can see what a save keeps of them and what happens when this file is removed from the staged mod and a save that
// holds them is loaded (row 11). This file stands alone: nothing else refers to it, so removing it leaves every other script
// compiling; the plugin reaches it by name (XFProbePersistAccess) and answers "not present" when it isn't.

module XFRuntimeBridge

public class XFProbePersist extends ScriptableSystem {
  private persistent let m_value: Int32;
  private persistent let m_blob: array<Int32>;

  public func Set(value: Int32, kib: Int32) -> Void {
    this.m_value = value;
    ArrayClear(this.m_blob);
    let count = kib * 256; // 256 four-byte values a KiB
    let i = 0;
    while i < count {
      ArrayPush(this.m_blob, i);
      i += 1;
    }
  }

  public func Describe() -> String {
    return "{\"ok\":true,\"present\":true,\"value\":" + IntToString(this.m_value) + ",\"blob_kib\":" + IntToString(ArraySize(this.m_blob) / 256) + "}";
  }
}

public abstract class XFProbePersistAccess {
  // The plugin's test.save.identity {persist} (game thread; cid first). set false: only reads. kib 0 to 4096.
  public static func Run(cid: String, set: Bool, value: Int32, kib: Int32) -> String {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    let system = IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFProbePersist") as XFProbePersist : null;
    if !IsDefined(system) {
      return "{\"ok\":true,\"present\":false,\"why\":\"the probe's persistent system isn't running\"}";
    }
    if set {
      system.Set(value, Max(0, Min(kib, 4096)));
    }
    return system.Describe();
  }
}
