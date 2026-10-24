module XFRuntimeBridge

// R6, knowledge/navigation-and-safety.md §3: these are TRAFFIC lane flags, not navmesh masks.
// The owner/lock/streaming lifetime of the live lane array is not commissioned. Do not walk it,
// invent a pavement from a navmesh snap, or turn a negative boundary query into containment.
public abstract class XFNavigation {
  public static func Classify(point: Vector4, radius: Float) -> String {
    return "{\"status\":\"INCONCLUSIVE\",\"classification\":\"unknown\",\"point\":" + XFScene.Arr(point)
      + ",\"road\":null,\"pavement\":null,\"crosswalk\":null,\"lane_flags\":null,\"road_safety\":\"unknown\""
      + ",\"nearest_pavement\":null,\"radius_m\":" + XFJson.Num(radius)
      + ",\"reason\":\"live_lane_containment_uncommissioned\",\"nearest_pavement_status\":\"INCONCLUSIVE\"}";
  }

  // Only a real two-point path; duplicate points are not a containment test (R6 §3).
  public static func Boundary(from: Vector4, to: Vector4) -> String {
    let traffic = GameInstance.GetTrafficSystem(GetGameInstance());
    if !IsDefined(traffic) || Vector4.Distance(from, to) < 0.001 {
      return "{\"status\":\"INCONCLUSIVE\",\"reason\":\"no_nonzero_path_or_traffic_system\"}";
    }
    let path: array<Vector4>;
    ArrayPush(path, from); ArrayPush(path, to);
    let intersection: Vector4;
    let hit = traffic.IsPathIntersectingWithTraffic(path, 0.0, intersection);
    return "{\"status\":\"uncommissioned\",\"intersects\":" + XFJson.Flag(hit)
      + ",\"from\":" + XFScene.Arr(from) + ",\"to\":" + XFScene.Arr(to) + ",\"distance_from_traffic\":0.0,\"intersection\":" + (hit ? XFScene.Arr(intersection) : "null")
      + ",\"filter\":\"Road; excludes TrafficDisabled and GPSOnly\",\"containment\":\"INCONCLUSIVE\"}";
  }

  public static func Refuse(point: Vector4) -> String {
    return XFJson.Fail("road_safety_unknown", "Placement refused: road/pavement/crosswalk containment and nearest pavement are INCONCLUSIVE. allow_road: true explicitly accepts this unknown traffic risk. " + XFNavigation.Classify(point, 10.0));
  }
}
