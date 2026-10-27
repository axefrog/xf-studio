#include "core/LuaSnapshot.hpp"
#include "core/Recording.hpp"
#include <algorithm>
#include <cmath>
namespace xfb::snapshot
{
namespace {
json Empty(uint64_t world,double now)
{
    return {{"schema","snapshot@1"},{"world",world},{"built_s",now},{"age_s",0},{"game_time_s",nullptr},{"v",nullptr},
        {"actors",json::array()},{"incidents",json::array()},{"holds",json::array()},
        {"recorder",{{"active",false},{"run",nullptr},{"channels",json::array()},{"gaps",json::array()}}},
        {"sources",{{"v","recorder_stopped"},{"actors","recorder_stopped"},{"incidents","native"},{"holds","native"},{"plan","unavailable"}}},
        {"limits",{{"bytes",16384},{"actors",16},{"incidents",16},{"participants",8},{"holds",5},{"gaps",8},{"rebuild_hz",4},{"reader_lease_s",2},{"stale_s",.5},{"lost_s",2},{"identity_bytes",recording::kPayload}}},
        {"truncated",{{"actors",0},{"incidents",0},{"participants",0},{"holds",0},{"gaps",0}}}};
}
json Text(const json& value,size_t cap=128)
{
    if(!value.is_string()||value.get_ref<const std::string&>().size()>cap)return nullptr;
    return value; // identifiers are exact; a prefix would identify a different record/entity
}
json Field(const json& value,const char* key) { return value.is_object()?value.value(key,json()):json(); }
json Position(const json& value)
{
    if(!value.is_array()||value.size()!=3)return nullptr;
    for(const auto& n:value)if(!n.is_number()||!std::isfinite(n.get<double>()))return nullptr;
    return value;
}
json Number(const json& value) { return value.is_number()&&std::isfinite(value.get<double>())?value:json(nullptr); }
void Age(json& actor,double delta,bool handover)
{
    actor["age_s"]=actor["age_s"].get<double>()+delta;
    if(handover||actor["id"].is_null()||actor["pos"].is_null()||actor["state"]=="lost"||actor["age_s"].get<double>()>2)actor["state"]="lost";
    else actor["state"]=actor["age_s"].get<double>()>.5?"stale":"resolved";
}
json Build(const Inputs& in,Lifecycle life,double now)
{
    auto out=Empty(life.world,now);const auto& rec=in.recorder;
    const bool same=rec.value("world",uint64_t{0})==life.world;
    const bool active=same&&rec.value("active",false);
    out["recorder"]["active"]=active;out["recorder"]["run"]=Field(rec,"run");
    if(Field(rec,"channels").is_array())for(const auto& channel:rec["channels"])if(out["recorder"]["channels"].size()<10)out["recorder"]["channels"].push_back(Text(channel,16));
    out["sources"]["v"]=active?"recorder":"recorder_stopped";out["sources"]["actors"]=life.handover?"handover":active?"recorder":"recorder_stopped";
    auto makeActor=[&](const json& raw,double at,bool npc=true){
        json actor={{"id",Text(Field(raw,"entity"),32)},{"pos",Position(Field(raw,"position"))},{"yaw",Number(Field(raw,"yaw"))},
          {"identity",nullptr},{"plan",nullptr},{"state",raw.value("valid",true)?"resolved":"lost"},{"age_s",std::max(0.0,now-at)}};
        const auto identity=Field(raw,"identity");
        if(identity.is_object()&&Text(Field(identity,"record"),recording::kPayload).is_string())actor["identity"]={{"record",Text(Field(identity,"record"),recording::kPayload)},{"affiliation",Text(Field(identity,"affiliation"),recording::kPayload)},{"crowd",Field(identity,"crowd").is_boolean()?identity["crowd"]:json(nullptr)}};
        Age(actor,0,life.handover&&npc);return actor;
    };
    if(active){
        const auto v=Field(rec,"v");
        if(v.is_object()){
            auto actor=makeActor(v,rec.value("v_s",now),false);
            actor.erase("identity");actor.erase("plan");actor["in_vehicle"]=Field(v,"vehicle").is_object()?Field(v["vehicle"],"mounted"):json(nullptr);
            actor["in_combat"]=Field(v,"vitals").is_object()?Field(v["vitals"],"in_combat"):json(nullptr);out["v"]=std::move(actor);
            out["game_time_s"]=Number(Field(v,"game_time_s"));
        }
        if(Field(rec,"actors").is_array())for(const auto& actor:rec["actors"]){
            if(out["actors"].size()>=16){out["truncated"]["actors"]=out["truncated"]["actors"].get<size_t>()+1;continue;}
            out["actors"].push_back(makeActor(actor,rec.value("actors_s",now)));
        }
    }
    if(same&&Field(rec,"gaps").is_array())for(const auto& gap:rec["gaps"]){
        if(out["recorder"]["gaps"].size()>=8){out["truncated"]["gaps"]=out["truncated"]["gaps"].get<size_t>()+1;continue;}
        out["recorder"]["gaps"].push_back({{"channel",Text(Field(gap,"channel"),16)},{"from_s",Number(Field(gap,"from_s"))},{"to_s",Number(Field(gap,"to_s"))},{"reason",Text(Field(gap,"reason"),48)}});
    }
    if(!life.handover)for(const auto& incident:in.incidents){
        if(out["incidents"].size()>=16){out["truncated"]["incidents"]=out["truncated"]["incidents"].get<size_t>()+1;continue;}
        json row={{"id",Text(Field(incident,"id"),64)},{"kind",Text(Field(incident,"kind"),64)},{"pos",Position(Field(incident,"pos"))},
          {"participants",json::array()},{"opened_s",Number(Field(incident,"opened_s"))},{"closed_s",Number(Field(incident,"closed_s"))},{"perceived",incident.value("perceived",false)}};
        if(Field(incident,"participants").is_array())for(const auto& id:incident["participants"]){if(row["participants"].size()<8)row["participants"].push_back(Text(id,32));else out["truncated"]["participants"]=out["truncated"]["participants"].get<size_t>()+1;}
        out["incidents"].push_back(std::move(row));
    }
    if(!life.handover)for(const auto& hold:in.holds){
        if(out["holds"].size()>=5){out["truncated"]["holds"]=out["truncated"]["holds"].get<size_t>()+1;continue;}
        out["holds"].push_back({{"id",Text(Field(hold,"id"),32)},{"kind",Text(Field(hold,"kind"),32)},{"radius_m",Number(Field(hold,"radius_m"))},{"pos",Position(Field(hold,"pos"))}});
    }
    // Preserve V and highest-priority actors before incidents, then holds, then gap detail.
    while(out.dump().size()>15360){
        bool removed=false;
        for(const auto* name:{"incidents","holds","actors","gaps"}){
            auto& list=std::string(name)=="gaps"?out["recorder"]["gaps"]:out[name];
            if(!list.empty()){list.erase(list.size()-1);out["truncated"][name]=out["truncated"][name].get<size_t>()+1;removed=true;break;}
        }
        if(!removed)break;
    }
    return out;
}
}
void Cache::ClearLocked(Lifecycle life,double now)
{
    m_value=Empty(life.world,now);m_value["cleared"]=life.killed?"killed":"load";
    m_world=life.world;m_killed=life.killed;m_known=true;++m_epoch;m_nextBuild=-1; m_handover=life.handover;m_actorCutoff=life.handover?now:-1;
}
void Cache::CheckLifeLocked(Lifecycle life,double now)
{
    if(!m_known||life.world!=m_world||life.killed!=m_killed)ClearLocked(life,now);
    if(life.handover&&!m_handover){m_actorCutoff=now;++m_epoch;}
    m_handover=life.handover;
}
json Cache::Read(Lifecycle life,double now)
{
    std::scoped_lock lock(m_mutex);m_lastRead=now;
    CheckLifeLocked(life,now);
    auto value=m_value;const double age=std::max(0.0,now-value["built_s"].get<double>());value["age_s"]=age;
    for(auto& actor:value["actors"]){const auto sampled=value["built_s"].get<double>()-actor["age_s"].get<double>();Age(actor,age,life.handover||sampled<=m_actorCutoff);}
    if(value["v"].is_object())Age(value["v"],age,false);
    auto& incidents=value["incidents"];
    for(auto it=incidents.begin();it!=incidents.end();)if((*it)["closed_s"].is_number()&&now-(*it)["closed_s"].get<double>()>60)it=incidents.erase(it);else ++it;
    if(life.handover){value["holds"]=json::array();value["incidents"]=json::array();value["sources"]["actors"]="handover";}
    return value;
}
bool Cache::Tick(Lifecycle life,double now,const Provider& provider)
{
    uint64_t epoch;
    {std::scoped_lock lock(m_mutex);
     CheckLifeLocked(life,now);
     if(life.killed||m_lastRead<0||now+1e-9>=m_lastRead+2||now+1e-9<m_nextBuild)return false;
     m_nextBuild=now+.25;epoch=m_epoch;}
    auto input=provider();if(!input.recorder.value("available",true)||!input.incidents.is_array()||!input.holds.is_array())return false;
    auto value=Build(input,life,now);
    std::scoped_lock lock(m_mutex);if(epoch!=m_epoch)return false;
    if(m_value.contains("cleared")&&value["v"].is_null()&&value["actors"].empty()&&value["incidents"].empty()&&value["holds"].empty())value["cleared"]="load";
    for(auto& actor:value["actors"])if(now-actor["age_s"].get<double>()<=m_actorCutoff)actor["state"]="lost";
    m_value=std::move(value);++m_builds;return true;
}
size_t Cache::Builds() const {std::scoped_lock lock(m_mutex);return m_builds;}
void Register(Dispatcher& d,Cache& cache,std::function<Lifecycle()> life)
{
    d.Register({"canvas.snapshot",Access::Read,RunOn::BridgeThread,"Copy the cached snapshot@1 without a game call or recorder lease.",[&cache,life](const MethodContext& c){
        if(!c.params.empty())throw MethodError("bad_params","canvas.snapshot accepts no fields");return cache.Read(life(),recording::Now());}});
}
}
