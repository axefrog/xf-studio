// XF Runtime Bridge 0.8.20, a TEST TAP (the autonomous -writes package only): what V witnessed, as reports tied to their incidents
// (research/story-engine/runtime-requirements.md S7; built on S1, the event feed, and S2, perception). These wraps watch the game's
// own producing systems and hand the plugin small observations (XFBridge_IncidentSeen); the plugin (native/src/core/Incidents.cpp)
// groups them into incidents, decides what V saw and heard, and reports an incident V perceived when it closes.
//
// PASSIVE AND READ-ONLY. Every wrap calls the game's own method first and unchanged, then reads. Nothing here sends an event,
// stimulus or command, changes an attitude, a fact, a status, a position or an item, or registers anything but a one-second
// delay callback that sends the simulation clock. The people it names get no new ties and no new beliefs.
//
// The producing systems (2.31 scripts, final.redscripts SHA-256 2119046f..ee86; paths as decompiled):
//   StimBroadcasterComponent.TriggerSingleBroadcast (core/components/stimBroadcasterComponent.script:162). The broadcaster's owner
//     is the sender, contextOwner may be another object (an NPC's weapon, or the victim). Allow-listed types and who they name:
//       Gunshot, SilencedGunshot  an NPC's shot (cyberpunk/items/weapon.script:1610, the owner is the shooter; V's own: weaponTransitions
//                                  .script:1943-1962); the stimulus' radius is the audible radius, else the stim record's
//       Explosion                  the owner is the source
//       MeleeHit                   sent from the victim (cyberpunk/puppet/scriptedPuppet.script:3930); investigateData.attackInstigator
//                                  is the attacker
//       CrimeWitness               from the attacker with the victim as contextOwner when a melee blow lands on a civilian or a
//                                  crowd person (scriptedPuppet.script:3925-3927)
//       CrowdIllegalAction, VehicleHit  from a vehicle that collided (core/components/scriptComponents/vehicleComponent.script:3536-3538);
//                                  from a person struck by a car, the attacker is the vehicle (reactionComponent.script:5188-5206)
//       Scream, Terror             a person screaming or terrorised (hitReactionComponent.script:2129, NPCPuppet.script:3062)
//       DeadBody                   from a victim V incapacitated (reactionComponent.script:4645)
//   ScriptedPuppet.OnDeath / OnDefeated (scriptedPuppet.script:2130-2136), the instigator on the death event.
//   AICombatTargetHelper.SetNewCombatTarget (cyberpunk/ai/Tasks/aiCoreTasks.script:305): X now targets Y, the combat start between
//     NPCs (and with V). The prevention system itself (core/systems/preventionSystem.script) only reacts to V's own crimes
//     (CombatStartedRequest, CrimeWitnessRequest, :2744-2765), so it is not a source of NPC incidents.
//   ReactionManagerComponent.OnReprimandUpdate (reactionComponent.script:720): a guard or NCPD officer warns a trespasser, the
//     game's own police stop (the security system's ReprimandUpdate, securitySystemMisc.script:549).
//   VehicleObject.StealVehicle (core/gameplay/vehicles.script:473): V stealing a police or flagged vehicle. The only theft the
//     scripts have; ReevaluateStealing (:453) refuses everyone but the player.
//   GameObject.PlayVoiceOver: combat and fear barks only (vo_any_damage_hit, grenade_throw, reloading, fear_beg, fear_run,
//     battlecry_*, combat_target_hit): weak evidence, a quarter of a report each.
//
// V's perception of each observation is sampled here, when the game raises it: the distance, whether the person is inside the active
// camera's view, and a static-geometry ray from the camera (as scene.read's occlusion). Bounded: the allow-list first, a distance gate,
// the plugin's admission (at most 24 built a second, 12 of them weak kinds, 2 of one kind from one entity, every refusal counted),
// at most four people each and one ray per person in view within 80 m.
//
// 0.8.21, the engine's declared incidents (incidents.declare): the game raises almost none of the Story Engine's incident kinds, so
// the engine stages its own with XF actors. While one is open the poll (every half second; the clock tick still goes once a second)
// asks the plugin which XF actors to look at (XFBridge_IncidentSightPlan: the actors of at most four open declared incidents, at most
// five in all), finds each by its handle in the NPC registry, and sends one sight sample: the same Fact (distance, inside the camera's
// view, the static ray from the camera) the taps build, so a silent staged incident can still be seen. Read only, like the rest: no
// event, stimulus or command goes anywhere, and nothing is sampled when no declared incident is open.

