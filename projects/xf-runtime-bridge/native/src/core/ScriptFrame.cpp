#include "core/ScriptFrame.hpp"

#include <cstring>

namespace xfb::script
{
namespace
{
constexpr size_t kPointer = sizeof(void*);
constexpr size_t kArgSize = 1 + 2 * kPointer; // ExternalVar, type, value
} // namespace

size_t CodeSize(const std::vector<Arg>& aArgs)
{
    size_t size = 1; // ParamEnd
    for (const auto& arg : aArgs)
    {
        size += arg.omitted ? 1 : kArgSize;
    }
    return size;
}

size_t BuildParamCode(const std::vector<Arg>& aArgs, uint8_t* aCode, size_t aCapacity)
{
    if (!aCode || CodeSize(aArgs) > aCapacity)
    {
        return 0;
    }
    size_t at = 0;
    for (const auto& arg : aArgs)
    {
        if (arg.omitted)
        {
            aCode[at++] = kNop;
            continue;
        }
        if (!arg.type || !arg.value)
        {
            return 0;
        }
        aCode[at++] = kExternalVar;
        std::memcpy(aCode + at, &arg.type, kPointer);
        at += kPointer;
        std::memcpy(aCode + at, &arg.value, kPointer);
        at += kPointer;
    }
    aCode[at++] = kParamEnd;
    return at;
}

std::vector<std::string> MissingAddresses(const std::vector<Address>& aAddresses,
                                          const std::function<uintptr_t(uint32_t aHash)>& aResolve,
                                          std::vector<uintptr_t>& aResolved)
{
    std::vector<std::string> missing;
    aResolved.clear();
    for (const auto& address : aAddresses)
    {
        const uintptr_t resolved = aResolve ? aResolve(address.hash) : 0;
        aResolved.push_back(resolved);
        if (resolved == 0)
        {
            missing.emplace_back(address.name);
        }
    }
    return missing;
}
} // namespace xfb::script
