// Shared by the panel and plant firmware: Wi-Fi (via Improv Serial), pairing, HTTPS.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// Build number from CI; devices install any newer build they are offered.
#ifndef FW_BUILD
#define FW_BUILD 0
#endif
#define ATL_STR2(x) #x
#define ATL_STR(x) ATL_STR2(x)
#define FW_VERSION "1.0." ATL_STR(FW_BUILD)

namespace atl {

struct Stored {
  String ssid, pass;   // Wi-Fi
  String api;          // https://atlantico.<you>.workers.dev
  String code;         // one-time pairing code (until used)
  String token;        // device token (after pairing)
  String deviceId;
  String config;       // JSON from the Worker (size, colours, rules…)
};

extern Stored store;

void begin(const char *deviceKind);   // Serial, NVS, Improv
void save();
void forget();                        // factory reset of Atlántico settings

// Read the USB serial port: Improv Wi-Fi packets and "ATLANTICO …" commands.
void poll();

bool wifiConnect(uint32_t timeoutMs = 12000);
bool paired();
bool tryPair();                       // uses store.code; prints ATLANTICO PAIRED/ERROR

struct Response { int status = 0; String body; String header(const char *name) const; };
// Authenticated request to the Worker. `into`/`cap` stream binary bodies straight into a buffer.
int request(const char *method, const String &path, const String &json, Response &out,
            uint8_t *into = nullptr, size_t cap = 0, size_t *got = nullptr,
            const char *const *wantHeaders = nullptr, size_t nWant = 0, const String *extraHeaders = nullptr);

String mac6();
int rssi();

// Asks the Worker for a newer firmware build; installs it and restarts if there is one.
// Returns false when already up to date or when the update could not be completed.
bool updateFirmware();

}  // namespace atl
