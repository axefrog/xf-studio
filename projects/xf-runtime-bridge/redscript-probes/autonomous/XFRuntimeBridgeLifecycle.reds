module XFRuntimeBridge

// UI callbacks own these contexts even while gameplay's load-detach gate is closed.
// No GetGameInstance, forged readiness event or Start/UI_Skip invocation.
@wrapMethod(MenuScenario_PreGameSubMenu)
protected cb func OnSwitchToEngagementScreen() -> Bool {
  let result = wrappedMethod();
  if (XFBridge_ProbeFlags() & 8) != 0 {
    let menus = this.GetMenusState();
    if IsDefined(menus) { XFBridge_LifecycleMenu(menus.GetMenu(n"engagement_screen")); }
  }
  return result;
}

@wrapMethod(MenuScenario_PreGameSubMenu)
protected cb func OnHandleEngagementScreen(evt: ref<ShowEngagementScreen>) -> Bool {
  let result = wrappedMethod(evt);
  if (XFBridge_ProbeFlags() & 8) != 0 && !evt.show { XFBridge_LifecycleMenu(null); }
  return result;
}

@wrapMethod(MenuScenario_SingleplayerMenu)
protected cb func OnEnterScenario(prevScenario: CName, userData: ref<IScriptable>) -> Bool {
  // Seed the negative scope even on -skipStartScreen; a missed entry remains unknown.
  if (XFBridge_ProbeFlags() & 8) != 0 { XFBridge_LifecycleMenu(null); }
  return wrappedMethod(prevScenario, userData);
}
