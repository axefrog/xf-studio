#pragma once
#include <RED4ext/RED4ext.hpp>
#include <RED4ext/Api/v1/Sdk.hpp>
#include "core/Dispatcher.hpp"
#include <RED4ext/Scripting/Natives/inkWidget.hpp>
namespace xfb::plugin
{
void InstallLifecycle(RED4ext::v1::PluginHandle, const RED4ext::v1::Sdk*);
void StopLifecycle();
void InvalidateLifecycle();
void ObserveEngagementMenu(const RED4ext::Handle<RED4ext::ink::Widget>&);
nlohmann::json LifecycleStatus();
void RegisterLifecycle(Dispatcher&);
}