module XFRuntimeBridge

// The ray, the view and V's place, taken once per observation.
public class XFIncidentView {
  public let valid: Bool;
  public let photo: Bool;
  public let from: Vector4;
  public let forward: Vector4;
  public let vPos: Vector4;

  public static func Make() -> ref<XFIncidentView> {
    let game = GetGameInstance();
    let player = GetPlayer(game);
    if !IsDefined(player) {
      return null;
    }
    let view = new XFIncidentView();
    view.vPos = player.GetWorldPosition();
    let cameras = GameInstance.GetCameraSystem(game);
    let photo = GameInstance.GetPhotoModeSystem(game);
    view.photo = IsDefined(photo) && photo.IsPhotoModeActive();
    if IsDefined(cameras) && !view.photo {
      let transform: Transform;
      if cameras.GetActiveCameraWorldTransform(transform) {
        view.from = transform.position;
        view.forward = cameras.GetActiveCameraForward();
        view.valid = true;
      }
    }
    return view;
  }

  // Inside the active camera's view: in front of it, and on the screen the game's own projection draws.
  public func InView(point: Vector4) -> Bool {
    if !this.valid {
      return false;
    }
    let dx = point.X - this.from.X;
    let dy = point.Y - this.from.Y;
    let dz = point.Z - this.from.Z;
    let length = SqrtF(dx * dx + dy * dy + dz * dz);
    if length < 0.3 {
      return true;
    }
    if (dx * this.forward.X + dy * this.forward.Y + dz * this.forward.Z) / length <= 0.05 {
      return false;
    }
    let screen = GameInstance.GetCameraSystem(GetGameInstance()).ProjectPoint(point);
    return AbsF(screen.X) <= 1.0 && AbsF(screen.Y) <= 1.0;
  }

  // 0 clear, 1 blocked by static geometry (a hit more than 12 cm before the point), 2 not checked.
  public func Ray(point: Vector4) -> Int32 {
    if !this.valid {
      return 2;
    }
    let dx = point.X - this.from.X;
    let dy = point.Y - this.from.Y;
    let dz = point.Z - this.from.Z;
    let length = SqrtF(dx * dx + dy * dy + dz * dz);
    if length < 0.3 {
      return 0;
    }
    let result: TraceResult;
    let hit = GameInstance.GetSpatialQueriesSystem(GetGameInstance()).SyncRaycastByCollisionGroup(this.from, point, n"Static", result, true, false);
    // A ray that hit nothing is clear. A ray that reports a hit but whose result is not valid tells us nothing about the line, so it
    // is Unchecked (2) and cannot establish sight.
    if !hit {
      return 0;
    }
    if !TraceResult.IsValid(result) {
      return 2;
    }
    let at = Vector4.Vector3To4(result.position);
    let hx = at.X - this.from.X;
    let hy = at.Y - this.from.Y;
    let hz = at.Z - this.from.Z;
    let hitLength = SqrtF(hx * hx + hy * hy + hz * hz);
    return hitLength < length - 0.12 ? 1 : 0;
  }
}

// An XF actor's handle (a1, p2), when the object is one the bridge placed.
@if(ModuleExists("Codeware"))
public abstract class XFIncidentWho {
  public static func Of(obj: ref<GameObject>) -> String {
    let registry = XFNpcRegistry.Get();
    if IsDefined(registry) && IsDefined(obj) {
      for entry in registry.Entries() {
        if Equals(entry.id, obj.GetEntityID()) {
          return entry.who;
        }
      }
    }
    return "";
  }

  // The XF actor with this handle, or null: not in the registry, or not in the world (yet).
  public static func Find(who: String) -> ref<GameObject> {
    let registry = XFNpcRegistry.Get();
    if !IsDefined(registry) {
      return null;
    }
    for entry in registry.Entries() {
      if Equals(entry.who, who) {
        return GameInstance.FindEntityByID(GetGameInstance(), entry.id) as GameObject;
      }
    }
    return null;
  }
}
@if(!ModuleExists("Codeware"))
public abstract class XFIncidentWho {
  public static func Of(obj: ref<GameObject>) -> String {
    return "";
  }

