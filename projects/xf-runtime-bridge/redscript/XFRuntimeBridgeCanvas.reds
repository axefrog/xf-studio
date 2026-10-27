module XFRuntimeBridge

// Minimal camera/V payload per tick; entity reads are separately paced by the native owner.
// No nearby-NPC queries, rays or writes.
public class XFCanvas {
  public static func CameraRead() -> String {
    let player = XFPlayer.Player();
    if !IsDefined(player) || !player.IsAttached() { return "{\"ok\":true}"; }
    let camera = GameInstance.GetCameraSystem(GetGameInstance());
    let transform: Transform;
    if !IsDefined(camera) || !camera.GetActiveCameraWorldTransform(transform) { return "{\"ok\":true}"; }
    let out = "{\"ok\":true,\"position\":" + XFScene.Arr(transform.position);
    out += ",\"forward\":" + XFScene.Arr(camera.GetActiveCameraForward()) + ",\"right\":" + XFScene.Arr(camera.GetActiveCameraRight());
    out += ",\"up\":" + XFScene.Arr(camera.GetActiveCameraUp()) + ",\"fov\":" + XFJson.Num(camera.GetActiveCameraFOV());
    return out + ",\"player\":" + XFScene.Arr(player.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(player.GetWorldYaw()) + "}";
  }

  public static func AnchorsRead(ids: array<EntityID>) -> String {
    let out = "{\"ok\":true,\"positions\":[";
    let n = 0;
    while n < ArraySize(ids) && n < 32 {
      if n > 0 { out += ","; }
      let entity = GameInstance.FindEntityByID(GetGameInstance(), ids[n]);
      out += IsDefined(entity) ? XFScene.Arr(entity.GetWorldPosition()) : "null";
      n += 1;
    }
    return out + "]}";
  }
}
