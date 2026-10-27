// The XF overlay's in-game styling (bridge 0.8.22; the Studio's style guide, "In-game surfaces"): the generated theme table (every
// colour slot, the metrics, the rule values and the type roles), the motion rule ([overlay] motion, the pulse and the settle) and
// the plugin's short status chip labels. Game-independent; answers the number of failed checks.
#include "core/Config.hpp"
#include "core/InkUi.hpp"
#include "core/overlay/Host.hpp"
#include "core/overlay/Motion.hpp"
#include "core/overlay/Theme.hpp"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace
{
int checks = 0, failures = 0;
void Check(bool ok, const char* label)
{
    ++checks;
    if (!ok)
    {
        ++failures;
        std::printf("OVERLAY FAIL %s\n", label);
    }
}
bool Near(double a, double b, double e = 1e-4)
{
    return std::fabs(a - b) <= e;
}
} // namespace

int OverlayUnitTests()
{
    namespace o = xfb::overlay;
    float rgba[4];

    // ---- the theme table ----
    size_t colours = 0, metrics = 0, values = 0, types = 0;
    o::ThemeColors(colours);
    o::ThemeMetrics(metrics);
    o::ThemeValues(values);
    o::ThemeTypes(types);
    Check(colours == 81 && metrics == 25 && values == 8 && types == 5, "theme: 81 colours (63 ImGui slots, 18 XF), 25 metrics, 8 values, 5 type roles");
    Check(o::ThemeColorOf("CheckboxSelectedBg", o::ThemeKind::Dark, rgba) && o::ThemeColorOf("XfLine", o::ThemeKind::Light, rgba) &&
              o::ThemeColorOf("XfAccentHover", o::ThemeKind::Dark, rgba) && o::ThemeColorOf("TabSelectedOverline", o::ThemeKind::Dark, rgba),
          "theme: the newer ImGui slots and the XF alias slots are in the table");
    // Border takes the control line and the check mark the cyan: the two slots the Studio's table changes.
    float border[4], line[4], strong[4], check[4], signal[4], accent[4];
    o::ThemeColorOf("Border", o::ThemeKind::Dark, border);
    o::ThemeColorOf("XfLine", o::ThemeKind::Dark, line);
    o::ThemeColorOf("XfLineStrong", o::ThemeKind::Dark, strong);
    o::ThemeColorOf("CheckMark", o::ThemeKind::Dark, check);
    o::ThemeColorOf("XfSignal", o::ThemeKind::Dark, signal);
    o::ThemeColorOf("XfAccent", o::ThemeKind::Dark, accent);
    Check(std::memcmp(border, strong, sizeof(border)) == 0 && std::memcmp(border, line, sizeof(border)) != 0, "theme: Border is --line-strong, the card edge XfLine is the soft line");
    Check(std::memcmp(check, signal, sizeof(check)) == 0 && std::memcmp(check, accent, sizeof(check)) != 0, "theme: CheckMark is --signal, not the accent");
    Check(o::ThemeMetricOf("ScrollbarSize", 0) == 8.0f && o::ThemeMetricOf("BevelLarge", 0) == 7.0f && o::ThemeMetricOf("FontSizeXs", 0) == 11.0f &&
              o::ThemeMetricOf("BarThin", 0) == 6.0f && o::ThemeMetricOf("BarLabelled", 0) == 16.0f && o::ThemeMetricOf("SectionGap", 0) == 16.0f,
          "theme: the new metrics (scrollbar, bevel, bars, section gap) carry the Studio's pixels");
    Check(Near(o::ThemeValueOf("DisabledAlpha", 0), 0.45) && Near(o::ThemeValueOf("SweepSeconds", 0), 1.1) && Near(o::ThemeValueOf("LabelledBarAlpha", 0), 0.3),
          "theme: DisabledAlpha and the sweep are read from the Studio's rules, the labelled bar's fill alpha is 30 %");
    const auto* title = o::ThemeTypeOf("title");
    const auto* eyebrow = o::ThemeTypeOf("eyebrow");
    const auto* value = o::ThemeTypeOf("value");
    Check(title && std::strcmp(title->face, "display") == 0 && title->size == 15.0f && eyebrow && eyebrow->size == 11.0f && eyebrow->caps && value &&
              std::strcmp(value->face, "mono") == 0 && value->size == 12.0f,
          "theme: five type roles: the host bakes the UI face at 13 and 12, the display face at 15 and 11 and the mono face at 12");
    Check(o::ThemeFontFiles("ui").size() == 2 && o::ThemeFontFiles("display").size() == 1 && o::ThemeFontFiles("mono").size() == 2, "theme: each face has its Windows font files");

    // ---- the status chips (the plugin supplies the short label; a chip never abbreviates a sentence) ----
    {
        namespace k = xfb::inkui;
        k::BridgeView view;
        view.pluginEnabled = view.listening = view.allowWrites = view.hasClient = true;
        auto readOnly = view;
        readOnly.allowWrites = false;
        auto paused = view;
        paused.writesPaused = true;
        auto killed = view;
        killed.killed = true;
        auto off = view;
        off.pluginEnabled = false;
        auto idle = view;
        idle.listening = false;
        Check(k::Summarize(readOnly).chip == "Read-only" && k::Summarize(view).chip == "Changes allowed" && k::Summarize(paused).chip == "Paused" &&
                  k::Summarize(killed).chip == "Stopped",
              "chip: Read-only, Changes allowed, Paused, Stopped");
        Check(k::Summarize(off).chip.empty() && k::Summarize(idle).chip.empty(), "chip: none while the bridge is off or not ready");
        const auto json = k::StatusJson(paused);
        Check(json["chip"] == "Paused" && json["tone"] == "paused" && json["text"] == "XF Studio connected \xC2\xB7 changes paused",
              "chip: status carries the chip beside the unchanged sentence and tone");
    }

    // ---- [overlay] motion ----
    {
        o::MotionSetting setting = o::MotionSetting::Reduced;
        Check(o::MotionSettingFromName("AUTO", setting) && setting == o::MotionSetting::Auto && o::MotionSettingFromName("reduced", setting) &&
                  setting == o::MotionSetting::Reduced && o::MotionSettingFromName("Full", setting) && setting == o::MotionSetting::Full,
              "motion: auto, reduced and full parse in any case");
        setting = o::MotionSetting::Full;
        Check(!o::MotionSettingFromName("sometimes", setting) && setting == o::MotionSetting::Full, "motion: anything else is refused and changes nothing");
        const auto parsed = xfb::ParseConfig("[overlay]\nmotion = Reduced\n");
        Check(parsed.overlayMotion == "reduced" && parsed.warnings.empty() && xfb::ParseConfig("").overlayMotion == "auto", "motion: config.ini [overlay] motion, default auto");
        const auto bad = xfb::ParseConfig("[overlay]\nmotion = never\n");
        Check(bad.overlayMotion == "auto" && bad.warnings.size() == 1, "motion: an invalid value keeps auto and warns");
        Check(xfb::DescribeConfig(parsed).find("overlay.motion=reduced") != std::string::npos, "motion: the config line in the log names it");
        // Resolution: Windows' own setting, frame generation, and the hand overrides.
        Check(!o::ResolveMotion(o::MotionSetting::Auto, true, false).reduced && std::strcmp(o::ResolveMotion(o::MotionSetting::Auto, true, false).effective, "full") == 0,
              "motion: auto runs when Windows animates and no frame generation is loaded");
        const auto windowsOff = o::ResolveMotion(o::MotionSetting::Auto, false, false);
        Check(windowsOff.reduced && std::strcmp(windowsOff.reason, "windows_animations_off") == 0, "motion: auto stands still when Windows' animation effects are off");
        const auto frameGen = o::ResolveMotion(o::MotionSetting::Auto, true, true);
        Check(frameGen.reduced && std::strcmp(frameGen.reason, "frame_generation") == 0, "motion: auto skips the animation while frame generation is on");
        Check(!o::ResolveMotion(o::MotionSetting::Full, false, true).reduced && o::ResolveMotion(o::MotionSetting::Reduced, true, false).reduced,
              "motion: full and reduced override Windows and frame generation");
        // The host publishes the effective value (overlay.state and XFBridge_Info read it).
        o::OverlayHost host;
        host.SetMotion(o::MotionSetting::Auto);
        host.NoteWindowsAnimation(false);
        const auto snapshot = host.Snapshot();
        Check(std::strcmp(host.Motion().effective, "reduced") == 0 && snapshot["motion"]["effective"] == "reduced" && snapshot["motion"]["setting"] == "auto" &&
                  snapshot["motion"]["reason"] == "windows_animations_off",
              "motion: overlay.state publishes the effective value, the setting and the reason");
        host.NoteWindowsAnimation(true);
        host.NoteFrameGeneration({"sl.dlss_g.dll"});
        Check(host.Snapshot()["motion"]["reason"] == "frame_generation", "motion: a loaded frame-generation module reduces auto");
        host.SetMotion(o::MotionSetting::Full);
        Check(host.Snapshot()["motion"]["effective"] == "full", "motion: full wins over frame generation");
    }

    // ---- review: the Studio's type weights are carried (title and eyebrow 600, the rest 400) ----
    Check(title->weight == 600 && eyebrow->weight == 600 && o::ThemeTypeOf("body")->weight == 400 && o::ThemeTypeOf("label")->weight == 400 && value->weight == 400,
          "theme: each type role carries its Studio weight (the host cannot draw 600 from a variable font with stb_truetype and says so)");

    // ---- review: frame generation is found without the overlay's renderer, bounded, and kept current ----
    {
        using Clock = std::chrono::steady_clock;
        o::OverlayHost host; // never configured: [overlay] enabled = false
        int probes = 0;
        std::vector<std::string> loaded;
        const auto probe = [&] {
            ++probes;
            return loaded;
        };
        const auto t0 = Clock::now();
        Check(!host.Enabled() && std::strcmp(host.Motion().effective, "full") == 0, "frame generation: a disabled overlay starts with full motion");
        Check(host.RefreshFrameGeneration(probe, t0) && probes == 1, "frame generation: the first call probes");
        loaded = {"sl.dlss_g.dll"};
        Check(!host.RefreshFrameGeneration(probe, t0 + std::chrono::milliseconds(500)) && probes == 1 && std::strcmp(host.Motion().effective, "full") == 0,
              "frame generation: bounded to one probe per two seconds however often it is asked");
        Check(host.RefreshFrameGeneration(probe, t0 + std::chrono::milliseconds(2100)) && probes == 2, "frame generation: probes again after two seconds");
        const auto reduced = host.Motion();
        Check(reduced.reduced && std::strcmp(reduced.reason, "frame_generation") == 0 && host.Snapshot()["frame_generation_modules"].size() == 1,
              "frame generation: with the overlay disabled, a loaded module still reduces auto motion");
        loaded.clear();
        host.RefreshFrameGeneration(probe, t0 + std::chrono::milliseconds(4300));
        Check(!host.Motion().reduced && host.Snapshot()["frame_generation_modules"].empty(), "frame generation: kept current when the module goes away");
        loaded = {"ffx_frameinterpolation_x64.dll", "libxess_fg.dll"};
        host.RefreshFrameGeneration(probe, t0 + std::chrono::milliseconds(6500));
        Check(host.Motion().reduced && host.Snapshot()["frame_generation_modules"].size() == 2, "frame generation: and when another is loaded later");
        host.SetMotion(o::MotionSetting::Full);
        Check(!host.Motion().reduced, "frame generation: full motion still wins");
    }

    // ---- the pulse and the settle: time-based, on one clock ----
    {
        Check(Near(o::PulseAlpha(0.0, false), 1.0) && Near(o::PulseAlpha(1.2, false), 0.6) && Near(o::PulseAlpha(2.4, false), 1.0),
              "pulse: alpha 1 at the start, 0.6 half a period (1.2 s) in, back to 1 at 2.4 s");
        bool inside = true, smooth = true;
        double previous = o::PulseAlpha(0.0, false);
        for (int i = 1; i <= 2400; ++i)
        {
            const double t = i / 1000.0, a = o::PulseAlpha(t, false);
            inside = inside && a >= 0.6 - 1e-6 && a <= 1.0 + 1e-6;
            smooth = smooth && std::fabs(a - previous) < 0.01; // never steps
            previous = a;
        }
        Check(inside && smooth, "pulse: stays between 1 and 0.6 and never steps, over a whole period");
        Check(o::PulseAlpha(1.2, true) == 1.0f && o::PulseAlpha(0.7, true) == 1.0f, "pulse: reduced motion draws the dot at full alpha");
        Check(Near(o::PulseAlpha(0.3, false), o::PulseAlpha(0.3 + 2.4 * 7, false), 1e-3), "pulse: a function of the clock alone (periodic), so a slow frame changes nothing");
        Check(Near(o::SettleStrength(0.0), 1.0) && o::SettleStrength(300.0) < 0.2 && o::SettleStrength(300.0) > 0.0 && o::SettleStrength(600.0) == 0.0 &&
                  o::SettleStrength(-5.0) == 0.0,
              "settle: full strength at the change, fading out over 600 ms, gone after");
        o::Settle settle;
        Check(!settle.Note("ok", 1000.0, false) && settle.Strength(1000.0) == 0.0, "settle: the first state seen settles nothing");
        Check(!settle.Note("ok", 1100.0, false), "settle: the same state starts nothing");
        Check(settle.Note("paused", 5000.0, false) && settle.Running(5100.0) && settle.Strength(5000.0) > 0.99, "settle: a change of state starts one");
        Check(!settle.Note("ok", 6000.0, false) && settle.Strength(6000.0) == 0.0, "settle: at most one per 2 s per element (1 s after is refused)");
        Check(settle.Note("write", 7100.0, false), "settle: 2.1 s after the last one a change settles again");
        Check(!settle.Note("killed", 9500.0, true) && settle.Strength(9500.0) == 0.0, "settle: reduced motion starts none");
    }
    std::printf("OVERLAY UNIT: %d checks, %d failures\n", checks, failures);
    return failures;
}
