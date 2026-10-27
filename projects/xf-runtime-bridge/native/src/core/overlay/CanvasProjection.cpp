#include "core/overlay/Canvas.hpp"
#include "core/LayoutGuard.hpp"
#include <algorithm>
#include <cmath>
#include <numeric>

namespace xfb::canvas
{
namespace
{
Vec Space(const Camera& c, Vec v)
{
    for (size_t i = 0; i < 3; ++i) v[i] -= c.position[i];
    auto dot = [&](const Vec& a) { return std::inner_product(v.begin(), v.end(), a.begin(), 0.0); };
    return {dot(c.right), dot(c.up), dot(c.forward)};
}
XY Screen(const Camera& c, const Vec& v)
{
    // Same result for a camera snapshot, cached per calling thread. A cap-sized frame must not evaluate tan 16,384 times.
    thread_local double height = 0, fov = 0, scale = 0;
    if (height != c.height || fov != c.fov) { height = c.height; fov = c.fov; scale = height / (2 * std::tan(fov * 3.14159265358979323846 / 360)); }
    return {c.width / 2 + v[0] / v[2] * scale, c.height / 2 - v[1] / v[2] * scale};
}
Vec Mix(const Vec& a, const Vec& b, double t) { return {a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t}; }
bool Valid(const Camera& c) { return c.valid && c.fov > 0 && c.fov < 180 && c.width > 0 && c.height > 0; }
}
bool ClipSegment(XY& a, XY& b, double width, double height)
{
    const XY d{b[0] - a[0], b[1] - a[1]}; double lo = 0, hi = 1;
    for (size_t axis = 0; axis < 2; ++axis) {
        const double max = axis == 0 ? width : height;
        if (std::abs(d[axis]) < 1e-12) { if (a[axis] < 0 || a[axis] > max) return false; }
        else { double x = -a[axis] / d[axis], y = (max - a[axis]) / d[axis]; if (x > y) std::swap(x, y); lo = std::max(lo, x); hi = std::min(hi, y); if (lo > hi) return false; }
    }
    b = {a[0] + hi * d[0], a[1] + hi * d[1]}; a = {a[0] + lo * d[0], a[1] + lo * d[1]}; return true;
}
bool Project(const Camera& c, const Vec& v, XY& out)
{
    if (!Valid(c)) return false; const auto p = Space(c, v); if (p[2] < .01) return false; out = Screen(c, p);
    return std::isfinite(out[0]) && std::isfinite(out[1]) && out[0] >= 0 && out[0] <= c.width && out[1] >= 0 && out[1] <= c.height;
}
Vec WorldVertex(const Item& item, const Camera& camera, Vec point, const Vec& anchor)
{
    if (!item.relative) return point;
    if (item.kind == "circle" && !item.ground) {
        const auto local = point;
        for (size_t axis=0;axis<3;++axis) point[axis] = camera.right[axis]*local[0] + camera.up[axis]*local[1];
    }
    for (size_t axis=0;axis<3;++axis) point[axis] += anchor[axis];
    return point;
}
bool ProjectSegment(const Camera& c, Vec a, Vec b, XY& outA, XY& outB)
{
    if (!Valid(c)) return false; a = Space(c, a); b = Space(c, b); if (a[2] < .01 && b[2] < .01) return false;
    if (a[2] < .01) a = Mix(a, b, (.01 - a[2]) / (b[2] - a[2])); if (b[2] < .01) b = Mix(b, a, (.01 - b[2]) / (a[2] - b[2]));
    outA = Screen(c, a); outB = Screen(c, b); return ClipSegment(outA, outB, c.width, c.height);
}
XY RadarPoint(const Camera& c, const RadarView& r, const Vec& v)
{
    double x = v[0] - c.player[0], y = v[1] - c.player[1];
    if (r.orientation == "heading_up") { const double yaw = c.yaw * 3.14159265358979323846 / 180; const double xx = x * std::cos(yaw) + y * std::sin(yaw); y = -x * std::sin(yaw) + y * std::cos(yaw); x = xx; }
    const auto scale = r.size / (2 * r.range); return {r.size / 2 + x * scale, r.size / 2 - y * scale};
}
std::vector<XY> ProjectPolygon(const Camera& c, const std::vector<Vec>& vertices)
{
    if (!Valid(c) || vertices.size() < 3) return {};
    std::vector<Vec> camera; for (const auto& v : vertices) camera.push_back(Space(c, v));
    std::vector<Vec> clipped;
    for (size_t i = 0; i < camera.size(); ++i) { const auto& a = camera[i]; const auto& b = camera[(i + 1) % camera.size()];
        if (a[2] >= .01) clipped.push_back(a);
        if ((a[2] >= .01) != (b[2] >= .01)) clipped.push_back(Mix(a, b, (.01 - a[2]) / (b[2] - a[2])));
    }
    std::vector<XY> points; for (const auto& v : clipped) points.push_back(Screen(c, v));
    for (size_t plane = 0; plane < 4 && !points.empty(); ++plane) {
        std::vector<XY> out; const size_t axis = plane / 2; const double bound = plane % 2 ? (axis == 0 ? c.width : c.height) : 0;
        for (size_t i = 0; i < points.size(); ++i) { const auto& a = points[i]; const auto& b = points[(i + 1) % points.size()];
            const auto inside = [&](const XY& p) { return plane % 2 ? p[axis] <= bound : p[axis] >= bound; };
            if (inside(a)) out.push_back(a);
            if (inside(a) != inside(b)) { const auto t = (bound - a[axis]) / (b[axis] - a[axis]); out.push_back({a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t}); }
        } points = std::move(out);
    }
    return points;
}
RadarDashes RadarSegments(XY a, XY b, XY dash, size_t& budget, size_t& downgraded, double phase)
{
    RadarDashes out;
    const double length = std::hypot(b[0] - a[0], b[1] - a[1]);
    const double period = dash[0] + dash[1];
    double first = dash[0] > 0 ? -std::fmod(phase,period) : 0;
    if (dash[0] > 0 && first + dash[0] <= 0) first += period;
    const size_t count = dash[0] > 0 ? static_cast<size_t>(std::max(0.0,std::ceil((length - first) / period))) : 1;
    const size_t extra = count > 0 ? (count - 1) * 2 : 0;
    if (count > 64 || extra > budget) { if (dash[0]) ++downgraded; out.points[0]=a;out.points[1]=b;out.count=2;return out; }
    if (dash[0] == 0 || length == 0) { out.points[0]=a;out.points[1]=b;out.count=2;return out; }
    for (size_t n = 0; n < count; ++n) for (double t : {std::max(0.0,(first + static_cast<double>(n) * period) / length), std::min(1.0, (first + static_cast<double>(n) * period + dash[0]) / length)})
        out.points[out.count++] = {a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t};
    budget -= extra; return out;
}
} // namespace xfb::canvas