  public static func Find(who: String) -> ref<GameObject> {
    return null;
  }
}

// The half-second poll: every second it sends the simulation clock, which is what closes an incident that went quiet (so a paused
// game ages nothing) and what runs a declared incident's TTL; every half second it takes the sight sample the plugin asks for.
public class XFIncidentSystem extends ScriptableSystem {
  private let m_on: Bool;
  private let m_half: Int32;
  private let m_poll: ref<XFIncidentPoll>;

  public static func Get() -> ref<XFIncidentSystem> {
    let container = GameInstance.GetScriptableSystemsContainer(GetGameInstance());
    return IsDefined(container) ? container.Get(n"XFRuntimeBridge.XFIncidentSystem") as XFIncidentSystem : null;
  }

  private func OnPlayerAttach(request: ref<PlayerAttachRequest>) -> Void {
    if this.m_on || (XFBridge_ProbeFlags() & 1) == 0 {
      return;
    }
    this.m_on = true;
    this.m_poll = new XFIncidentPoll();
    this.m_poll.system = this;
    GameInstance.GetDelaySystem(this.GetGameInstance()).DelayCallback(this.m_poll, 0.5, false);
  }

  private func OnDetach() -> Void {
    this.m_on = false;
    if IsDefined(this.m_poll) {
      this.m_poll.system = null;
      this.m_poll = null;
    }
  }

  public func Poll() -> Void {
    if !this.m_on {
      return;
    }
    let game = this.GetGameInstance();
    if (XFBridge_ProbeFlags() & 16) != 0 && XFBridge_Live() {
      this.m_half += 1;
      if this.m_half >= 2 {
        this.m_half = 0;
        let sim = EngineTime.ToFloat(GameInstance.GetSimTime(game));
        XFBridge_IncidentSeen("{\"tick\":true,\"sim\":" + XFJson.Num(sim) + "}");
      }
      let plan = XFBridge_IncidentSightPlan();
      if StrLen(plan) > 0 {
        XFIncidentTap.Sight(plan);
      }
    }
    if IsDefined(this.m_poll) {
      GameInstance.GetDelaySystem(game).DelayCallback(this.m_poll, 0.5, false);
    }
  }
}

public class XFIncidentPoll extends DelayCallback {
  public let system: wref<XFIncidentSystem>;

  public func Call() -> Void {
    if IsDefined(this.system) {
      this.system.Poll();
    }
  }
}

public abstract class XFIncidentTap {
  // The cheap gate every wrap passes first: the tap is switched on and the script gate is open.
  public static func On() -> Bool {
    return (XFBridge_ProbeFlags() & 16) != 0 && XFBridge_Live();
  }

  // The stimulus types that mean something happened. Everything else (footsteps, bumps, a reload) returns before any other work.
  public static func WantedStim(type: gamedataStimType) -> Bool {
    let wanted = false;
    switch type {
      case gamedataStimType.Gunshot:
      case gamedataStimType.SilencedGunshot:
      case gamedataStimType.Explosion:
      case gamedataStimType.MeleeHit:
      case gamedataStimType.CrimeWitness:
      case gamedataStimType.CrowdIllegalAction:
      case gamedataStimType.VehicleHit:
      case gamedataStimType.Scream:
      case gamedataStimType.Terror:
      case gamedataStimType.DeadBody:
        wanted = true;
        break;
      default:
        break;
    }
    return wanted;
  }

  // The barks that come from a fight or a fright.
  public static func WantedVoice(name: CName) -> Bool {
    return Equals(name, n"vo_any_damage_hit") || Equals(name, n"grenade_throw") || Equals(name, n"reloading") || Equals(name, n"fear_beg")
      || Equals(name, n"fear_run") || Equals(name, n"battlecry_single_enemy") || Equals(name, n"battlecry_curse") || Equals(name, n"battlecry_morale")
      || Equals(name, n"combat_target_hit");
  }

