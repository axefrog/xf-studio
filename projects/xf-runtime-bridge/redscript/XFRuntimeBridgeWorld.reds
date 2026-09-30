// XF Runtime Bridge: the world's state, streaming probes, the weather and photo mode's scene rows (bridge 0.7;
// research/runtime/bridge-hook-inventory.md).
//
// world.state (read): the clock (day, hours, minutes, seconds, paused, time dilation), the rain (vanilla WeatherSystem:
// type, intensity, puddles, moisture), the weather state's name and the environment's weather list (Codeware's
// WeatherSystem.GetWeatherState / GetEnvironmentDefinition, detected; without Codeware the name isn't script-readable),
// named quest facts (QuestsSystem.GetFactStr, read-only), and in photo mode its own time, weather, NPC and game-speed rows.
// world.probe (read, observe only): at each point, whether the navmesh is streamed in (NavigationSystem.
// IsNavmeshStreamedInLocation), the nearest walkable point (FindPointInSphereOnlyHumanNavmesh), the ground below and
// static geometry above (SyncRaycastByCollisionGroup, Static). Nothing here changes the game.
// world.weather.set (write-world, Codeware only): SetWeather(name, blend, priority) switches the game's weather cycle off
// and holds the state (Codeware src/App/World/WeatherSystemEx.cpp); the undo sets the earlier state back and switches the
// cycle on again (ResetWeather), which is also what the kill switch does. A save made meanwhile would keep the weather, so
// the save lock is taken first, as for every write.
// photo.scene.set (write-photo): photo mode's own rows, surrounding NPCs (54), weather (69) and game speed (71), through
// the menu like every other photo-mode attribute (XFPhoto.SetAttribute); gone when photo mode closes.
//
// Sources [source] 2.31: timeSystem (orphans.script:18615-18649), WeatherSystem (orphans.script:43599-43611),
// QuestsSystem.GetFactStr (orphans.script:17075), NavigationSystem (core/systems/navigationSystem.script), photo mode's
// attribute keys (knowledge/photo-mode.md §8.1); Codeware 1.20.4 scripts/World/WeatherSystem.reds.

module XFRuntimeBridge

