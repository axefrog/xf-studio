#pragma once

// The self-test host's simulated world for bridge 0.6's methods (scene.read, the handover, behaviours, player control,
// input.probe): the same names, access classes, parameter checks (core/Scene, core/Player, core/Behaviours) and runner as
// the plugin, with a simulated camera, player, NPCs, navmesh and HUD instead of the game. Proves nothing about the game.

#include <functional>
#include <memory>
#include <string>

#include <nlohmann/json.hpp>

#include "core/Behaviours.hpp"
#include "core/Config.hpp"
#include "core/Dispatcher.hpp"
#include "core/Events.hpp"
#include "core/GameThreadQueue.hpp"
#include "core/Player.hpp"

namespace xfb::selftest
{
using json = nlohmann::json;

// What the 0.6 simulation needs from the rest of the simulated game (selftest/Main.cpp's sim).
struct SimHooks
{
    std::function<std::string()> phase;
    // {pieces: [{index, label, appearance, position, yaw, base_yaw}], rigs: [...]}
    std::function<json()> showroom;
    // Moves one piece ("pieces") or rig ("lights"); throws MethodError when there is none.
    std::function<void(const std::string& aKind, int32_t aIndex, double aX, double aY, double aZ, double aYaw)> moveShowroom;
    // photo.subject's reading (V's face in photo mode, offset up/forward/right); throws outside photo mode.
    std::function<json(double aUp, double aForward, double aRight)> subject;
    // A photo-mode attribute set as photo.camera.set sets it; answers the value taken.
    std::function<float(int32_t aKey, float aValue)> setAttribute;
    // Photo mode's light entities: {"1": [x, y, z], ...} for the lights that exist.
    std::function<json()> photoLights;
    std::function<bool()> scriptsReady;
    std::function<void()> markWrite;
    std::function<void()> takeSaveLock;
    // 0.8.2: bridge.handover's clearing of the showroom's rigs ("lights"), as the plugin's ClearShowroomForHandover.
    std::function<json(const std::string& aWhat)> clearShowroom;
};

class Sim060
{
public:
    Sim060(Dispatcher& aDispatcher, GameThreadQueue& aQueue, const Config& aConfig, SimHooks aHooks);
    ~Sim060();
    void Register();
    // The simulated engine tick: the look-at turning the camera, then the behaviours.
    void Tick(double aDt);
    // A detach (a load): behaviours dropped, V's effects gone with the session.
    void OnDetach();
    // The kill switch's restore: behaviours stopped (their stop steps run on the next tick), V's effects lifted.
    void RestoreAfterKill(json& aOut);
    // What the bridge holds on V (game.save's refusal, RB-83): its status effects and "behaviours running".
    json Holds();
    EventLog& Events();
    // 0.8: V now, {position, yaw, busy}, for the simulated NPC street (selftest/SimNpc.cpp).
    json PlayerNow();
    // 0.8: whether V has a weapon out (player.action weapon.* in the simulation), for 0.7's arms_drawn.
    bool WeaponDrawn();

private:
    struct State;
    Dispatcher& m_dispatcher;
    GameThreadQueue& m_queue;
    const Config& m_config;
    SimHooks m_hooks;
    std::unique_ptr<State> m_state;
    EventLog m_events;
    behave::Runner m_behaviours;
    behave::Ops m_ops;
    player::StopCount m_playerStops; // 0.8.2, as the plugin's State::playerStops
};
} // namespace xfb::selftest
