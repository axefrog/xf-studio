#pragma once
#include "core/InputChoices.hpp"
namespace xfb::plugin
{
input::Service& InputService();
void RegisterInputChoices(Dispatcher& aDispatcher);
void TickInputChoices(bool aScriptsReady);
void StopInputChoices(const std::string& aReason);
nlohmann::json TakeTestUi(const nlohmann::json& aDraw);
nlohmann::json ReportTestUi(const nlohmann::json& aReport);
nlohmann::json TestUiSaveRequest(const std::string& aSource);
}
