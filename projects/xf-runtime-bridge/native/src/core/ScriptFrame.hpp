#pragma once

// The caller's side of a script call, built the way the game's script VM expects to find it.
//
// When script code calls a function, the callee reads its arguments by stepping through the
// CALLER's bytecode: one instruction per parameter, then ParamEnd. A native caller has no
// bytecode, so it writes a tiny one: for each argument an ExternalVar instruction followed by the
// argument's type pointer and value pointer (the VM copies the value from there), then ParamEnd.
// This is Cyber Engine Tweaks' recipe (src/reverse/RTTIHelper.cpp, RTTIHelper::ExecuteFunction,
// v1.37.1, MIT), which runs every Lua call into the game; opcode numbers from redscript's
// instruction table (crates/io/src/instr.rs: 0x00 Nop, 0x1B ExternalVar, 0x26 ParamEnd).
//
// Pure byte layout, no game types, so the self-test covers it (`xfb_selftest --unit`).

#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace xfb::script
{
constexpr uint8_t kNop = 0x00;
constexpr uint8_t kExternalVar = 0x1B;
constexpr uint8_t kParamEnd = 0x26;

// The code buffer the game and CET use for one call (RED4ext.SDK Functions-inl.hpp, CET).
constexpr size_t kCodeCapacity = 264;

struct Arg
{
    const void* type = nullptr;  // the parameter's rtti type (CBaseRTTIType*)
    const void* value = nullptr; // where the value lives
    bool omitted = false;        // an optional parameter left out: written as Nop
};

// Bytes needed for aArgs (one instruction each plus ParamEnd).
size_t CodeSize(const std::vector<Arg>& aArgs);

// Writes the parameter code into aCode. Returns the number of bytes written, or 0 when it does
// not fit into aCapacity or an argument that isn't omitted has no type or value.
size_t BuildParamCode(const std::vector<Arg>& aArgs, uint8_t* aCode, size_t aCapacity);

// An engine address a script call needs, by RED4ext.SDK address hash (Detail/AddressHashes.hpp).
struct Address
{
    const char* name;
    uint32_t hash;
};

// Resolves every address through aResolve (at load, RED4ext's own RED4ext_ResolveAddress, which
// answers 0 for a hash the game's address library lacks) and writes each result into aResolved, in
// order. Returns the names that resolved to 0; empty means script calls may go ahead. The SDK
// resolves the same hashes lazily and, on a 0, shows a modal error and ends the game, so the
// plugin checks them all before the first call and refuses script calls instead (RB-32).
std::vector<std::string> MissingAddresses(const std::vector<Address>& aAddresses,
                                          const std::function<uintptr_t(uint32_t aHash)>& aResolve,
                                          std::vector<uintptr_t>& aResolved);
} // namespace xfb::script
