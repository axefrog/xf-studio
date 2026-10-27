#include "core/overlay/Canvas.hpp"
#include "core/LayoutGuard.hpp"
#include "core/Dispatcher.hpp"
#include "core/Win32.hpp"
#include <algorithm>
#include <fstream>

namespace xfb::canvas
{
namespace
{
[[noreturn]] void Bad(const std::string& path) { throw Refusal({{"code", "bad_batch"}, {"path", path}}); }
[[noreturn]] void Cap(const char* name, size_t limit, size_t got) { throw Refusal({{"code", "canvas_cap"}, {"cap", name}, {"limit", limit}, {"got", got}}); }
void Fields(const json& o, const std::string& path, std::initializer_list<const char*> keys)
{
    if (!o.is_object()) Bad(path);
    for (const auto& [k, v] : o.items()) { (void)v; if (std::none_of(keys.begin(), keys.end(), [&](auto key) { return k == key; })) Bad(path + "." + k); }
}
bool Name(const std::string& s, size_t max, bool dot = false)
{ return !s.empty() && s.size() <= max && std::all_of(s.begin(), s.end(), [dot](char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || (dot && c == '.'); }); }
std::string String(const json& o, const char* key, const std::string& p)
{ if (!o.contains(key) || !o[key].is_string()) Bad(p + "." + key); return o[key].get<std::string>(); }
std::string ProducerName(const json& o, bool cet)
{
    auto name = String(o, "producer", "$");
    if (cet) { if (name.rfind("cet.", 0) != 0 || !Name(name.substr(4), 24)) Bad("$.producer"); }
    else if (!Name(name, 32)) Bad("$.producer"); return name;
}
void Pace(std::deque<double>& times, double now) { while (!times.empty() && times.front() <= now - 1) times.pop_front(); }
json RadarJson(const RadarView& v) { return {{"corner", v.corner}, {"orientation", v.orientation}, {"size_px", v.size}, {"range_m", v.range}, {"opacity", v.opacity}}; }
}
double Now() { return std::chrono::duration<double>(Clock::now().time_since_epoch()).count(); }
void Costs::Add(double ms) { samples[next++ % samples.size()] = ms; count = std::min(samples.size(), count + 1); last = ms; max = std::max(max, ms); }
json Costs::State() const
{
    auto sorted = samples; std::sort(sorted.begin(), sorted.begin() + count);
    return {{"last_ms", last}, {"max_ms", max}, {"p99_ms", count ? sorted[static_cast<size_t>(std::ceil(.99 * static_cast<double>(count))) - 1] : 0}, {"samples", count}};
}
json AtomicCosts::State(bool active) const
{
    Costs copy;const auto total=m_total.load(),count=std::min(total,m_samples.size());
    for(size_t i=0;i<count;++i)copy.Add(m_samples[i].load());
    auto out=copy.State();out["total"]=total;out["last_ms"]=active?m_last.load():0;out["max_ms"]=m_max.load();return out;
}
json PersistKeys(const std::filesystem::path& config, const std::filesystem::path& backups,
                 const std::pair<killkey::Chord,killkey::Chord>& keys)
{
    std::string before, why; bool missing = false;
    if (!win32::ReadFileExact(config,before,missing,why))
        return {{"saved",false},{"save_error",missing ? "config.ini is missing; the keys last only until the game closes" : "config.ini could not be read (" + why + "); it was left unchanged and the keys last only until the game closes"}};
    const auto text = killkey::WithSetting(killkey::WithSetting(before,"overlay","canvas_toggle",killkey::Spelling(keys.first)),"overlay","canvas_mode",killkey::Spelling(keys.second));
    win32::SettingsReplace replaced;
    const bool saved = win32::ReplaceSettingsFile(config,text,backups,3,replaced,why);
    json result = {{"saved",saved}}; if (!saved) result["save_error"] = why; return result;
}
void Service::Configure(bool enabled, killkey::Chord toggle, killkey::Chord mode, uint32_t anchorHz, uint32_t anchorsPerRead)
{
    std::scoped_lock lock(m_mutex); m_enabled.store(enabled); m_visible.store(false); m_toggle = std::move(toggle); m_mode = std::move(mode);
    m_anchorHz = std::clamp(anchorHz, 1u, 20u); m_anchorsPerRead = std::clamp(anchorsPerRead, 4u, 32u); Reset();
}
void Service::SetStateFile(std::filesystem::path path)
{
    std::ifstream file(path); if (file) {
        std::string raw(4097, '\0'); file.read(raw.data(), static_cast<std::streamsize>(raw.size())); raw.resize(static_cast<size_t>(file.gcount()));
        if (raw.size() <= 4096) { try { View(ParseJson(raw)); } catch (...) {} }
    }
    std::scoped_lock lock(m_mutex); m_stateFile = std::move(path);
}
void Service::Reset() { m_producers.clear(); m_anchors.clear(); m_refusals.clear(); m_refusalTimes.clear(); m_nextAnchorRead = -1; m_anchorRefresh = 1.0 / m_anchorHz; m_admission.fetch_add(1); m_generation.fetch_add(1); m_radarDowngraded.store(0); }
void Service::SetWorld(uint64_t world) { if (m_knownWorld.load() == world) return; std::scoped_lock lock(m_mutex); if (m_world != world) { m_world = world; m_knownWorld.store(world); Reset(); } }
void Service::Stop() { std::scoped_lock lock(m_mutex); m_visible.store(false); Reset(); VisibilityEvent(false); }
void Service::VisibilityEvent(bool resend)
{ if (m_events) m_events->Push("canvas.visible", "info", "canvas", "Canvas visibility", {{"visible", Visible()}, {"mode", m_worldMarkers ? "radar_world" : "radar"}, {"resend", resend}}); }
void Service::Toggle() { std::scoped_lock lock(m_mutex); if (!m_enabled.load()) return; m_visible.store(!m_visible.load()); Reset(); VisibilityEvent(Visible()); }
void Service::Mode() { std::scoped_lock lock(m_mutex); if (!m_enabled.load()) return; m_worldMarkers = !m_worldMarkers; m_generation.fetch_add(1); VisibilityEvent(false); }
void Service::Expire(double now)
{ for (auto& [p, producer] : m_producers) for (auto& [l, layer] : producer.layers) { (void)p; (void)l; if (layer.batch && layer.batch->expires <= now) layer.batch.reset(); } }
void Service::PruneRates(double now)
{
    const auto prune = [now](auto& histories) {
        for (auto it = histories.begin(); it != histories.end();) { Pace(it->second,now); if (it->second.empty()) it = histories.erase(it); else ++it; }
    };
    prune(m_layerRates); prune(m_producerRates);
}
json Service::Refuse(const std::string& p, const std::string& l, const json& reason, double now)
{
    const auto name = p.empty() ? std::string("unknown") : p;
    const auto key = std::make_pair(name,l);
    if (!m_refusals.count(key) && m_refusals.size() >= 1024) m_refusals.erase(m_refusals.begin());
    auto receipt = reason; receipt["time_s"] = now; m_refusals[key] = receipt;
    if (!m_refusalTimes.count(name) && m_refusalTimes.size() >= 1024) m_refusalTimes.erase(m_refusalTimes.begin());
    auto time = m_refusalTimes.find(name);
    if (m_events && (time == m_refusalTimes.end() || now >= time->second + 1)) {
        auto data = reason; data["producer"] = name; data["layer"] = l;
        m_events->Push("canvas.refused", "warn", "canvas", "Canvas batch refused", data); m_refusalTimes[name] = now;
    }
    auto it = m_producers.find(p);
    if (it != m_producers.end()) {
        const auto layer = it->second.layers.find(l);
        if (layer != it->second.layers.end()) { layer->second.refused = reason; layer->second.refused["time_s"] = now; }

    }
    return reason;
}
json Service::Feed(uint64_t connection, const std::string& raw, double now, bool cet)
{
    if (!Visible()) return {{"accepted", false}, {"dropped", "hidden"}};
    const double start = Now(); Batch batch; std::string producer, layer;
    const auto generation = m_admission.load();
    try { batch = Parse(raw, {}, cet); producer = batch.producer; layer = batch.layer; }
    catch (const Refusal& e) {
        json input; try { if (raw.size() <= 65536) { input = ParseJson(raw); producer = ProducerName(input, cet); if (input.contains("layer") && input["layer"].is_string()) layer = input["layer"].get<std::string>(); } } catch (...) {}
        std::scoped_lock lock(m_mutex); m_parse.Add((Now() - start) * 1000); Expire(now);
        auto reason = e.detail;
        // Expansion can stop early at its allocation cap. Live item totals still precede that vertex refusal.
        if (reason.value("cap","") == "vertices" && input.contains("items") && input["items"].is_array()) {
            size_t own = input["items"].size(), total = own;
            for (const auto& [pn,p] : m_producers) for (const auto& [ln,l] : p.layers) if (l.batch && !(pn == producer && ln == layer)) {
                total += l.batch->items.size(); if (pn == producer) own += l.batch->items.size();
            }
            if (own > 256) reason = {{"code","canvas_cap"},{"cap","items"},{"limit",256},{"got",own}};
            else if (total > 1024) reason = {{"code","canvas_cap"},{"cap","total_items"},{"limit",1024},{"got",total}};
        }
        Refuse(producer, layer, reason, now); throw Refusal(reason);
    }
    std::scoped_lock lock(m_mutex); m_parse.Add((Now() - start) * 1000);
    if (!Visible() || generation != m_admission.load()) return {{"accepted", false}, {"dropped", "hidden"}};
    Expire(now); PruneRates(now);
    try {
        if (batch.world != m_world) throw Refusal({{"code", "stale_world"}, {"world", m_world}});
        auto owner = m_producers.find(producer);
        if (owner != m_producers.end() && owner->second.connection != connection) throw Refusal({{"code", "producer_in_use"}});
        size_t totalItems = batch.items.size(), totalVertices = batch.vertices, ownItems = batch.items.size(), ownVertices = batch.vertices, metadata = m_layerRates.size();
        for (const auto& [pn, p] : m_producers) {
            for (const auto& [ln,l] : p.layers) { (void)l; if (!m_layerRates.count({pn,ln})) ++metadata; }
            for (const auto& [ln, l] : p.layers) if (l.batch && !(pn == producer && ln == layer)) {
                totalItems += l.batch->items.size(); totalVertices += l.batch->vertices;
                if (pn == producer) { ownItems += l.batch->items.size(); ownVertices += l.batch->vertices; }
            }
        }
        const bool exists = owner != m_producers.end() && owner->second.layers.count(layer);
        if (ownItems > 256) Cap("items", 256, ownItems); if (totalItems > 1024) Cap("total_items", 1024, totalItems);
        if (ownVertices > 4096) Cap("vertices", 4096, ownVertices); if (totalVertices > 16384) Cap("total_vertices", 16384, totalVertices);
        if (!exists && owner != m_producers.end() && owner->second.layers.size() >= 16) Cap("layers", 16, owner->second.layers.size() + 1);
        const auto rateKey = std::make_pair(producer,layer);
        if (!exists && !m_layerRates.count(rateKey) && metadata >= 1024) Cap("metadata", 1024, metadata + 1);
        if (exists) {
            auto& previous = owner->second.layers.at(layer);
            if (previous.hasSeq && batch.seq <= previous.seq) throw Refusal({{"code", "stale_seq"}, {"seq", previous.seq}});
        }
        const auto layerRate = m_layerRates.find(rateKey);
        const auto producerRate = m_producerRates.find(producer);
        if (layerRate != m_layerRates.end() && layerRate->second.size() >= 4) throw Refusal({{"code", "rate"}, {"retry_after_ms", static_cast<int>(std::ceil((layerRate->second.front() + 1 - now) * 1000))}});
        if (producerRate != m_producerRates.end() && producerRate->second.size() >= 16) throw Refusal({{"code", "rate"}, {"retry_after_ms", static_cast<int>(std::ceil((producerRate->second.front() + 1 - now) * 1000))}});
        auto& p = m_producers[producer]; p.connection = connection; auto& l = p.layers[layer];
        l.seq = batch.seq; l.hasSeq = true; m_layerRates[rateKey].push_back(now); m_producerRates[producer].push_back(now); batch.expires = now + batch.ttl;
        auto immutable = std::make_shared<const Batch>(std::move(batch)); l.batch = immutable;
        if (m_events) m_events->Push("canvas.fed", "info", "canvas", "Canvas snapshot accepted", {{"producer", producer}, {"layer", layer}, {"world", immutable->world}, {"seq", immutable->seq}, {"items", immutable->items.size()}, {"digest", immutable->digest}});
        return {{"accepted", true}, {"items", immutable->items.size()}, {"vertices", immutable->vertices}, {"digest", immutable->digest}};
    } catch (const Refusal& e) { Refuse(producer, layer, e.detail, now); throw; }
}
json Service::Clear(uint64_t connection, const json& v, double now, bool cet)
{
    Fields(v, "$", {"producer", "layer"}); const auto producer = ProducerName(v, cet); std::string layer;
    if (v.contains("layer")) { layer = String(v, "layer", "$"); if (!Name(layer, 48, true)) Bad("$.layer"); }
    std::scoped_lock lock(m_mutex); Expire(now); auto it = m_producers.find(producer); if (it == m_producers.end()) return {{"cleared", 0}};
    if (it->second.connection != connection) throw Refusal(Refuse(producer, layer, {{"code", "producer_in_use"}}, now));
    const auto count = layer.empty() ? it->second.layers.size() : it->second.layers.count(layer);
    if (layer.empty()) m_producers.erase(it); else { it->second.layers.erase(layer); if (it->second.layers.empty()) m_producers.erase(it); }
    m_generation.fetch_add(1); return {{"cleared", count}};
}
void Service::Disconnect(uint64_t connection)
{
    std::scoped_lock lock(m_mutex); bool changed = false;
    for (auto it = m_producers.begin(); it != m_producers.end();) if (it->second.connection == connection) { it = m_producers.erase(it); changed = true; } else ++it;
    if (changed) m_generation.fetch_add(1);
}
json Service::View(const json& v)
{
    std::scoped_lock persist(m_viewMutex);
    Fields(v, "$", {"radar"}); if (!v.contains("radar")) Bad("$.radar"); const auto& r = v["radar"];
    Fields(r, "$.radar", {"corner", "size_px", "range_m", "orientation", "opacity"}); std::filesystem::path path; json out;
    { std::scoped_lock lock(m_mutex); auto next = m_radar;
        auto choice = [&](const char* k, std::string& target, std::initializer_list<const char*> list) {
            if (!r.contains(k)) return; auto s = String(r, k, "$.radar"); if (std::none_of(list.begin(), list.end(), [&](auto x) { return s == x; })) Bad(std::string("$.radar.") + k); target = s;
        };
        choice("corner", next.corner, {"top_left", "top_right", "bottom_left", "bottom_right"}); choice("orientation", next.orientation, {"heading_up", "north_up"});
        auto number = [&](const char* k, double& target, double lo, double hi) { if (!r.contains(k)) return;
            if (!r[k].is_number() || !std::isfinite(r[k].get<double>()) || r[k].get<double>() < lo || r[k].get<double>() > hi) Bad(std::string("$.radar.") + k); target = r[k].get<double>(); };
        number("size_px", next.size, 120, 640); number("range_m", next.range, 1, 2000); number("opacity", next.opacity, 0, 1);
        m_radar = next; path = m_stateFile; out = {{"radar", RadarJson(next)}}; m_generation.fetch_add(1);
    }
    if (!path.empty()) { std::string why; if (!win32::WriteFileAtomic(path, out.dump(), why)) { out["saved"] = false; out["save_error"] = why; } else out["saved"] = true; } return out;
}
std::pair<killkey::Chord, killkey::Chord> Service::Keys() const { std::scoped_lock lock(m_mutex); return {m_toggle, m_mode}; }
json Service::SetKeys(const json& v)
{
    Fields(v, "$", {"toggle", "mode"}); std::scoped_lock lock(m_mutex); auto toggle = m_toggle, mode = m_mode;
    auto parse = [&](const char* name, killkey::Chord& chord) { if (!v.contains(name)) return;
        std::string why; auto s = String(v, name, "$"); if (s.size() > 32 || !killkey::Parse(s, chord, why) || (chord.enabled && (chord.ctrl || chord.shift || chord.alt))) Bad(std::string("$.") + name); };
    parse("toggle", toggle); parse("mode", mode); if (toggle.enabled && mode.enabled && toggle.vk == mode.vk) Bad("$.mode"); m_toggle = toggle; m_mode = mode;
    return {{"toggle", killkey::Spelling(toggle)}, {"mode", killkey::Spelling(mode)}};
}
std::vector<std::string> Service::Wanted(double now)
{
    if (!Visible()) return {}; std::unique_lock lock(m_mutex, std::try_to_lock); if (!lock.owns_lock() || !Visible()) return {}; Expire(now);
    if (now + 1e-9 < m_nextAnchorRead) return {};
    m_nextAnchorRead = now + 1.0 / m_anchorHz; // pace planning too, including an empty wanted set
    std::vector<std::vector<std::string>> groups; std::set<std::string> live;
    for (const auto& [name, p] : m_producers) { (void)name; std::set<std::string> ids;
        for (const auto& [ln, l] : p.layers) { (void)ln; if (l.batch) for (const auto& item : l.batch->items) if (item.anchor.kind == Anchor::Entity) ids.insert(item.anchor.entity); }
        groups.emplace_back(ids.begin(), ids.end()); live.insert(ids.begin(), ids.end());
    }
    for (auto it = m_anchors.begin(); it != m_anchors.end();) if (!live.count(it->first)) it = m_anchors.erase(it); else ++it;
    std::vector<std::string> order; std::set<std::string> emitted;
    for (size_t row = 0; row < 1024; ++row) { bool any = false; for (const auto& g : groups) if (row < g.size()) { any = true; if (emitted.insert(g[row]).second) order.push_back(g[row]); } if (!any) break; }
    if (order.empty()) { m_anchorRefresh = 0; return {}; }
    // Oldest attempted first, producer-interleaved ties. Churning/new anchors also get a turn.
    std::stable_sort(order.begin(), order.end(), [&](const auto& a, const auto& b) {
        auto ia = m_anchors.find(a), ib = m_anchors.find(b);
        return (ia == m_anchors.end() ? -1 : ia->second.attempted) < (ib == m_anchors.end() ? -1 : ib->second.attempted);
    });
    m_anchorRefresh = static_cast<double>((order.size() + m_anchorsPerRead - 1) / m_anchorsPerRead) / m_anchorHz;
    for (const auto& id : live) m_anchors[id].expectedRefresh = m_anchorRefresh;
    if (order.size() > m_anchorsPerRead) order.resize(m_anchorsPerRead);
    for (const auto& id : order) m_anchors[id].attempted = now; return order;
}
AnchorState AnchorAt(AnchorState a, double now)
{
    const double stale = now - (a.last + a.expectedRefresh + .25);
    if (a.last < 0 || stale > 1 + 1e-9) { a.state = AnchorState::Lost; a.opacity = 0; }
    else if (stale > 1e-9) { a.state = AnchorState::Holding; a.opacity = 1 - .6 * std::clamp(stale, 0.0, 1.0); }
    else { a.state = AnchorState::Resolved; a.opacity = 1; }
    return a;
}
void Service::Resolve(const std::vector<EntityPosition>& positions, double now, double anchorMs, std::optional<uint64_t> expected)
{
    struct Measure { AtomicCosts& costs;double start,prior;~Measure(){costs.Add(prior+(Now()-start)*1000);} } measure{m_anchor,Now(),anchorMs};
    const auto read = m_anchorReadCount.load(); m_anchorReadTimes[read % m_anchorReadTimes.size()].store(now); m_anchorReadCount.store(read + 1);
    if (!Visible()) return; std::unique_lock lock(m_mutex, std::try_to_lock); if (!lock.owns_lock() || !Visible()) return;
    if (expected && *expected != m_generation.load()) return;
    for (const auto& pos : positions) { auto it = m_anchors.find(pos.id); if (it == m_anchors.end()) continue; auto& a = it->second;
        if (pos.position) { a.position = *pos.position; a.last = now; }
        a = AnchorAt(a, now); // a failed lookup cannot extend the last successful position's freshness
    }
}
void Service::Publish(const Camera& camera, double now, double cameraMs, std::optional<uint64_t> expected)
{
    m_camera.Add(cameraMs);
    struct Measure { AtomicCosts& costs;double start;~Measure(){costs.Add((Now()-start)*1000);} } measure{m_publication,Now()};
    if (!Visible()) return; std::unique_lock lock(m_mutex, std::try_to_lock); if (!lock.owns_lock() || !Visible()) return;
    if (expected && *expected != m_generation.load()) return;
    Expire(now);
    for (auto& [id, a] : m_anchors) { (void)id; a = AnchorAt(a, now); }
    auto& frame = m_frames.Back(); frame.camera = camera; frame.radar = m_radar; frame.anchors = m_anchors; frame.layers.clear();
    frame.generation = m_generation.load(); frame.at = now; frame.visible = true; frame.worldMarkers = m_worldMarkers;
    for (const auto& [pn, p] : m_producers) for (const auto& [ln, l] : p.layers) { (void)pn; (void)ln; if (l.batch) frame.layers.push_back({l.batch}); } m_frames.Publish();
}
json Service::State(double now)
{
    std::scoped_lock lock(m_mutex); Expire(now); json producers = json::array(); size_t unknown = 0;
    for (const auto& [name, p] : m_producers) { json layers = json::array(); for (const auto& [name2, l] : p.layers) {
        layers.push_back({{"layer", name2}, {"items", l.batch ? l.batch->items.size() : 0}, {"vertices", l.batch ? l.batch->vertices : 0}, {"seq", l.hasSeq ? json(l.seq) : json(nullptr)}, {"last_refusal", l.refused}});
        if (l.batch) for (const auto& i : l.batch->items) if (i.kind == "icon" && !KnownGlyph(i.glyph)) ++unknown;
    } producers.push_back({{"producer", name}, {"layers", layers}}); }
    json anchors = {{"resolved", 0}, {"holding", 0}, {"lost", 0}};
    for (const auto& [id, a] : m_anchors) { (void)id; const auto state = AnchorAt(a, now).state;
        const char* key = state == AnchorState::Resolved ? "resolved" : state == AnchorState::Holding ? "holding" : "lost"; anchors[key] = anchors[key].get<size_t>() + 1; }
    json refusals = json::array(); for (const auto& [key, value] : m_refusals) refusals.push_back({{"producer",key.first},{"layer",key.second},{"refusal",value}});
    size_t recentReads = 0; const auto reads = m_anchorReadCount.load();
    for (size_t n = 0; n < std::min(reads,m_anchorReadTimes.size()); ++n) { const auto at = m_anchorReadTimes[n].load(); if (at > now - 1 && at <= now) ++recentReads; }
    return {{"schemas", {"canvas@1"}}, {"features", json::array()}, {"enabled", m_enabled.load()}, {"visible", Visible()}, {"mode", m_worldMarkers ? "radar_world" : "radar"}, {"world", m_world}, {"radar", RadarJson(m_radar)},
        {"keys", {{"toggle", killkey::Spelling(m_toggle)}, {"mode", killkey::Spelling(m_mode)}}}, {"producers", producers}, {"last_refusals",refusals}, {"anchors", anchors}, {"unknown_glyphs", unknown}, {"radar_dash_downgraded", m_radarDowngraded.load()},
        {"anchor_reads", {{"configured_hz",m_anchorHz},{"per_read",m_anchorsPerRead},{"observed_hz",Visible()?recentReads:0},{"total",reads},{"expected_refresh_s",m_anchorRefresh},{"grace_s",.25}}},
        {"costs", {{"pipe", m_parse.State()}, {"camera", m_camera.State(Visible())}, {"anchors",m_anchor.State(Visible())}, {"publication",m_publication.State(Visible())}, {"render",m_render.State(Visible())}, {"hidden", {{"camera_ms", 0}, {"anchor_ms",0}, {"render_ms", 0}}}}}};
}
void RegisterMethods(Dispatcher& d, Service& service)
{
    const auto wrap = [](auto fn) { return [fn](const MethodContext& ctx) -> json { try { return fn(ctx); } catch (const Refusal& e) { MethodError error(e.detail.value("code", "bad_batch"), e.what()); error.detail = e.detail; throw error; } }; };
    d.Register({"canvas.feed", Access::Display, RunOn::BridgeThread, "Replace one canvas layer atomically.", wrap([&](const MethodContext& c) { return service.Feed(c.connection, c.rawParams.empty() ? c.params.dump() : c.rawParams); })});
    d.Register({"canvas.clear", Access::Display, RunOn::BridgeThread, "Withdraw the caller's own canvas layers.", wrap([&](const MethodContext& c) { return service.Clear(c.connection, c.params); })});
    d.Register({"canvas.view", Access::Display, RunOn::BridgeThread, "Configure and remember the canvas radar.", wrap([&](const MethodContext& c) { return service.View(c.params); })});
    d.Register({"canvas.state", Access::Read, RunOn::BridgeThread, "Canvas layers, refusals, anchors and measured costs.", wrap([&](const MethodContext& c) { Fields(c.params, "$", {}); return service.State(); })});
}
} // namespace xfb::canvas
