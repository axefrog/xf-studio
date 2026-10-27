#include "core/overlay/Canvas.hpp"
#include "core/LayoutGuard.hpp"
#include "core/Dispatcher.hpp"
#include "core/Win32.hpp"
#include <Windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <charconv>
#include <cmath>
#include <numeric>

namespace xfb::canvas
{
namespace
{
constexpr size_t kVertices = 4096;
constexpr double pi = 3.14159265358979323846;
[[noreturn]] void Bad(const std::string& p) { throw Refusal({{"code", "bad_batch"}, {"path", p}}); }
[[noreturn]] void Cap(const char* name, size_t limit, size_t got) { throw Refusal({{"code", "canvas_cap"}, {"cap", name}, {"limit", limit}, {"got", got}}); }
void Fields(const json& o, const std::string& p, std::initializer_list<const char*> keys)
{
    if (!o.is_object()) Bad(p);
    for (const auto& [key, v] : o.items()) { (void)v; if (std::none_of(keys.begin(), keys.end(), [&](auto k) { return key == k; })) Bad(p + "." + key); }
}
const json& Required(const json& o, const char* key, const std::string& p)
{ const auto it = o.find(key); if (it == o.end()) Bad(p + "." + key); return *it; }
double Number(const json& v, const std::string& p, double lo, double hi)
{ if (!v.is_number()) Bad(p); const double n = v.get<double>(); if (!std::isfinite(n) || n < lo || n > hi) Bad(p); return n; }
double Num(const json& o, const char* key, const std::string& p, double def, double lo, double hi)
{ return o.contains(key) ? Number(o.at(key), p + "." + key, lo, hi) : def; }
uint64_t Integer(const json& v, const std::string& p, double lo = 0, double hi = 9007199254740991.0)
{ const auto n = Number(v, p, lo, hi); if (std::floor(n) != n) Bad(p); return static_cast<uint64_t>(n); }
bool Flag(const json& o, const char* k, const std::string& p, bool def = false)
{ if (!o.contains(k)) return def; if (!o.at(k).is_boolean()) Bad(p + "." + k); return o.at(k).get<bool>(); }
std::string Text(const json& v, const std::string& p, size_t max, bool nonempty = true)
{
    if (!v.is_string()) Bad(p); auto s = v.get<std::string>(); size_t glyphs = 0;
    for (unsigned char c : s) if ((c & 0xc0) != 0x80) ++glyphs;
    if (glyphs > max || (nonempty && s.empty())) Bad(p); return s;
}
std::string Choice(const json& o, const char* k, const std::string& p, const char* def, std::initializer_list<const char*> choices)
{
    const auto s = o.contains(k) ? Text(o.at(k), p + "." + k, 40) : std::string(def);
    if (std::none_of(choices.begin(), choices.end(), [&](auto c) { return s == c; })) Bad(p + "." + k); return s;
}
bool Name(const std::string& s, size_t max, bool dot)
{ return !s.empty() && s.size() <= max && std::all_of(s.begin(), s.end(), [dot](unsigned char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || (dot && c == '.'); }); }
Vec Vector(const json& v, const std::string& p, size_t n = 3, double lo = -1e7, double hi = 1e7)
{
    if (!v.is_array() || v.size() != n) Bad(p); Vec out{};
    for (size_t i = 0; i < n; ++i) out[i] = Number(v[i], p + "[" + std::to_string(i) + "]", lo, hi); return out;
}
unsigned Views(const json& v, const std::string& p)
{
    if (!v.is_array() || v.empty() || v.size() > 2) Bad(p); unsigned mask = 0;
    for (const auto& x : v) { auto s = Text(x, p, 5); unsigned bit = s == "world" ? World : s == "radar" ? Radar : 0; if (!bit || (mask & bit)) Bad(p); mask |= bit; } return mask;
}
Vec Sub(Vec a, const Vec& b) { for (size_t i = 0; i < 3; ++i) a[i] -= b[i]; return a; }
Vec Mix(const Vec& a, const Vec& b, double t) { Vec out{}; for (size_t i = 0; i < 3; ++i) out[i] = a[i] + (b[i] - a[i]) * t; return out; }
void Segment(std::vector<Vec>& out, const Vec& a, const Vec& b, const XY& dash, double* progress = nullptr)
{
    const auto delta = Sub(b, a); const double length = std::sqrt(std::inner_product(delta.begin(), delta.end(), delta.begin(), 0.0));
    if (!dash[0] || length == 0) { if (out.size() + 2 > kVertices) Cap("vertices", kVertices, out.size() + 2); out.push_back(a); out.push_back(b); return; }
    const double period = dash[0] + dash[1];
    const double phase = progress ? std::fmod(*progress, period) : 0;
    double first = -phase; if (first + dash[0] <= 0) first += period;
    const double count = std::max(0.0, std::ceil((length - first) / period));
    if (count > static_cast<double>((kVertices - out.size()) / 2)) Cap("vertices", kVertices, kVertices + 2);
    for (size_t n = 0; n < static_cast<size_t>(count); ++n) { const double from = first + static_cast<double>(n) * period;
        out.push_back(Mix(a, b, std::max(0.0, from) / length)); out.push_back(Mix(a, b, std::min(length, from + dash[0]) / length)); }
    if (progress) *progress = std::fmod(phase + length, period);
}
std::string Tone(const json& o, const char* k, const std::string& p, const char* def = "text")
{ return Choice(o, k, p, def, {"text", "text-muted", "muted", "text-faint", "signal", "accent", "success", "warning", "danger", "line"}); }
Item ParseItem(const json& v, const std::string& p, unsigned views)
{
    Item i; i.id = Text(Required(v, "id", p), p + ".id", 64); i.kind = Text(Required(v, "kind", p), p + ".kind", 16);
    const auto fields = [&](std::initializer_list<const char*> specific) {
        if (!v.is_object()) Bad(p);
        for (const auto& [key, val] : v.items()) { (void)val;
            const std::initializer_list<const char*> common{"id", "kind", "anchor", "color", "opacity", "views", "priority"};
            auto has = [&](auto list) { return std::any_of(list.begin(), list.end(), [&](auto k) { return key == k; }); };
            if (!has(common) && !has(specific)) Bad(p + "." + key);
        }
    };
    if (i.kind != "point" && i.kind != "polyline" && i.kind != "circle" && i.kind != "polygon" && i.kind != "box" && i.kind != "bracket" && i.kind != "label" && i.kind != "icon" && i.kind != "panel")
        throw Refusal({{"code", "unsupported_kind"}, {"path", p + ".kind"}, {"kind", i.kind}});
    i.color = Tone(v, "color", p); i.opacity = Num(v, "opacity", p, 1, 0, 1);
    if (v.contains("priority")) i.priority = static_cast<int>(Integer(v.at("priority"), p + ".priority", 0, 9));
    i.views = v.contains("views") ? Views(v.at("views"), p + ".views") : views;
    if ((i.views & views) != i.views) Bad(p + ".views");
    if ((i.kind == "label" || i.kind == "bracket") && !v.contains("views")) i.views &= World;
    const auto ap = p + ".anchor"; const auto& a = Required(v, "anchor", p);
    Fields(a, ap, {"world", "screen", "entity", "offset"});
    if (a.count("world") + a.count("screen") + a.count("entity") != 1) Bad(ap);
    if (a.contains("world")) i.anchor.point = Vector(a.at("world"), ap + ".world");
    if (a.contains("screen")) { i.anchor.kind = Anchor::Screen; i.anchor.point = Vector(a.at("screen"), ap + ".screen", 2, 0, 1); }
    if (a.contains("entity")) {
        i.anchor.kind = Anchor::Entity; i.anchor.entity = Text(a.at("entity"), ap + ".entity", 20);
        uint64_t id = 0; const auto& s = i.anchor.entity; auto parsed = std::from_chars(s.data(), s.data() + s.size(), id);
        if (!id || parsed.ec != std::errc{} || parsed.ptr != s.data() + s.size() || std::to_string(id) != s) Bad(ap + ".entity");
        if (a.contains("offset")) i.anchor.offset = Vector(a.at("offset"), ap + ".offset");
    } else if (a.contains("offset")) Bad(ap + ".offset");
    if (i.anchor.kind == Anchor::Screen && i.kind != "label" && i.kind != "panel") Bad(ap + ".screen");
    if (i.anchor.kind == Anchor::Screen) i.views &= World;
    auto lineStyle = [&] {
        auto width = Choice(v, "width", p, "normal", {"hair", "normal", "bold"}); i.width = width == "hair" ? 1 : width == "bold" ? 2.5 : 1.5;
        if (v.contains("dash")) { auto d = Vector(v.at("dash"), p + ".dash", 2, .05, 20); i.dash = {d[0], d[1]}; }
    };
    std::vector<Vec> points; bool closed = false;
    if (i.kind == "point") { fields({"size_px"}); i.size = Num(v, "size_px", p, 6, 2, 16); i.vertices = 1; }
    if (i.kind == "polyline" || i.kind == "polygon") {
        if (i.kind == "polyline") fields({"points", "relative", "closed", "dash", "width"}); else fields({"points", "fill_opacity", "width"});
        lineStyle(); i.relative = i.kind == "polygon" || Flag(v, "relative", p);
        const auto& ps = Required(v, "points", p); const size_t min = i.kind == "polygon" ? 3 : 2, max = i.kind == "polygon" ? 64 : 256;
        if (!ps.is_array() || ps.size() < min || ps.size() > max) Bad(p + ".points");
        for (size_t n = 0; n < ps.size(); ++n) { auto point = Vector(ps[n], p + ".points[" + std::to_string(n) + "]"); if (i.kind == "polygon") point[2] = 0; points.push_back(point); }
        closed = i.kind == "polygon" || Flag(v, "closed", p);
        if (i.kind == "polygon") { i.fill = Num(v, "fill_opacity", p, .15, 0, .5); i.polygon = points; }
    }
    if (i.kind == "circle") {
        fields({"radius_m", "ground", "segments", "dash", "width"}); lineStyle(); i.relative = true;
        const auto radius = Number(Required(v, "radius_m", p), p + ".radius_m", .001, 1e5);
        const auto count = v.contains("segments") ? Integer(v.at("segments"), p + ".segments", 8, 64) : 32; i.ground = Flag(v, "ground", p, true);
        for (uint64_t n = 0; n < count; ++n) { double angle = 2 * pi * static_cast<double>(n) / static_cast<double>(count);
            points.push_back({radius * std::cos(angle), radius * std::sin(angle), 0}); } closed = true;
    }
    if (i.kind == "box") {
        fields({"size", "yaw_deg", "dash", "width"}); lineStyle(); i.relative = true;
        auto size = Vector(Required(v, "size", p), p + ".size", 3, .001, 1e5); const auto yaw = Num(v, "yaw_deg", p, 0, -360000, 360000) * pi / 180;
        for (int z : {-1, 1}) for (int y : {-1, 1}) for (int x : {-1, 1}) { Vec q{x * size[0] / 2, y * size[1] / 2, z * size[2] / 2};
            points.push_back({q[0] * std::cos(yaw) - q[1] * std::sin(yaw), q[0] * std::sin(yaw) + q[1] * std::cos(yaw), q[2]}); }
        for (size_t n = 0; n < 8; ++n) for (size_t axis : {size_t{1}, size_t{2}, size_t{4}}) if (!(n & axis)) {
            i.radarLines.push_back(points[n]); i.radarLines.push_back(points[n | axis]); Segment(i.worldLines, points[n], points[n | axis], i.dash); } points.clear();
    }
    if (i.kind == "bracket") {
        fields({"pad_px", "corner_px"}); if (i.anchor.kind != Anchor::Entity) Bad(ap);
        i.pad = Num(v, "pad_px", p, 6, 0, 64); i.corner = Num(v, "corner_px", p, 12, 1, 64); i.vertices = 16;
    }
    if (i.kind == "label") {
        fields({"text", "style", "leader", "offset_px"}); i.text = overlay::LimitToGlyphs(Text(Required(v, "text", p), p + ".text", 96, false));
        i.style = Choice(v, "style", p, "plain", {"plain", "chip"}); i.leader = Flag(v, "leader", p);
        if (v.contains("offset_px")) { const auto xy = Vector(v.at("offset_px"), p + ".offset_px", 2, -4096, 4096); i.offset = {xy[0], xy[1]}; } i.vertices = 1;
    }
    if (i.kind == "icon") {
        fields({"glyph", "size_px", "plate"}); i.glyph = Text(Required(v, "glyph", p), p + ".glyph", 40);
        if (!Name(i.glyph, 40, false)) Bad(p + ".glyph"); i.size = Num(v, "size_px", p, 16, 12, 24); i.plate = Flag(v, "plate", p);
        const auto* glyph = FindGlyph(i.glyph); i.vertices = glyph ? glyph->vertices : 1;
    }
    if (i.kind == "panel") {
        fields({"rect", "title", "lines"}); if (i.anchor.kind != Anchor::Screen) Bad(ap);
        if (v.contains("views") && (Views(v.at("views"), p + ".views") & Radar)) Bad(p + ".views");
        const auto& r = Required(v, "rect", p); if (!r.is_array() || r.size() != 4) Bad(p + ".rect");
        for (size_t n = 0; n < 4; ++n) i.rect[n] = Number(r[n], p + ".rect[" + std::to_string(n) + "]", n > 1 ? .001 : 0, 1);
        if (i.rect[0] + i.rect[2] > 1 || i.rect[1] + i.rect[3] > 1) Bad(p + ".rect");
        i.title = overlay::LimitToGlyphs(Text(Required(v, "title", p), p + ".title", 96, false)); const auto& lines = Required(v, "lines", p);
        if (!lines.is_array() || lines.size() > 12) Bad(p + ".lines");
        for (size_t n = 0; n < lines.size(); ++n) { const auto lp = p + ".lines[" + std::to_string(n) + "]"; Fields(lines[n], lp, {"text", "tone"});
            i.lines.emplace_back(overlay::LimitToGlyphs(Text(Required(lines[n], "text", lp), lp + ".text", 96, false)), Tone(lines[n], "tone", lp)); } i.vertices = 4;
    }
    double progress = 0;
    if (!points.empty()) for (size_t n = 1; n < points.size() + (closed ? 1 : 0); ++n) {
        const auto& a0 = points[n - 1]; const auto& b = points[n % points.size()]; i.radarLines.push_back(a0); i.radarLines.push_back(b); Segment(i.worldLines, a0, b, i.dash, &progress);
    }
    i.vertices = std::max(i.vertices + i.worldLines.size() + i.polygon.size(), SolidVertices(i)); return i;
}
std::string NumberText(double n)
{
    if (!std::isfinite(n)) Bad("$"); if (n == 0) return "0";
    char buf[64]; auto result = std::to_chars(buf, buf + sizeof(buf), n, std::chars_format::general); if (result.ec != std::errc{}) Bad("$");
    std::string s(buf, result.ptr); bool neg = s[0] == '-'; if (neg) s.erase(0, 1);
    int exponent = 0; const auto e = s.find('e'); if (e != std::string::npos) { exponent = std::stoi(s.substr(e + 1)); s.resize(e); }
    const auto dot = s.find('.'); int decimal = static_cast<int>(dot == std::string::npos ? s.size() : dot) + exponent;
    if (dot != std::string::npos) s.erase(dot, 1);
    while (s.size() > 1 && s.front() == '0') { s.erase(0, 1); --decimal; } while (s.size() > 1 && s.back() == '0') s.pop_back();
    std::string out;
    if (decimal > 0 && decimal <= 21) { out = s; if (decimal >= static_cast<int>(s.size())) out.append(static_cast<size_t>(decimal) - s.size(), '0'); else out.insert(static_cast<size_t>(decimal), "."); }
    else if (decimal <= 0 && decimal > -6) out = "0." + std::string(static_cast<size_t>(-decimal), '0') + s;
    else { out = s.substr(0, 1); if (s.size() > 1) out += "." + s.substr(1); const int power = decimal - 1; out += "e" + (power >= 0 ? std::string("+") : std::string()) + std::to_string(power); }
    return (neg ? "-" : "") + out;
}
} // namespace
size_t SolidVertices(const Item& i)
{
    // Two endpoints per solid segment, including shared circle/polygon corners.
    if (!i.radarLines.empty()) return i.radarLines.size() + i.polygon.size();
    return i.vertices;
}
size_t RadarExtraBudget(const std::vector<const Item*>& items)
{
    size_t solid = 0; for (const auto* item : items) if (item->views & Radar) solid += SolidVertices(*item);
    return 16384 - std::min(size_t{16384},solid);
}
json ParseJson(const std::string& raw)
{
    if (JsonNestingDepth(raw, kMaxJsonDepth) > kMaxJsonDepth) Bad("$"); std::vector<std::set<std::string>> keys; bool duplicate = false;
    auto value = json::parse(raw, [&](int, json::parse_event_t event, json& parsed) {
        if (event == json::parse_event_t::object_start) keys.emplace_back();
        if (event == json::parse_event_t::key && !keys.back().insert(parsed.get<std::string>()).second) duplicate = true;
        if (event == json::parse_event_t::object_end) keys.pop_back(); return true;
    }, false);
    if (value.is_discarded() || duplicate) Bad("$"); return value;
}
std::string Canonical(const json& value)
{
    if (value.is_number()) return NumberText(value.get<double>());
    if (value.is_array()) { std::string out = "["; for (const auto& v : value) { if (out.size() > 1) out += ','; out += Canonical(v); } return out + ']'; }
    if (value.is_object()) {
        std::vector<std::string> names; for (const auto& [k, v] : value.items()) { (void)v; names.push_back(k); }
        std::sort(names.begin(), names.end(), [](const auto& a, const auto& b) { return win32::Widen(a) < win32::Widen(b); });
        std::string out = "{"; for (const auto& k : names) { if (out.size() > 1) out += ','; out += json(k).dump() + ':' + Canonical(value.at(k)); } return out + '}';
    } return value.dump();
}
std::string Digest(const json& value)
{
    const auto raw = Canonical(value); std::array<unsigned char, 32> hash{};
    if (BCryptHash(BCRYPT_SHA256_ALG_HANDLE, nullptr, 0, reinterpret_cast<PUCHAR>(const_cast<char*>(raw.data())), static_cast<ULONG>(raw.size()), hash.data(), static_cast<ULONG>(hash.size())) < 0) throw std::runtime_error("canvas SHA-256 failed");
    static constexpr char digits[] = "0123456789abcdef"; std::string out; out.reserve(64);
    for (auto byte : hash) { out.push_back(digits[byte >> 4]); out.push_back(digits[byte & 15]); } return out;
}
Batch Parse(const std::string& raw, const RadarView& radar, bool cet)
{
    (void)radar; if (raw.size() > 65536) Cap("bytes", 65536, raw.size()); const auto v = ParseJson(raw);
    Fields(v, "$", {"schema", "producer", "layer", "world", "seq", "ttl_s", "views", "items"}); if (Required(v, "schema", "$") != "canvas@1") Bad("$.schema");
    Batch b; b.producer = Text(Required(v, "producer", "$"), "$.producer", 32);
    if (cet) { if (b.producer.rfind("cet.", 0) != 0 || !Name(b.producer.substr(4), 24, false)) Bad("$.producer"); } else if (!Name(b.producer, 32, false)) Bad("$.producer");
    b.layer = Text(Required(v, "layer", "$"), "$.layer", 48); if (!Name(b.layer, 48, true)) Bad("$.layer");
    b.world = Integer(Required(v, "world", "$"), "$.world"); b.seq = Integer(Required(v, "seq", "$"), "$.seq"); b.ttl = Num(v, "ttl_s", "$", 5, .5, 30);
    auto views = Views(Required(v, "views", "$"), "$.views"); const auto& items = Required(v, "items", "$"); if (!items.is_array()) Bad("$.items"); if (items.size() > 256) Cap("items", 256, items.size());
    std::set<std::string> ids; b.items.reserve(items.size());
    for (size_t n = 0; n < items.size(); ++n) { auto i = ParseItem(items[n], "$.items[" + std::to_string(n) + "]", views);
        if (!ids.insert(i.id).second) Bad("$.items[" + std::to_string(n) + "].id"); b.vertices += i.vertices; if (b.vertices > kVertices) Cap("vertices", kVertices, b.vertices); b.items.push_back(std::move(i)); }
    b.digest = Digest(v); return b;
}
const char* TextToken(const Item& i) { return i.kind == "panel" || (i.kind == "label" && i.style == "chip") ? "text" : i.color.c_str(); }
const Glyph* FindGlyph(const std::string& name)
{
#define XF_CANVAS_GLYPH(n, count, ...) Glyph{n, count, __VA_ARGS__},
#define XF_CANVAS_MISSING(n)
    static const Glyph glyphs[] = {
#include "core/overlay/CanvasGlyphs.inc"
    };
#undef XF_CANVAS_GLYPH
#undef XF_CANVAS_MISSING
    for (const auto& g : glyphs) if (g.name == name) return &g; return nullptr;
}
bool KnownGlyph(const std::string& name) { return FindGlyph(name) != nullptr; }
} // namespace xfb::canvas
