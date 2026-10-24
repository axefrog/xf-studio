#include "plugin/InputDispatch.hpp"
namespace xfb::plugin
{
nlohmann::json InputDispatchStatus()
{
    return {{"available", false}, {"coverage", "uncommissioned"},
            {"blocker", "R1: concrete player-manager input receiver type/lifetime, dispatch virtual implementation/thread and release/axis-zero ABI are unvalidated"},
            {"fake_release_button_safe", false}, {"title_loading_supported", false},
            {"external_fallback", "none: native consumer validation is still required"}};
}
}
