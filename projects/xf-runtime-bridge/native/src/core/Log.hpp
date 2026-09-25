#pragma once

// Structured, bounded logging for every layer of the bridge.
//
// Every line is `key=value` pairs so the harness can grep and correlate:
//   sid=<session> layer=<native|redscript|cet|client> cid=<correlation id> evt=<event> <free text>
// The sink decides where lines go: the RED4ext plugin writes through RED4ext's per-plugin
// logger (red4ext/logs/xfruntimebridge-<timestamp>.log, rotated and bounded by RED4ext);
// the self-test writes to stdout.

#include <atomic>
#include <cstdint>
#include <string>
#include <string_view>

namespace xfb
{
enum class Level : uint8_t
{
    Debug = 0,
    Info,
    Warn,
    Error
};

std::string_view LevelName(Level aLevel);
bool ParseLevel(std::string_view aText, Level& aOut);

class ILogSink
{
public:
    virtual ~ILogSink() = default;
    virtual void Write(Level aLevel, const std::string& aLine) = 0;
};

namespace log
{
// Installs the sink; nullptr disables logging (used during unload).
void SetSink(ILogSink* aSink);
void SetMinLevel(Level aLevel);
Level MinLevel();
void SetSessionId(std::string aSessionId);
const std::string& SessionId();

// Longest message kept; longer text is cut and marked, so a caller cannot flood the log.
inline constexpr size_t kMaxMessageBytes = 2048;

void Write(Level aLevel, std::string_view aLayer, std::string_view aCid, std::string_view aEvent,
           std::string_view aMessage);

inline void Debug(std::string_view aEvent, std::string_view aMessage, std::string_view aCid = "-")
{
    Write(Level::Debug, "native", aCid, aEvent, aMessage);
}
inline void Info(std::string_view aEvent, std::string_view aMessage, std::string_view aCid = "-")
{
    Write(Level::Info, "native", aCid, aEvent, aMessage);
}
inline void Warn(std::string_view aEvent, std::string_view aMessage, std::string_view aCid = "-")
{
    Write(Level::Warn, "native", aCid, aEvent, aMessage);
}
inline void Error(std::string_view aEvent, std::string_view aMessage, std::string_view aCid = "-")
{
    Write(Level::Error, "native", aCid, aEvent, aMessage);
}
} // namespace log

// Replaces control characters and cuts to a maximum length so untrusted text is safe to log.
std::string Sanitize(std::string_view aText, size_t aMaxBytes);
} // namespace xfb