  // The view for an observation at a place, or null when it should not be built: the tap is off, V is not there, the place is farther
  // than 160 m (the farthest radius of the stimuli it watches), or the plugin's admission refuses it. The admission is bounded per
  // second, by evidence and by entity (a burst of V's own shots cannot starve a death or a collision), and counts every refusal.
  public static func Begin(at: Vector4, evidence: String, who: ref<GameObject>) -> ref<XFIncidentView> {
    if !XFIncidentTap.On() || !IsDefined(who) {
      return null;
    }
    let view = XFIncidentView.Make();
    if !IsDefined(view) || Vector4.Distance(view.vPos, at) > 160.0 {
      return null;
    }
    let key = EntityID.ToDebugString(who.GetEntityID());
    if !XFBridge_IncidentAdmit(evidence, key) {
      return null;
    }
    return view;
  }

  // One person or vehicle with V's samples of it. The world-object rule (scene.read's XFScene.Identity): only the natives every
  // entity answers, the record after a cast to the class that declares it.
  public static func Fact(view: ref<XFIncidentView>, obj: ref<GameObject>, role: String) -> String {
    if !IsDefined(obj) {
      return "";
    }
    let at = obj.GetWorldPosition();
    let id = EntityID.ToDebugString(obj.GetEntityID());
    let out = "{\"id\":" + XFJson.Str(id) + ",\"role\":" + XFJson.Str(role) + ",\"pos\":" + XFScene.Arr(at);
    if obj.IsPlayer() {
      return out + ",\"v\":1}";
    }
    let distance = Vector4.Distance(view.vPos, at);
    out += ",\"d\":" + XFJson.Num(distance);
    let handle = XFIncidentWho.Of(obj);
    if StrLen(handle) > 0 {
      out += ",\"w\":" + XFJson.Str(handle);
    }
    let puppet = obj as ScriptedPuppet;
    let vehicle = obj as VehicleObject;
    if IsDefined(puppet) {
      let recordId = puppet.GetRecordID();
      let crowd = puppet.IsCrowd();
      out += ",\"rec\":" + XFJson.Str(TDBID.ToStringDEBUG(recordId)) + ",\"crowd\":" + XFJson.Flag(crowd);
      let record = TweakDBInterface.GetCharacterRecord(recordId);
      if IsDefined(record) && IsDefined(record.Affiliation()) {
        out += ",\"aff\":" + XFJson.Name(record.Affiliation().EnumName());
      }
    } else {
      if IsDefined(vehicle) {
        let recordId = vehicle.GetRecordID();
        out += ",\"rec\":" + XFJson.Str(TDBID.ToStringDEBUG(recordId));
      }
    }
    // In view and unoccluded only matter within the see range (80 m); beyond it nothing is tested.
    let los = 2;
    let inView = false;
    if distance <= 80.0 && view.valid {
      let head = at;
      if IsDefined(puppet) {
        XFScene.Head(obj, head);
      } else {
        head.Z += 1.0;
      }
      inView = view.InView(head);
      if inView {
        los = view.Ray(head);
      }
    }
    return out + ",\"in\":" + (inView ? "1" : "0") + ",\"los\":" + IntToString(los) + "}";
  }

  public static func Join(a: String, b: String) -> String {
    if StrLen(a) == 0 {
      return b;
    }
    return StrLen(b) == 0 ? a : a + "," + b;
  }

  // The observation itself, to the plugin. who is a comma list of Fact strings (at most four).
  public static func Send(view: ref<XFIncidentView>, evidence: String, type: String, radius: Float, at: Vector4, who: String, opt worldEvent: String) -> Void {
    let game = GetGameInstance();
    let clock = GameInstance.GetTimeSystem(game);
    let gameStamp = IsDefined(clock) ? clock.GetGameTimeStamp() : -1.0;
    let sim = EngineTime.ToFloat(GameInstance.GetSimTime(game));
    let district = "";
    let boards = GameInstance.GetBlackboardSystem(game);
    if IsDefined(boards) {
      let defs = GetAllBlackboardDefs().UI_Map;
      let board = boards.Get(defs);
      if IsDefined(board) {
        district = board.GetString(defs.currentLocationEnumName);
      }
    }
    let text = "{\"ev\":" + XFJson.Str(evidence) + ",\"type\":" + XFJson.Str(type) + ",\"radius\":" + XFJson.Num(radius) + ",\"pos\":" + XFScene.Arr(at)
      + ",\"vd\":" + XFJson.Num(Vector4.Distance(view.vPos, at)) + ",\"sim\":" + XFJson.Num(sim) + ",\"game\":" + XFJson.Num(gameStamp)
      + ",\"dist\":" + XFJson.Str(district) + ",\"view\":" + XFJson.Str(view.photo ? "photo" : "gameplay") + ",\"who\":[" + who + "]}";
    if StrLen(worldEvent) > 0 { text = StrLeft(text, StrLen(text) - 1) + ",\"world_event\":" + XFJson.Str(worldEvent) + "}"; }
    XFBridge_IncidentSeen(text);
  }

