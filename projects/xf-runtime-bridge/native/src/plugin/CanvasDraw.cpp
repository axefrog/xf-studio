#include "plugin/CanvasDraw.hpp"
#include <imgui.h>
#include <algorithm>
#include <array>
#include <cfloat>

namespace xfb::plugin::overlay
{
namespace
{
using canvas::XY; using canvas::Vec;
struct Palette
{
    xfb::overlay::ThemeKind kind = xfb::overlay::ThemeKind::Dark;
    bool ready = false;
    std::array<ImVec4, 11> colours{};
    ImVec4 plate{};
    void Load(xfb::overlay::ThemeKind theme) {
        if (ready && theme == kind) return; kind = theme; ready = true;
        const char* names[]{"Text", "XfTextMuted", "TextDisabled", "XfSignal", "XfAccent", "XfSuccess", "XfWarning", "XfDanger", "XfLineStrong", "TextDisabled", "XfAccent"};
        for (size_t i = 0; i < colours.size(); ++i) { float c[4]{1,1,1,1}; xfb::overlay::ThemeColorOf(names[i], theme, c); colours[i] = {c[0],c[1],c[2],c[3]}; }
        float c[4]{}; xfb::overlay::ThemeColorOf("XfCanvasPlate", theme, c); plate = {c[0],c[1],c[2],c[3]};
    }
    ImU32 Colour(const std::string& token, double opacity) const {
        const size_t n = token == "text-muted" || token == "muted" ? 1 : token == "text-faint" ? 9 : token == "signal" ? 3 : token == "accent" ? 4 : token == "success" ? 5 : token == "warning" ? 6 : token == "danger" ? 7 : token == "line" ? 8 : 0;
        auto c = colours[n]; c.w *= static_cast<float>(opacity); return ImGui::GetColorU32(c);
    }
} palette;
ImVec2 V(XY p) { return {static_cast<float>(p[0]), static_cast<float>(p[1])}; }
Vec Plus(Vec a, const Vec& b) { for (size_t i = 0; i < 3; ++i) a[i] += b[i]; return a; }
void Plate(ImDrawList* list, ImVec2 min, ImVec2 max, float scale, double alpha, ImU32 edge)
{
    const float bevel = xfb::overlay::ThemeMetricOf("BevelSmall", 4) * scale;
    const ImVec2 points[]{{min.x, min.y}, {max.x - bevel, min.y}, {max.x, min.y + bevel}, {max.x, max.y}, {min.x + bevel, max.y}, {min.x, max.y - bevel}};
    auto c = palette.plate; c.w *= static_cast<float>(alpha); list->AddConvexPolyFilled(points, 6, ImGui::GetColorU32(c));
    list->AddLine(points[1], points[2], edge, std::max(1.0f, scale));
}
void Bracket(ImDrawList* list, ImVec2 min, ImVec2 max, float corner, float width, ImU32 colour)
{
    corner = std::min({corner, (max.x - min.x) / 2, (max.y - min.y) / 2});
    for (int x : {0,1}) for (int y : {0,1}) { ImVec2 p{x ? max.x : min.x, y ? max.y : min.y};
        list->AddLine(p, {p.x + (x ? -corner : corner), p.y}, colour, width); list->AddLine(p, {p.x, p.y + (y ? -corner : corner)}, colour, width); }
}
struct Occupancy
{
    std::array<bool, 128 * 72> cells{};
    bool Claim(ImVec2 min, ImVec2 max, double width, double height) {
        if (min.x < 0 || min.y < 0 || max.x > width || max.y > height) return false;
        const int x0 = std::clamp(static_cast<int>(min.x * 128 / width), 0, 127), x1 = std::clamp(static_cast<int>(max.x * 128 / width), 0, 127);
        const int y0 = std::clamp(static_cast<int>(min.y * 72 / height), 0, 71), y1 = std::clamp(static_cast<int>(max.y * 72 / height), 0, 71);
        for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) if (cells[static_cast<size_t>(y * 128 + x)]) return false;
        for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) cells[static_cast<size_t>(y * 128 + x)] = true; return true;
    }
};
}
void DrawCanvas(canvas::Service& service, xfb::overlay::OverlayHost& host, float width, float height, float scale, ImFont* mono, ImFont* title)
{
    if (!service.Visible() || !mono || !title) return;
    const double start = canvas::Now(); const auto& frame = service.Take();
    if (!frame.visible || frame.generation != service.Generation() || !frame.camera.valid) return;
    palette.Load(host.Theme()); auto camera = frame.camera; camera.width = width; camera.height = height;
    auto* list = ImGui::GetBackgroundDrawList();
    const double now = canvas::Now(); const auto& radar = frame.radar;
    const float size = static_cast<float>(radar.size) * scale, margin = 8 * scale;
    const bool right = radar.corner.find("right") != std::string::npos, bottom = radar.corner.find("bottom") != std::string::npos;
    const ImVec2 origin{right ? width - margin - size : margin, bottom ? height - margin - size : margin};
    Plate(list, origin, {origin.x + size, origin.y + size}, scale, radar.opacity, palette.Colour("line", radar.opacity));
    size_t radarBudget = 16384, downgraded = 0;
    Occupancy occupied;
    std::vector<const canvas::Item*> items; items.reserve(1024);
    for (const auto& layer : frame.layers) if (layer.batch->expires > now) for (const auto& i : layer.batch->items) items.push_back(&i);
    size_t radarBase=0; for (const auto* item:items) if (item->views & canvas::Radar) radarBase += canvas::SolidVertices(*item);
    radarBudget -= std::min(radarBudget,radarBase);
    std::stable_sort(items.begin(), items.end(), [](auto a, auto b) { return a->priority > b->priority; });
    for (const auto* item : items) {
        const auto& i = *item; Vec anchor = i.anchor.point; double opacity = i.opacity;
        if (i.anchor.kind == canvas::Anchor::Entity) {
            const auto it = frame.anchors.find(i.anchor.entity); if (it == frame.anchors.end()) continue;
            const auto state = canvas::AnchorAt(it->second, now); if (state.state == canvas::AnchorState::Lost) continue;
            anchor = Plus(state.position, i.anchor.offset); opacity *= state.opacity;
        }
        for (unsigned view : {canvas::World, canvas::Radar}) {
            if (!(i.views & view) || (view == canvas::World && !frame.worldMarkers) || (view == canvas::Radar && i.anchor.kind == canvas::Anchor::Screen)) continue;
            const bool onRadar = view == canvas::Radar; const double alpha = opacity * (onRadar ? radar.opacity : 1);
            const ImU32 colour = palette.Colour(i.color, alpha); const float stroke = static_cast<float>(i.width) * scale;
            const auto position = [&](const Vec& world, XY& out) {
                if (!onRadar) return canvas::Project(camera, world, out);
                const auto p = canvas::RadarPoint(camera, radar, world); out = {origin.x + p[0] * scale, origin.y + p[1] * scale};
                return p[0] >= 0 && p[1] >= 0 && p[0] <= radar.size && p[1] <= radar.size;
            };
            if (onRadar) list->PushClipRect(origin, {origin.x + size, origin.y + size}, true);
            const auto& segments = onRadar ? i.radarLines : i.worldLines;
            double radarPhase = 0;
            for (size_t n = 0; n + 1 < segments.size(); n += 2) {
                const auto a = onRadar ? (i.relative ? Plus(segments[n], anchor) : segments[n]) : canvas::WorldVertex(i,camera,segments[n],anchor);
                const auto b = onRadar ? (i.relative ? Plus(segments[n+1], anchor) : segments[n+1]) : canvas::WorldVertex(i,camera,segments[n+1],anchor);
                XY p{}, q{};
                if (!onRadar) { if (canvas::ProjectSegment(camera, a, b, p, q)) list->AddLine(V(p), V(q), colour, stroke); }
                else {
                    p = canvas::RadarPoint(camera, radar, a); q = canvas::RadarPoint(camera, radar, b);
                    const auto original = p; const auto length = std::hypot(q[0]-p[0],q[1]-p[1]);
                    if (canvas::ClipSegment(p, q, radar.size, radar.size)) {
                        const auto dashed = canvas::RadarSegments(p, q, i.dash, radarBudget, downgraded, radarPhase + std::hypot(p[0]-original[0],p[1]-original[1]));
                        for (size_t d = 0; d + 1 < dashed.size(); d += 2) list->AddLine({origin.x + static_cast<float>(dashed[d][0]) * scale, origin.y + static_cast<float>(dashed[d][1]) * scale}, {origin.x + static_cast<float>(dashed[d+1][0]) * scale, origin.y + static_cast<float>(dashed[d+1][1]) * scale}, colour, stroke);
                    }
                    if (i.dash[0] && i.kind != "box") radarPhase = std::fmod(radarPhase + length, i.dash[0]+i.dash[1]);
                }
            }
            if (i.kind == "polygon" && i.fill > 0) {
                std::vector<ImVec2> points;
                if (onRadar) for (const auto& p : i.polygon) { const auto q = canvas::RadarPoint(camera, radar, Plus(p, anchor)); points.push_back({origin.x + static_cast<float>(q[0]) * scale, origin.y + static_cast<float>(q[1]) * scale}); }
                else { std::vector<Vec> world; for (const auto& p : i.polygon) world.push_back(Plus(p, anchor)); for (const auto& p : canvas::ProjectPolygon(camera, world)) points.push_back(V(p)); }
                if (points.size() >= 3) list->AddConcavePolyFilled(points.data(), static_cast<int>(points.size()), palette.Colour(i.color, alpha * i.fill));
            }
            XY projected{}; bool inFrame = i.anchor.kind == canvas::Anchor::Screen;
            if (inFrame) projected = {anchor[0] * width, anchor[1] * height}; else inFrame = position(anchor, projected);
            const auto p = V(projected);
            if (inFrame && i.kind == "point") list->AddCircleFilled(p, static_cast<float>(i.size) * scale / 2, colour, 12);
            if (inFrame && i.kind == "icon") {
                const auto* glyph = canvas::FindGlyph(i.glyph); const float glyphSize = static_cast<float>(i.size) * scale;
                if (i.plate) Plate(list, {p.x - glyphSize / 2 - 2 * scale, p.y - glyphSize / 2 - 2 * scale}, {p.x + glyphSize / 2 + 2 * scale, p.y + glyphSize / 2 + 2 * scale}, scale, alpha, colour);
                if (!glyph) list->AddCircleFilled(p, 3 * scale, colour, 12);
                else for (const auto& path : glyph->paths) {
                    std::array<ImVec2,256> ps{}; size_t n = 0; for (const auto& v : path.points) ps[n++] = {p.x + (static_cast<float>(v[0]) / 16 - .5f) * glyphSize, p.y + (static_cast<float>(v[1]) / 16 - .5f) * glyphSize};
                    const auto col = palette.Colour(i.color, alpha * path.alpha);
                    if (path.fill && n >= 3) list->AddConcavePolyFilled(ps.data(), static_cast<int>(n), col);
                    else if (n >= 2) list->AddPolyline(ps.data(), static_cast<int>(n), col, 1.5f * glyphSize / 16, path.closed ? ImDrawFlags_Closed : 0);
                }
            }
            if (inFrame && i.kind == "label") {
                const auto textSize = mono->CalcTextSizeA(mono->LegacySize, FLT_MAX, 0, i.text.c_str());
                const float px = i.style == "chip" ? 8 * scale : 0, py = i.style == "chip" ? 2 * scale : 0;
                const ImVec2 min{p.x + static_cast<float>(i.offset[0]) * scale, p.y + static_cast<float>(i.offset[1]) * scale}; const ImVec2 max{min.x + textSize.x + 2*px, min.y + textSize.y + 2*py};
                if (occupied.Claim(min, max, width, height)) {
                    if (i.leader) list->AddLine(p, min, colour, scale);
                    if (i.style == "chip") Plate(list, min, max, scale, alpha, colour);
                    list->AddText(mono, mono->LegacySize, {min.x + px, min.y + py}, palette.Colour(canvas::TextToken(i), alpha), i.text.c_str());
                }
            }
            if (i.kind == "bracket") {
                ImVec2 min{FLT_MAX,FLT_MAX}, max{-FLT_MAX,-FLT_MAX}; bool any = false;
                // Person-sized fallback; no unproven engine bounds read on the tick route.
                for (double x : {-.3,.3}) for (double y : {-.3,.3}) for (double z : {0.0,1.9}) {
                    XY q{}; if (position(Plus(anchor, {x,y,z}), q)) { const auto v = V(q); min.x=std::min(min.x,v.x); min.y=std::min(min.y,v.y); max.x=std::max(max.x,v.x); max.y=std::max(max.y,v.y); any=true; }
                }
                if (any) { min.x -= static_cast<float>(i.pad)*scale; min.y -= static_cast<float>(i.pad)*scale; max.x += static_cast<float>(i.pad)*scale; max.y += static_cast<float>(i.pad)*scale;
                    Bracket(list,min,max,static_cast<float>(i.corner)*scale,scale,colour); }
            }
            if (i.kind == "panel" && !onRadar) {
                const ImVec2 min{static_cast<float>(i.rect[0])*width,static_cast<float>(i.rect[1])*height}, max{static_cast<float>(i.rect[0]+i.rect[2])*width,static_cast<float>(i.rect[1]+i.rect[3])*height};
                Plate(list,min,max,scale,alpha,colour); list->PushClipRect(min,max,true); float y=min.y+6*scale;
                std::string caps=i.title; for (auto& ch:caps) if (ch>='a'&&ch<='z') ch=static_cast<char>(ch-'a'+'A');
                list->AddText(title,title->LegacySize,{min.x+8*scale,y},palette.Colour("text",alpha),caps.c_str()); y+=title->LegacySize+6*scale;
                for (const auto& [text,tone]:i.lines) { list->AddLine({min.x+3*scale,y},{min.x+3*scale,y+mono->LegacySize},palette.Colour(tone,alpha),2*scale); list->AddText(mono,mono->LegacySize,{min.x+8*scale,y},palette.Colour("text",alpha),text.c_str()); y+=mono->LegacySize+6*scale; }
                list->PopClipRect();
            }
            if (onRadar) list->PopClipRect();
        }
    }
    // V at the centre and north/heading identification are canvas-owned, not producer content.
    list->AddCircleFilled({origin.x+size/2,origin.y+size/2},3*scale,palette.Colour("text",radar.opacity),12);
    list->AddText(mono,mono->LegacySize,{origin.x+8*scale,origin.y+6*scale},palette.Colour("text",radar.opacity),radar.orientation=="north_up"?"N":"HEADING");
    service.RadarDowngraded(downgraded); service.RenderCost((canvas::Now()-start)*1000);
}
}
