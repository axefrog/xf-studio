# Game crashes: reading them, known triggers and how to probe

**Maturity: Draft.** How to read a Cyberpunk 2077 crash without a debugger, the crashes XF Studio's work has met (each with its fingerprint, trigger and evidence), and a method for finding which call crashes the game in as few restarts as possible. Game 2.31 (file version 3.0.80.51928), RED4ext 1.30.0, redscript 0.5.31, CET 1.37.1, Codeware 1.20.5, on a heavily modded MO2 profile (about 900 mods). Runtime observations cite the local crash report folder by its name (the game's own timestamped folder naming); the reports themselves stay private.

## 1. Where a crash leaves evidence

| Evidence | Location | What it tells you | Grade |
|---|---|---|---|
| Crash report folder | `%LOCALAPPDATA%\REDEngine\ReportQueue\Cyberpunk2077-<yyyymmdd>-<hhmmss>-<pid>-<tid>\` | One folder per crash; the name carries the time and the crashing thread id | [runtime] |
| `stacktrace.txt` | in that folder | Exception name and a one-line message (e.g. *read inaccessible data at 0x0*, *Watchdog timeout! (120 seconds)*); no usable stack | [runtime] |
| `report.txt` | in that folder | Loaded modules, game build (`InternalVersion`), OS | [runtime] |
| `Cyberpunk2077.dmp` | in that folder, ~35 MB | Minidump: exception record, module list, the crashing thread's registers and stack memory | [runtime] |
| RED4ext plugin logs | `red4ext/logs/` in the game folder, or MO2's `overwrite/red4ext/logs/` under MO2 | What each native plugin did up to the crash; lines are flushed as written, so the last line before a crash is trustworthy | [runtime] |
| redscript log | `r6/logs/redscript_rCURRENT.log` (MO2: `overwrite/r6/logs/`) | Which `.reds` files compiled, warnings, `Compilation complete` | [runtime] |

`python tools/minidump_summary.py` prints, for the newest reports, the exception and the faulting address as `<module>+<offset>`, and optionally a heuristic scan of the crashing thread's stack for return addresses into loaded modules (`--frames N`). **The module+offset is the crash's fingerprint:** on the same game build, crashes at the same offset almost always share a cause, while an address inside a plugin DLL (for example `Codeware.dll+…`) points at that plugin. The stack scan is not an unwound call stack (the game ships without public symbols); treat it as "which modules were involved".

## 2. Known crashes

| Fingerprint (game 2.31) | Message | Trigger | Grade |
|---|---|---|---|
| `Cyberpunk2077.exe+0x1e28769` | read at `0x0` | A native member function called with no context, inside `rtti::Function::InternalCallNative`. Met when a plugin called a redscript function with `RED4ext::ExecuteFunction(nullptr, …)` and that script called `TweakDBInterface.GetInt` (probe) or `TDBID.ToStringDEBUG`: script calls them as statics, but they are native members and receive the script's (null) context (§2.1). The same script function completed when CET called it. Seen three times (reports `…-20260926-181257-…`, `…-181813-…`, `…-182825-…`). | [runtime]; cause [runtime] disassembly + [source] |
| `Cyberpunk2077.exe+0xe6abad` / `+0xe6abb0` | read at `0x0` / `0xFFFFFFFFFFFFFFFF` | The launch right after a crash, before the main menu (reports `…-171210-…`, `…-181531-…`). The next launch after that usually works. | [runtime]; cause [hypothesis] |
| `Codeware.dll+0x36a59` | read at a heap address | A launch after a crash (report `…-182616-…`), in Codeware | [runtime]; cause unknown |
| `Cyberpunk2077.exe+0x2a52f36`, code `0x80000003` | *Watchdog timeout! (120 seconds)* | The engine's watchdog: the main loop didn't report for 120 s (report `…-20260913-195258-…`) | [runtime]; trigger unknown |
| `KERNELBASE.dll+0xc41ca`, code `0xE06D7363` | unknown | A C++ exception thrown and not caught, during a machine-wide memory exhaustion (report `…-20260926-165006-…`) | [runtime] |

### 2.1 Calling scripts from native code

What is established [runtime]: RED4ext's `CClass::GetFunction` finds nothing on a redscript class with only static functions: the class is in RTTI with **no functions registered on it**, and its static functions are registered as **global functions** named `<Class>::<Name>;<ParamTypes>` (reachable through `CRTTISystem::GetGlobalFunctions`).

Why `exe+0x1e28769` happens (confidence high): the game's address library (`bin/x64/cyberpunk2077_addresses.json`) names the faulting function `rtti::Function::InternalCallNative`; its disassembly shows that a native **member** function called with no context falls back to the function's "invokable" (virtual `+0x20`), which is null for ordinary natives, and the crash is the read through it [runtime]. RED4ext.SDK reconstructs the branch in `CBaseFunction::ExecuteNative` [source]. `TweakDBInterface.*` and `TDBID.ToStringDEBUG` look static in script but are native members (RedLib calls `gamedataTDBIDHelper` "fake static") [source], so they receive the calling script's context, and `ExecuteFunction(nullptr, …)` gives the script none. Thread and phase were not the problem. **A plugin must call scripts with a caller frame and a context, as CET and RedLib do**; the XF bridge's `plugin/ScriptCall.cpp` does ([runtime access](runtime-access.md), [design §3.5](../research/runtime/runtime-bridge-design.md#35-calling-game-and-script-functions-from-native-code)).

**Reading a game crash offset:** the address library lists symbol names for a few engine functions (84 of its entries, including `rtti::Function::InternalCall` and `InternalCallNative`) with `section:offset` addresses; with the section base (`.text` at RVA `0x1000`) it turns a crash offset into "inside function X". `dumpbin /disasm /range:` on the installed executable (read only) then shows the faulting instruction's context.

The fix, giving every call a context and a caller frame as CET does, passed its in-game check on 26 September 2026: the calls that crashed three times returned normally [runtime] ([test card](../research/runtime/runtime-bridge-test-card.md#script-call-check-first)).

### 2.2 The crash after a crash

On this profile a crash is often followed by a second one at the next launch, before the main menu, and the launch after that works. The launch-time crashes fault at the same game offset (`exe+0xe6abad`) each time, which suggests one repeatable cause rather than chance. [hypothesis]: a file the game or a mod writes while running (a cache, settings or state file) is left half-written by the crash, read and rejected badly at the next start, then rewritten cleanly. Testable by listing files in the game folder, MO2's `overwrite/` and `%LOCALAPPDATA%\CD Projekt Red\` whose modification time falls between a crash and the failed launch.

## 3. Finding the crashing call in few restarts

Each crash costs a restart, and on this profile often two (§2.2). A probe answers "which call?" in one crash:

1. Put a log line **before** each suspect call in the script, through a logger that flushes as it writes (the XF bridge's `XFBridge_Log` native writes straight to the plugin log): `probe 07 TweakDBInterface.GetInt next`.
2. Stage the probe (a scripts-only change needs no plugin rebuild; redscript recompiles at the next launch), trigger it once, and read the last probe line in the log. The call after it is the one that crashed.
3. Compare the same function called from a context known to work (for the XF bridge, CET's Lua layer calls the redscript layer at startup): if it passes there, the fault is in the calling context, not the script.
4. Fingerprint every crash with `tools/minidump_summary.py`; a new offset means a new problem.

Restore the committed files after the probe; a probe is never committed.

## Open questions

- What does the launch after a crash read that makes it fail (§2.2)?
- Does `Codeware.dll+0x36a59` recur, and under what conditions?