  // 0.8.21: V's sight of the declared incidents' actors, one sample. plan is the plugin's list of handles (a1,a2); an actor that is not
  // in the world yet is left out (the plugin counts the sample as "actors missing" when none is found). The same Fact as an
  // observation's, with no role.
  public static func Sight(plan: String) -> Void {
    let view = XFIncidentView.Make();
    if !IsDefined(view) {
      return;
    }
    let who = "";
    let found = 0;
    for handle in StrSplit(plan, ",") {
      if found >= 8 {
        break;
      }
      let actor = XFIncidentWho.Find(handle);
      if IsDefined(actor) {
        who = XFIncidentTap.Join(who, XFIncidentTap.Fact(view, actor, ""));
        found += 1;
      }
    }
    let game = GetGameInstance();
    let clock = GameInstance.GetTimeSystem(game);
    let gameStamp = IsDefined(clock) ? clock.GetGameTimeStamp() : -1.0;
    let sim = EngineTime.ToFloat(GameInstance.GetSimTime(game));
    let district = "";
    let boards = GameInstance.GetBlackboardSystem(game);
    if IsDefined(boards) {
      let defs = GetAllBlackboardDefs().UI_Map;
      let board = boards.Get(defs);
      if IsDefined(board) {
        district = board.GetString(defs.currentLocationEnumName);
      }
    }
    let text = "{\"sight\":true,\"sim\":" + XFJson.Num(sim) + ",\"game\":" + XFJson.Num(gameStamp) + ",\"dist\":" + XFJson.Str(district)
      + ",\"view\":" + XFJson.Str(view.photo ? "photo" : "gameplay") + ",\"who\":[" + who + "]}";
    XFBridge_IncidentSeen(text);
  }

  // The stimulus' own radius when the sender gave one, else the radius its record in TweakDB defines.
  public static func StimRadius(type: gamedataStimType, given: Float) -> Float {
    if given > 0.0 {
      return given;
    }
    let stims = GameInstance.GetStimuliSystem(GetGameInstance());
    let record = IsDefined(stims) ? stims.GetStimRecord(type) : null;
    return IsDefined(record) ? record.Radius() : 0.0;
  }

  // The evidence a stimulus from this sender is, or "" when it is not one (a person's CrowdIllegalAction, say).
  public static func StimEvidence(type: gamedataStimType, fromVehicle: Bool) -> String {
    let evidence = "";
    switch type {
      case gamedataStimType.Gunshot:
      case gamedataStimType.SilencedGunshot:
        evidence = "gunshot";
        break;
      case gamedataStimType.Explosion:
        evidence = "explosion";
        break;
      case gamedataStimType.MeleeHit:
        evidence = "melee";
        break;
      case gamedataStimType.CrimeWitness:
        evidence = "crime";
        break;
      case gamedataStimType.CrowdIllegalAction:
        evidence = fromVehicle ? "collision" : "";
        break;
      case gamedataStimType.VehicleHit:
        evidence = fromVehicle ? "collision" : "vehicle_hit";
        break;
      case gamedataStimType.Scream:
      case gamedataStimType.Terror:
        evidence = "fear";
        break;
      case gamedataStimType.DeadBody:
        evidence = "body";
        break;
      default:
        break;
    }
    return evidence;
  }

