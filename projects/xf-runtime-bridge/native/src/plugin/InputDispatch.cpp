#include "plugin/InputDispatch.hpp"
#include "plugin/Plugin.hpp"
#include "plugin/ScriptCall.hpp"
namespace xfb::plugin
{
nlohmann::json InputDispatchStatus()
{
    return {{"available", false}, {"coverage", "uncommissioned"},
            {"evidence_grade", "source"},
            {"test_build",
#if defined(XFB_AUTONOMOUS_TEST_HOOKS) && defined(XFB_ENGINE_INPUT_TESTS)
             true
#else
             false
#endif
            },
            {"blocker", "[source] R1 locates register arguments, not a callable receiver contract. Concrete receiver type/ownership, vtable implementations, physical-key mapping/overlap and load-safe release/axis-zero are unvalidated."},
            {"source_contract", {
                {"game", "2.31"},
                {"exe_sha256", "a7de82945c03e041fc7339fcf9066224d98db2f5d80fea50f7947bb350a60991"},
                {"acquisition", "[source] gameIPlayerManager virtual +0x200 -> object member +0x10; concrete receiver and lifetime unresolved"},
                {"dispatch", "[source] receiver RCX, key-shaped uint32 EDX, physical EInputAction R8D (Press=1, Release=2, Axis=3), float XMM3; slot +0x1f8"},
                {"release", "[source] helper RVA 0x29b63f0 reached from native caller 0x29c3bec; FakeReleaseButton wrapper does not dispatch"}}},
            {"commissioning_probe", "[hypothesis] Re-run read-only input_probe on the hash-matched executable. Observe existing engine calls to gameIPlayerManager +0x200 and the returned owner's +0x10 receiver; do not invoke that untyped virtual to probe it. Capture concrete type, vtable targets, thread IDs and ownership/teardown across pause, handover and load; inspect the resolved +0x1f8 implementation and the release helper at RVA 0x29b63f0/native caller 0x29c3bec. If no existing caller can be observed, the probe is inconclusive. Trace physical controls separately through ink ProcessInputEvents (hash 673454961) to recover mapping/overlap; that observer alone cannot prove gameplay delivery. Establish release/axis-zero lifetime before any synthetic press, then commission bounded pulses against PSM/ink effects and zero residual input."},
            {"choice_blocker", "[source] Current offers contain captions only; eligibility, timed/phone/disabled/skill/hold and dedicated-action protocol are not certified. No input_eligible offer is published by the retail observer."},
            {"fake_release_button_safe", false}, {"title_loading_supported", false},
            {"external_fallback", "none: native consumer validation is still required"}};
}
void DispatchInput(const std::string& control, const std::string& kind, float value)
{
    (void)control; (void)kind; (void)value;
#if !defined(XFB_AUTONOMOUS_TEST_HOOKS) || !defined(XFB_ENGINE_INPUT_TESTS)
    throw MethodError("test_build_required", "Engine input requires the explicit autonomous input test build.");
#else
    RequireGameThread();
    Get().scriptLayer.Require("native-input");
    // Do not acquire an untyped pointer or copy the helpers' release-before-dereference
    // sequence. There is no safe press without a release that survives ALL stop paths.
    throw MethodError("input_unavailable", InputDispatchStatus()["blocker"].get<std::string>());
#endif
}
bool PhysicalInputHeld(const std::string& control)
{
    (void)control;
    // [source] No physical/synthetic ownership reader is established by R1.
    // Unknown overlap is held, never permission to send a key.
    return true;
}
}
