module XFRuntimeBridge

// Autonomous only. Independent listener: never borrows or unregisters a glide's watch.
public class XFSupervisorSystem extends ScriptableSystem {
  public let watch: ref<XFGlideInput>;
  public let raw: ref<IScriptable>;
  public let player: wref<PlayerPuppet>;
  public static func Get() -> ref<XFSupervisorSystem> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFSupervisorSystem") as XFSupervisorSystem : null;
  }
  public func Stop() -> Void {
    if IsDefined(this.player) && IsDefined(this.watch) { this.player.UnregisterInputListener(this.watch); }
    XFRawAxisWatch.Stop(this.raw);
    this.watch = null;
    this.raw = null;
    this.player = null;
  }
  private func OnDetach() -> Void { this.Stop(); }
}

// 0.8.19: the actor adapter. One XF actor, resolved afresh from the registry's handle on every read (no pointer is kept): where it
// stands and faces, whether it is dead or in combat, and whether it is streamed in. Read-only; nothing here changes the game.
@if(ModuleExists("Codeware"))
public abstract class XFSupervisorActors {
  public static func Read(who: String) -> String {
    let lost = "{\"ok\":true,\"who\":" + XFJson.Str(who) + ",\"valid\":false,\"streamed\":false}";
    let registry = XFNpcRegistry.Get();
    let entry = IsDefined(registry) ? registry.Entry(who) : null;
    if !IsDefined(entry) || !Equals(entry.kind, "actor") {
      return lost;
    }
    let system = GameInstance.GetDynamicEntitySystem();
    let streamed = IsDefined(system) && system.IsSpawned(entry.id);
    let puppet = XFNpc.PuppetOf(entry);
    if !streamed || !IsDefined(puppet) || !puppet.IsAttached() {
      return lost;
    }
    return "{\"ok\":true,\"who\":" + XFJson.Str(who) + ",\"valid\":true,\"streamed\":true,\"entity\":" + XFJson.Str(EntityID.ToDebugString(puppet.GetEntityID()))
      + ",\"position\":" + XFScene.Arr(puppet.GetWorldPosition()) + ",\"yaw\":" + XFJson.Num(puppet.GetWorldYaw())
      + ",\"dead\":" + XFJson.Flag(puppet.IsDead()) + ",\"in_combat\":" + XFJson.Flag(NPCPuppet.IsInCombat(puppet)) + "}";
  }
}
@if(!ModuleExists("Codeware"))
public abstract class XFSupervisorActors {
  public static func Read(who: String) -> String {
    return "{\"ok\":true,\"who\":" + XFJson.Str(who) + ",\"valid\":false,\"streamed\":false}";
  }
}

public abstract class XFSupervisor {
  public static func ReadActor(cid: String, who: String) -> String {
    return XFSupervisorActors.Read(who);
  }
  public static func SpawnPositions(cid: String, entities: String) -> String {
    let out = "";
    for pair in StrSplit(entities, ",") {
      let parts = StrSplit(pair, "=");
      if ArraySize(parts) >= 2 {
        let object = XFDmIds.Find(parts[1]);
        if IsDefined(object) && object.IsAttached() {
          out += (StrLen(out) > 0 ? "," : "") + XFJson.Str(parts[0]) + ":{\"p\":" + XFScene.Arr(object.GetWorldPosition()) + "}";
        }
      }
    }
    return "{\"ok\":true,\"ents\":{" + out + "}}";
  }
  public static func Watch(cid: String, on: Bool) -> String {
    let system = XFSupervisorSystem.Get();
    let player = XFPlayer.Player();
    if !IsDefined(system) || !IsDefined(player) { return XFJson.Fail("supervisor_unavailable", "No V input listener owner"); }
    system.Stop();
    if on {
      system.watch = new XFGlideInput();
      system.watch.xfSupervisorWatch = true;
      // Movement, camera, jump/crouch/sprint/dodge plus deliberate combat/interact input.
      let names = XFGlideInput.Actions();
      // 2.31 PSM: weaponTransitions:223–243,321; meleeTransitions:171,206–263.
      ArrayPush(names, n"RangedAttack");
      ArrayPush(names, n"CameraAim");
      ArrayPush(names, n"Reload");
      ArrayPush(names, n"MeleeAttack");
      ArrayPush(names, n"MeleeLightAttack");
      ArrayPush(names, n"MeleeHeavyAttack");
      ArrayPush(names, n"MeleeStrongAttack");
      ArrayPush(names, n"MeleeBlock");
      ArrayPush(names, n"QuickMelee");
      ArrayPush(names, n"Interact");
      for name in names { player.RegisterInputListener(system.watch, name); }
      system.raw = XFRawAxisWatch.Start(system.watch);
      system.player = player;
    }
    return "{\"ok\":true}";
  }
  public static func Read(cid: String) -> String {
    let system = XFSupervisorSystem.Get();
    let registry = XFBridgeRegistry.Get();
    let input = IsDefined(system) && IsDefined(system.watch) ? system.watch.touched : "";
    return "{\"ok\":true,\"phase\":" + XFJson.Str(XFBridgeActions.Phase()) + ",\"input\":" + XFJson.Str(input)
      + ",\"world_frozen\":" + XFJson.Flag(IsDefined(registry) && registry.IsWorldFrozen()) + "}";
  }
}