  // TriggerSingleBroadcast after the game's own handling. owner is the sender; contextOwner may be a weapon or the victim.
  public static func Stim(owner: ref<GameObject>, contextOwner: wref<GameObject>, type: gamedataStimType, radius: Float, data: stimInvestigateData) -> Void {
    if !IsDefined(owner) {
      return;
    }
    let at = owner.GetWorldPosition();
    let vehicle = owner as VehicleObject;
    let evidence = XFIncidentTap.StimEvidence(type, IsDefined(vehicle));
    if StrLen(evidence) == 0 {
      return;
    }
    let view = XFIncidentTap.Begin(at, evidence, owner);
    if !IsDefined(view) {
      return;
    }
    let who = "";
    switch type {
      case gamedataStimType.Gunshot:
      case gamedataStimType.SilencedGunshot:
        who = XFIncidentTap.Fact(view, owner, IsDefined(vehicle) ? "vehicle" : "aggressor");
        break;
      case gamedataStimType.Explosion:
        who = XFIncidentTap.Fact(view, owner, "source");
        break;
      case gamedataStimType.MeleeHit:
        // Sent by the victim, with the attacker in the investigate data.
        who = XFIncidentTap.Join(XFIncidentTap.Fact(view, data.attackInstigator as GameObject, "aggressor"), XFIncidentTap.Fact(view, owner, "victim"));
        break;
      case gamedataStimType.CrimeWitness:
        if IsDefined(contextOwner) && contextOwner != owner && IsDefined(contextOwner as ScriptedPuppet) {
          who = XFIncidentTap.Join(XFIncidentTap.Fact(view, owner, "aggressor"), XFIncidentTap.Fact(view, contextOwner as GameObject, "victim"));
        } else {
          who = XFIncidentTap.Fact(view, owner, "source");
        }
        break;
      case gamedataStimType.CrowdIllegalAction:
        // Only a vehicle's reaches here (StimEvidence): a collision. A person's own is the game's reaction to something already seen.
        who = XFIncidentTap.Fact(view, owner, "vehicle");
        break;
      case gamedataStimType.VehicleHit:
        who = XFIncidentTap.Fact(view, owner, IsDefined(vehicle) ? "vehicle" : "source");
        break;
      case gamedataStimType.Scream:
      case gamedataStimType.Terror:
        who = XFIncidentTap.Fact(view, owner, "source");
        break;
      case gamedataStimType.DeadBody:
        who = XFIncidentTap.Join(XFIncidentTap.Fact(view, data.attackInstigator as GameObject, "aggressor"), XFIncidentTap.Fact(view, owner, "victim"));
        break;
      default:
        return;
    }
    XFIncidentTap.Send(view, evidence, EnumValueToString("gamedataStimType", Cast<Int64>(EnumInt(type))), XFIncidentTap.StimRadius(type, radius), at, who);
  }

  // A death or a defeat: the victim and, when the game names one, who did it.
  public static func Death(victim: ref<GameObject>, killer: ref<GameObject>, opt worldEvent: String) -> Void {
    if !IsDefined(victim) {
      return;
    }
    let at = victim.GetWorldPosition();
    let view = XFIncidentTap.Begin(at, "death", victim);
    if !IsDefined(view) {
      return;
    }
    let who = XFIncidentTap.Fact(view, victim, "victim");
    if IsDefined(killer) && killer != victim {
      who = XFIncidentTap.Join(XFIncidentTap.Fact(view, killer, "aggressor"), who);
    }
    XFIncidentTap.Send(view, "death", "Death", 0.0, at, who, worldEvent);
  }

  // X now targets Y: a fight begins. No sound of its own.
  public static func Combat(attacker: ref<GameObject>, target: ref<GameObject>) -> Void {
    if !IsDefined(attacker) || !IsDefined(target) || attacker == target {
      return;
    }
    let at = attacker.GetWorldPosition();
    let view = XFIncidentTap.Begin(at, "combat", attacker);
    if !IsDefined(view) {
      return;
    }
    XFIncidentTap.Send(view, "combat", "CombatTarget", 0.0, at, XFIncidentTap.Join(XFIncidentTap.Fact(view, attacker, "aggressor"), XFIncidentTap.Fact(view, target, "victim")));
  }

