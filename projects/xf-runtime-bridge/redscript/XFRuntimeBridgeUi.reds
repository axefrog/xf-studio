// XF Runtime Bridge: the game's UI state for agents (bridge 0.7, ui.state; read-only).
//
// What is on screen that isn't the world: the game's phase, a menu or a popup, photo mode and whether the bridge hid its
// menu or the cursor, the HUD's interaction prompt and dialogue choices, and the player's gameplay tier. The plugin adds
// what only it knows: whether Cyber Engine Tweaks' overlay is open (the CET layer reports it through
// XFBridge_CetOverlay), the ink HUD panel's settings and the ImGui overlay host's state. Data only: blackboards and the
// bridge's own registry, never a method on a world object (the world-object rule, XFScene.Identity).
//
// Sources [source] 2.31: the UI_System blackboard (IsInMenu), UIGameData (Popup_IsShown, Popup_IsModal), UIInteractions
// (blackboardDefinitions.script:700-829).

module XFRuntimeBridge

public abstract class XFUi {
  public static func State(cid: String) -> String {
    let game = GetGameInstance();
    if !GameInstance.IsValid(game) {
      return XFJson.Fail("game_not_ready", "no game session yet");
    }
    let defs = GetAllBlackboardDefs();
    let boards = GameInstance.GetBlackboardSystem(game);
    let phase = XFBridgeActions.Phase();
    let photo = GameInstance.GetPhotoModeSystem(game).IsPhotoModeActive();
    let menuOpen = boards.Get(defs.UI_System).GetBool(defs.UI_System.IsInMenu);
    let gameData = boards.Get(defs.UIGameData);
    let popupShown = IsDefined(gameData) && gameData.GetBool(defs.UIGameData.Popup_IsShown);
    let popupModal = IsDefined(gameData) && gameData.GetBool(defs.UIGameData.Popup_IsModal);
    let out = "{\"ok\":true,\"phase\":" + XFJson.Str(phase) + ",\"menu_open\":" + XFJson.Flag(menuOpen) + ",\"popup\":{\"shown\":" + XFJson.Flag(popupShown) + ",\"modal\":" + XFJson.Flag(popupModal) + "}";
    out += ",\"character_menu\":" + XFJson.Flag(XFBridgeActions.CharacterMenuOpen()) + ",\"photo_mode\":" + XFJson.Flag(photo);
    let registry = XFBridgeRegistry.Get();
    if IsDefined(registry) {
      out += ",\"photo_ui_hidden\":" + XFJson.Flag(registry.IsPhotoUiHidden()) + ",\"cursor_hidden_by_bridge\":" + XFJson.Flag(registry.IsCursorHidden());
    }
    let player = GetPlayer(game);
    if IsDefined(player) {
      let high = XFPlayer.Psm(player, defs.PlayerStateMachine.HighLevel);
      out += ",\"tier\":" + XFJson.Str(XFPlayer.TierName(high));
    }
    out += ",\"hud_prompt\":" + XFScene.Prompt(game);
    let interactions = boards.Get(defs.UIInteractions);
    if IsDefined(interactions) {
      let dialog = FromVariant<DialogChoiceHubs>(interactions.GetVariant(defs.UIInteractions.DialogChoiceHubs));
      out += ",\"dialogue_hubs\":" + IntToString(ArraySize(dialog.choiceHubs));
    }
    XFBridgeLog.Debug(cid, "ui state");
    return out + "}";
  }
}