public abstract class XFWorldState {
  public static func Clock() -> String {
    let game = GetGameInstance();
    let time = GameInstance.GetTimeSystem(game);
    let now = time.GetGameTime();
    let out = "{\"day\":" + IntToString(GameTime.Days(now)) + ",\"hours\":" + IntToString(GameTime.Hours(now)) + ",\"minutes\":" + IntToString(GameTime.Minutes(now)) + ",\"seconds\":" + IntToString(GameTime.Seconds(now));
    out += ",\"paused\":" + XFJson.Flag(time.IsPausedState()) + ",\"time_dilation_active\":" + XFJson.Flag(time.IsTimeDilationActive());
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) {
      out += ",\"bridge_world_frozen\":" + XFJson.Flag(registry.IsWorldFrozen());
    }
    return out + "}";
  }

  public static func Rain() -> String {
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    if !IsDefined(weather) {
      return "null";
    }
    let type = EnumValueToString("worldRainIntensity", Cast<Int64>(EnumInt(weather.GetRainIntensityType())));
    return "{\"type\":" + XFJson.Str(type) + ",\"intensity\":" + XFJson.Num(weather.GetRainIntensity()) + ",\"puddles\":" + XFJson.Num(weather.GetRainPuddles()) + ",\"moisture\":" + XFJson.Num(weather.GetRainMoisture()) + "}";
  }

  public static func Facts(names: String) -> String {
    if StrLen(names) == 0 {
      return "{}";
    }
    let quests = GameInstance.GetQuestsSystem(GetGameInstance());
    let list = StrSplit(names, ",");
    let out = "{";
    let i = 0;
    while i < ArraySize(list) {
      if i > 0 {
        out += ",";
      }
      out += XFJson.Str(list[i]) + ":" + IntToString(quests.GetFactStr(list[i]));
      i += 1;
    }
    return out + "}";
  }

  // Photo mode's scene rows while it is open: time of day (70), weather (69), surrounding NPCs (54), game speed (71).
  public static func PhotoRows() -> String {
    if !XFPhoto.Active() {
      return "null";
    }
    let controller = XFPhoto.Controller();
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(controller) || !IsDefined(registry) {
      return "{\"menu_seen\":false}";
    }
    let keys: array<Uint32>;
    ArrayPush(keys, 54u);
    ArrayPush(keys, 69u);
    ArrayPush(keys, 70u);
    ArrayPush(keys, 71u);
    let out = "{\"menu_seen\":true,\"rows\":[";
    let written = 0;
    let i = 0;
    while i < ArraySize(keys) {
      let item = registry.FindItem(keys[i]);
      if IsDefined(item) {
        if written > 0 {
          out += ",";
        }
        out += XFPhoto.DescribeItem(controller, item, Equals(item.kind, "options"));
        written += 1;
      }
      i += 1;
    }
    return out + "]}";
  }

  // world.state (read).
  public static func State(cid: String, facts: String) -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    let out = "{\"ok\":true,\"clock\":" + XFWorldState.Clock() + ",\"rain\":" + XFWorldState.Rain() + ",\"weather\":" + XFWeather.Current(false);
    out += ",\"facts\":" + XFWorldState.Facts(facts) + ",\"photo_mode\":" + XFWorldState.PhotoRows() + "}";
    XFBridgeLog.Debug(cid, "world state");
    return out;
  }

  // world.probe (read): one point. radius bounds the navmesh search; down is how far below the point the ground ray looks.
  public static func Probe(cid: String, x: Float, y: Float, z: Float, radius: Float, down: Float) -> String {
    let game = GetGameInstance();
    let navigation = GameInstance.GetNavigationSystem(game);
    let queries = GameInstance.GetSpatialQueriesSystem(game);
    if !IsDefined(navigation) || !IsDefined(queries) {
      return XFJson.Fail("unavailable", "the navigation or spatial query system isn't available");
    }
    let point = new Vector4(x, y, z, 1.0);
    let streamed = navigation.IsNavmeshStreamedInLocation(point, radius);
    let out = "{\"ok\":true,\"point\":" + XFScene.Arr(point) + ",\"navmesh_streamed\":" + XFJson.Flag(streamed);
    if streamed {
      let found = navigation.FindPointInSphereOnlyHumanNavmesh(point, radius, NavGenAgentSize.Human, true);
      if Equals(found.status, worldNavigationRequestStatus.OK) {
        out += ",\"walkable\":" + XFScene.Arr(found.point) + ",\"walkable_off_m\":" + XFJson.Num(Vector4.Distance(found.point, point));
      } else {
        out += ",\"walkable\":null";
      }
    }
    let result: TraceResult;
    let from = new Vector4(x, y, z + 0.5, 1.0);
    let to = new Vector4(x, y, z - down, 1.0);
    if queries.SyncRaycastByCollisionGroup(from, to, n"Static", result, true, false) && TraceResult.IsValid(result) {
      let at = Vector4.Vector3To4(result.position);
      out += ",\"ground\":{\"z\":" + XFJson.Num(at.Z) + ",\"below_m\":" + XFJson.Num(z - at.Z) + ",\"material\":" + XFJson.Name(result.material) + "}";
    } else {
      out += ",\"ground\":null";
    }
    let upResult: TraceResult;
    let up = new Vector4(x, y, z + 20.0, 1.0);
    if queries.SyncRaycastByCollisionGroup(from, up, n"Static", upResult, true, false) && TraceResult.IsValid(upResult) {
      let above = Vector4.Vector3To4(upResult.position);
      out += ",\"ceiling_m\":" + XFJson.Num(above.Z - z);
    } else {
      out += ",\"ceiling_m\":null";
    }
    let player = GetPlayer(game);
    if IsDefined(player) {
      out += ",\"from_v_m\":" + XFJson.Num(Vector4.Distance(player.GetWorldPosition(), point));
    }
    return out + "}";
  }
}

// photo.scene.set's option rows by their on-screen label (weather), matched loosely as photo.expression.set matches.
public abstract class XFPhotoScene {
  // The option data of the row's option whose text equals `label` (case-insensitive), then contains it when exactly one
  // does; -1 when none (or several) match. `matched` says how.
  public static func Option(key: Int32, label: String, out matched: String) -> Int32 {
    let registry = XFBridgeRegistry.Get();
    if !IsDefined(registry) {
      return -1;
    }
    let item = registry.FindItem(Cast<Uint32>(key));
    if !IsDefined(item) || NotEquals(item.kind, "options") {
      return -1;
    }
    let wanted = StrLower(label);
    let i = 0;
    while i < ArraySize(item.optionTexts) {
      if Equals(StrLower(item.optionTexts[i]), wanted) {
        matched = "exact";
        return item.optionData[i];
      }
      i += 1;
    }
    let found = -1;
    let count = 0;
    i = 0;
    while i < ArraySize(item.optionTexts) {
      if StrContains(StrLower(item.optionTexts[i]), wanted) {
        found = item.optionData[i];
        count += 1;
      }
      i += 1;
    }
    if count == 1 {
      matched = "partial";
      return found;
    }
    return -1;
  }

  public static func Resolve(cid: String, key: Int32, label: String) -> String {
    if !XFPhoto.Active() {
      return XFJson.Fail("not_in_photo_mode", "photo mode is not open");
    }
    let matched = "";
    let data = XFPhotoScene.Option(key, label, matched);
    if data < 0 {
      return XFJson.Fail("bad_params", "no single option of photo-mode row " + IntToString(key) + " is labelled '" + label + "' (photo_state with options lists them)");
    }
    return "{\"ok\":true,\"key\":" + IntToString(key) + ",\"value\":" + IntToString(data) + ",\"matched_by\":" + XFJson.Str(matched) + "}";
  }
}

