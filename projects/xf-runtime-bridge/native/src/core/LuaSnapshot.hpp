#pragma once
#include "core/Dispatcher.hpp"
namespace xfb::snapshot
{
using json=nlohmann::json;
struct Lifecycle { uint64_t world=0; bool killed=false, handover=false; };
struct Inputs { json recorder=json::object(), incidents=json::array(), holds=json::array(); };
// Pure bookkeeping: Tick is called only by the bridge background worker. Read never calls the provider.
class Cache
{
public:
    using Provider=std::function<Inputs()>;
    json Read(Lifecycle life, double now);
    bool Tick(Lifecycle life, double now, const Provider&);
    size_t Builds() const;
private:
    void ClearLocked(Lifecycle,double);
    void CheckLifeLocked(Lifecycle,double);
    mutable std::mutex m_mutex;
    json m_value;
    double m_lastRead=-1, m_nextBuild=-1;
    uint64_t m_epoch=0, m_world=0;
    size_t m_builds=0;
    bool m_killed=false, m_known=false, m_handover=false;
    double m_actorCutoff=-1;
};
void Register(Dispatcher&,Cache&,std::function<Lifecycle()>);
}
