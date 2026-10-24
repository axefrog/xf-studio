module XFRuntimeBridge

// R6, knowledge/navigation-and-safety.md §3: these are TRAFFIC lane flags, not navmesh masks.
// The owner/lock/streaming lifetime of the live lane array is not commissioned. Do not walk it,
// invent a pavement from a navmesh snap, or turn a negative boundary query into containment.
public abstract class XFNavigation {
  public static func Classify(point: Vector4, radius: Float) -> String {
    return "{\"status\":\"INCONCLUSIVE\",\"classification\":\"unknown\",\"point\":" + XFScene.Arr(point)
      + ",\"road\":null,\"pavement\":null,\"crosswalk\":null,\"lane_flags\":null,\"road_safety\":\"unknown\",\"traffic_risk\":\"unknown\""
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

  // Policy is independent of availability: unknown proceeds; only positive Road refuses.
  // A positive CrossWalk membership permits the placement, including overlapping Road.
  public static func Refuses(road: Bool, crosswalk: Bool, allowRoad: Bool) -> Bool {
    return road && !crosswalk && !allowRoad;
  }
  public static func Warning(opt crosswalk: Bool) -> String {
    if crosswalk { return "CrossWalk placement is allowed; crossing traffic can still reach this point."; }
    return "Traffic risk is unknown: lane containment and nearest pavement are uncommissioned. Inspect the destination for traffic.";
  }
  public static func Note(point: Vector4, subject: String) -> Void {
    XFBridge_Note("warn", subject + " placed at " + XFScene.Arr(point) + ": " + XFNavigation.Warning());
    // BEGIN XFB_AUTONOMOUS_TEST_HOOKS
    if XFBridge_RecordEnabled("contacts") {
      XFBridge_Record("contacts", "{\"event\":\"placement.traffic\",\"subject\":" + XFJson.Str(subject) + ",\"position\":" + XFScene.Arr(point) + ",\"traffic_risk\":\"unknown\",\"warning\":" + XFJson.Str(XFNavigation.Warning()) + "}");
    }
    // END XFB_AUTONOMOUS_TEST_HOOKS
  }
}