// The weather through Codeware (detected; never installed).
@if(ModuleExists("Codeware"))
public class XFWeatherMemory extends ScriptableSystem {
  public let changed: Bool;
  public let earlier: CName;
}

@if(ModuleExists("Codeware"))
public abstract class XFWeather {
  public static func Memory() -> ref<XFWeatherMemory> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFWeatherMemory") as XFWeatherMemory : null;
  }

  public static func Name() -> CName {
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    if !IsDefined(weather) {
      return n"";
    }
    let state = weather.GetWeatherState();
    return IsDefined(state) ? state.name : n"";
  }

  public static func Current(withList: Bool) -> String {
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    if !IsDefined(weather) {
      return "{\"readable\":false,\"why\":\"the weather system isn't available\"}";
    }
    let out = "{\"readable\":true,\"name\":" + XFJson.Name(XFWeather.Name());
    let memory = XFWeather.Memory();
    if IsDefined(memory) {
      out += ",\"set_by_bridge\":" + XFJson.Flag(memory.changed);
    }
    let definition = weather.GetEnvironmentDefinition();
    if IsDefined(definition) {
      out += ",\"states\":[";
      let i = 0;
      while i < ArraySize(definition.weatherStates) {
        if i > 0 {
          out += ",";
        }
        let state = definition.weatherStates[i];
        out += IsDefined(state) ? XFJson.Name(state.name) : "null";
        i += 1;
      }
      out += "]";
    }
    return out + "}";
  }

  public static func IsKnown(name: CName) -> Bool {
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    let definition = IsDefined(weather) ? weather.GetEnvironmentDefinition() : null;
    if !IsDefined(definition) {
      return true; // the list can't be read: let SetWeather answer
    }
    let i = 0;
    while i < ArraySize(definition.weatherStates) {
      if IsDefined(definition.weatherStates[i]) && Equals(definition.weatherStates[i].name, name) {
        return true;
      }
      i += 1;
    }
    return false;
  }

  // world.weather.set: name = "" with cycle true resets (the undo); otherwise holds that state.
  public static func Set(cid: String, name: String, blend: Float, cycle: Bool) -> String {
    let phase = XFBridgeActions.Phase();
    if NotEquals(phase, "gameplay") && NotEquals(phase, "photo_mode") {
      return XFJson.Fail("not_in_gameplay", "the weather is set in normal play or photo mode; the game is in '" + phase + "'");
    }
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    let memory = XFWeather.Memory();
    if !IsDefined(weather) || !IsDefined(memory) {
      return XFJson.Fail("unavailable", "the weather system isn't available");
    }
    let before = XFWeather.Name();
    let target = StringToName(name);
    if StrLen(name) > 0 && !XFWeather.IsKnown(target) {
      return XFJson.Fail("bad_params", "'" + name + "' isn't one of this world's weather states (world_state lists them)");
    }
    XFBridgeActions.EnsureSaveLock(cid);
    if !memory.changed {
      memory.changed = true;
      memory.earlier = before;
    }
    let ok = true;
    if StrLen(name) > 0 {
      ok = weather.SetWeather(target, blend, 100u);
    }
    if ok && cycle {
      ok = weather.ResetWeather(false, blend);
      if StrLen(name) == 0 || Equals(target, memory.earlier) {
        memory.changed = false;
      }
    }
    if !ok {
      return XFJson.Fail("call_failed", "the game didn't take the weather change");
    }
    XFBridgeLog.Info(cid, "weather " + NameToString(before) + " -> " + (StrLen(name) > 0 ? name : "(unchanged)") + ", cycle " + (cycle ? "on" : "held") + "; undo: set " + NameToString(before) + " back with the cycle on");
    return "{\"ok\":true,\"before\":" + XFJson.Name(before) + ",\"after\":" + XFJson.Str(name) + ",\"cycle\":" + XFJson.Flag(cycle) + ",\"blend_s\":" + XFJson.Num(blend) + "}";
  }

  public static func RestoreAfterKill(cid: String) -> String {
    let memory = XFWeather.Memory();
    let weather = GameInstance.GetWeatherSystem(GetGameInstance());
    if !IsDefined(memory) || !memory.changed || !IsDefined(weather) {
      return "";
    }
    let earlier = memory.earlier;
    if NotEquals(earlier, n"") {
      weather.SetWeather(earlier, 1.0, 100u);
    }
    weather.ResetWeather(false, 1.0);
    memory.changed = false;
    return ",\"weather_restored\":" + XFJson.Name(earlier);
  }
}

@if(!ModuleExists("Codeware"))
public abstract class XFWeather {
  public static func Current(withList: Bool) -> String {
    return "{\"readable\":false,\"why\":\"the weather state's name needs Codeware, which isn't loaded (the rain values are read without it)\"}";
  }

  public static func Set(cid: String, name: String, blend: Float, cycle: Bool) -> String {
    return XFJson.Fail("codeware_missing", "setting the weather needs Codeware, which isn't loaded; get it from its official releases page");
  }

  public static func RestoreAfterKill(cid: String) -> String {
    return "";
  }
}