  // The game's police stop: a guard or an officer warns a trespasser. Speech carries a few metres.
  public static func Reprimand(officer: ref<GameObject>, evt: ref<ReprimandUpdate>) -> Void {
    if !IsDefined(officer) || !IsDefined(evt) {
      return;
    }
    let step = "";
    switch evt.reprimandInstructions {
      case EReprimandInstructions.INITIATE_FIRST:
        step = "InitiateFirst";
        break;
      case EReprimandInstructions.INITIATE_SUCCESSIVE:
        step = "InitiateSuccessive";
        break;
      case EReprimandInstructions.TAKEOVER:
        step = "Takeover";
        break;
      case EReprimandInstructions.CONCLUDE_SUCCESSFUL:
        step = "ConcludeSuccessful";
        break;
      case EReprimandInstructions.CONCLUDE_FAILED:
        step = "ConcludeFailed";
        break;
      default:
        return;
    }
    let at = officer.GetWorldPosition();
    let view = XFIncidentTap.Begin(at, "reprimand", officer);
    if !IsDefined(view) {
      return;
    }
    let subject = GameInstance.FindEntityByID(GetGameInstance(), evt.target) as GameObject;
    let who = XFIncidentTap.Fact(view, officer, "officer");
    if IsDefined(subject) {
      who = XFIncidentTap.Join(who, XFIncidentTap.Fact(view, subject, "subject"));
    }
    XFIncidentTap.Send(view, "reprimand", step, 12.0, at, who);
  }

  // V taking a vehicle that triggers prevention.
  public static func Theft(vehicle: ref<GameObject>, thief: ref<GameObject>) -> Void {
    if !IsDefined(vehicle) || !IsDefined(thief) {
      return;
    }
    let at = vehicle.GetWorldPosition();
    let view = XFIncidentTap.Begin(at, "theft", thief);
    if !IsDefined(view) {
      return;
    }
    XFIncidentTap.Send(view, "theft", "VehicleTheft", 0.0, at, XFIncidentTap.Join(XFIncidentTap.Fact(view, thief, "thief"), XFIncidentTap.Fact(view, vehicle, "vehicle")));
  }

  // A combat or fear bark. A bark carries a few metres and says little, so it counts for a quarter of a report.
  public static func Voice(speaker: ref<GameObject>, name: CName) -> Void {
    if !IsDefined(speaker) || speaker.IsPlayer() {
      return;
    }
    let at = speaker.GetWorldPosition();
    let view = XFIncidentTap.Begin(at, "voice", speaker);
    if !IsDefined(view) {
      return;
    }
    XFIncidentTap.Send(view, "voice", NameToString(name), 15.0, at, XFIncidentTap.Fact(view, speaker, "speaker"));
  }
}

@wrapMethod(StimBroadcasterComponent)
public final func TriggerSingleBroadcast(contextOwner: wref<GameObject>, gdStimType: gamedataStimType, opt radius: Float, opt investigateData: stimInvestigateData, opt propagationChange: Bool) -> Void {
  wrappedMethod(contextOwner, gdStimType, radius, investigateData, propagationChange);
  if XFIncidentTap.WantedStim(gdStimType) {
    XFIncidentTap.Stim(this.GetOwner(), contextOwner, gdStimType, radius, investigateData);
  }
}



@wrapMethod(AICombatTargetHelper)
public final static func SetNewCombatTarget(context: ScriptExecutionContext, target: ref<GameObject>) -> Bool {
  let result = wrappedMethod(context, target);
  if result && IsDefined(target) && XFIncidentTap.On() {
    XFIncidentTap.Combat(ScriptExecutionContext.GetOwner(context), target);
  }
  return result;
}

@wrapMethod(ReactionManagerComponent)
protected cb func OnReprimandUpdate(evt: ref<ReprimandUpdate>) -> Bool {
  let result = wrappedMethod(evt);
  if XFIncidentTap.On() {
    XFIncidentTap.Reprimand(this.GetOwner(), evt);
  }
  return result;
}

@wrapMethod(VehicleObject)
private final func StealVehicle(thief: wref<GameObject>) -> Void {
  wrappedMethod(thief);
  if XFIncidentTap.On() {
    XFIncidentTap.Theft(this, thief as GameObject);
  }
}

@wrapMethod(GameObject)
public final static func PlayVoiceOver(self: ref<GameObject>, voName: CName, debugInitialContext: CName, opt delay: Float, opt answeringEntityID: EntityID, opt canPlayInVehicle: Bool) -> DelayID {
  let id = wrappedMethod(self, voName, debugInitialContext, delay, answeringEntityID, canPlayInVehicle);
  if XFIncidentTap.WantedVoice(voName) && XFIncidentTap.On() {
    XFIncidentTap.Voice(self, voName);
  }
  return id;
}
