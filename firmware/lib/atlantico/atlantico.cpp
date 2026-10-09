#include "atlantico.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <Update.h>
#include "root_cas.h"

namespace atl {

Stored store;
static Preferences prefs;
static const char *kind = "device";
static String headerNames[8], headerValues[8];
static size_t headerCount = 0;

// ── Storage ──────────────────────────────────────────────────────────────────
static void load() {
  prefs.begin("atl", true);
  store.ssid = prefs.getString("ssid", "");
  store.pass = prefs.getString("pass", "");
  store.api = prefs.getString("api", "");
  store.code = prefs.getString("code", "");
  store.token = prefs.getString("token", "");
  store.deviceId = prefs.getString("id", "");
  store.config = prefs.getString("cfg", "{}");
  prefs.end();
}

void save() {
  prefs.begin("atl", false);
  prefs.putString("ssid", store.ssid);
  prefs.putString("pass", store.pass);
  prefs.putString("api", store.api);
  prefs.putString("code", store.code);
  prefs.putString("token", store.token);
  prefs.putString("id", store.deviceId);
  prefs.putString("cfg", store.config);
  prefs.end();
}

void forget() {
  prefs.begin("atl", false);
  prefs.clear();
  prefs.end();
  store = Stored();
  store.config = "{}";
}

String mac6() {
  uint8_t m[6];
  WiFi.macAddress(m);
  char s[13];
  snprintf(s, sizeof s, "%02x%02x%02x%02x%02x%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
  return String(s);
}

int rssi() { return WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0; }

bool paired() { return store.token.length() > 0 && store.api.length() > 0; }

// ── Wi-Fi ────────────────────────────────────────────────────────────────────
bool wifiConnect(uint32_t timeoutMs) {
  if (WiFi.status() == WL_CONNECTED) return true;
  if (!store.ssid.length()) return false;
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(store.ssid.c_str(), store.pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) {
    poll();
    delay(50);
  }
  return WiFi.status() == WL_CONNECTED;
}

// ── Improv Wi-Fi Serial (https://www.improv-wifi.com/serial/) ─────────────────
namespace improv {
enum : uint8_t { CURRENT_STATE = 1, ERROR_STATE = 2, RPC = 3, RPC_RESULT = 4 };
enum : uint8_t { READY = 2, PROVISIONING = 3, PROVISIONED = 4 };
enum : uint8_t { ERR_NONE = 0, ERR_INVALID = 1, ERR_UNKNOWN_CMD = 2, ERR_CONNECT = 3 };
enum : uint8_t { CMD_WIFI = 1, CMD_STATE = 2, CMD_INFO = 3, CMD_SCAN = 4 };

static void send(uint8_t type, const uint8_t *data, uint8_t len) {
  uint8_t head[9] = {'I', 'M', 'P', 'R', 'O', 'V', 1, type, len};
  uint8_t sum = 0;
  for (uint8_t b : head) sum += b;
  for (uint8_t i = 0; i < len; i++) sum += data[i];
  Serial.write(head, 9);
  Serial.write(data, len);
  Serial.write(sum);
  Serial.write('\n');
  Serial.flush();
}
static void state(uint8_t s) { send(CURRENT_STATE, &s, 1); }
static void error(uint8_t e) { send(ERROR_STATE, &e, 1); }
static void result(uint8_t cmd, const String *items, size_t n) {
  uint8_t buf[250];
  size_t p = 2;
  for (size_t i = 0; i < n; i++) {
    size_t l = min((size_t)items[i].length(), sizeof buf - p - 1);
    buf[p++] = l;
    memcpy(buf + p, items[i].c_str(), l);
    p += l;
  }
  buf[0] = cmd;
  buf[1] = p - 2;
  send(RPC_RESULT, buf, p);
}

static void handle(const uint8_t *d, uint8_t len) {
  if (len < 2) return error(ERR_INVALID);
  uint8_t cmd = d[0];
  if (cmd == CMD_WIFI) {
    uint8_t sl = d[2];
    String ssid((const char *)d + 3, sl);
    uint8_t pl = d[3 + sl];
    String pass((const char *)d + 4 + sl, pl);
    state(PROVISIONING);
    store.ssid = ssid;
    store.pass = pass;
    WiFi.disconnect();
    if (wifiConnect(20000)) {
      save();
      state(PROVISIONED);
      result(CMD_WIFI, nullptr, 0);
    } else {
      error(ERR_CONNECT);
      state(READY);
    }
  } else if (cmd == CMD_STATE) {
    bool on = WiFi.status() == WL_CONNECTED;
    state(on ? PROVISIONED : READY);
    if (on) result(CMD_STATE, nullptr, 0);
  } else if (cmd == CMD_INFO) {
#if CONFIG_IDF_TARGET_ESP32S3
    const char *chip = "ESP32-S3";
#elif CONFIG_IDF_TARGET_ESP32C3
    const char *chip = "ESP32-C3";
#else
    const char *chip = "ESP32";
#endif
    String items[4] = {FW_NAME, FW_VERSION, chip, String("Atlantico ") + kind};
    result(CMD_INFO, items, 4);
  } else if (cmd == CMD_SCAN) {
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      String items[3] = {WiFi.SSID(i), String(WiFi.RSSI(i)), WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "NO" : "YES"};
      result(CMD_SCAN, items, 3);
    }
    result(CMD_SCAN, nullptr, 0);
    WiFi.scanDelete();
  } else {
    error(ERR_UNKNOWN_CMD);
  }
}
}  // namespace improv

// ── Serial console ───────────────────────────────────────────────────────────
static uint8_t pkt[300];
static size_t pktLen = 0;
static String line;

static void command(String s) {
  s.trim();
  if (!s.startsWith("ATLANTICO ")) return;
  s = s.substring(10);
  if (s.startsWith("PAIR ")) {
    int sp = s.indexOf(' ', 5);
    store.code = sp > 0 ? s.substring(5, sp) : s.substring(5);
    if (sp > 0) store.api = s.substring(sp + 1);
    store.api.trim();
    while (store.api.endsWith("/")) store.api.remove(store.api.length() - 1);
    save();
    Serial.println("ATLANTICO OK");
    if (wifiConnect()) tryPair();
    else Serial.println("ATLANTICO ERROR no Wi-Fi yet; connect Wi-Fi first");
  } else if (s == "STATUS") {
    Serial.printf("ATLANTICO STATUS %s wifi=%s paired=%s id=%s fw=%s\n", kind,
                  WiFi.status() == WL_CONNECTED ? "yes" : "no", paired() ? "yes" : "no", store.deviceId.c_str(), FW_VERSION);
  } else if (s == "RESET") {
    forget();
    Serial.println("ATLANTICO OK reset");
    delay(200);
    ESP.restart();
  }
}

void poll() {
  while (Serial.available()) {
    uint8_t b = Serial.read();
    static const char H[] = "IMPROV";
    if (pktLen < 6) {
      if (b == (uint8_t)H[pktLen]) { pkt[pktLen++] = b; continue; }
      // Not an Improv packet after all: hand the bytes to the text console.
      for (size_t i = 0; i < pktLen; i++) line += (char)pkt[i];
      pktLen = 0;
      if (b == '\n') { command(line); line = ""; }
      else if (b != '\r' && line.length() < 200) line += (char)b;
      continue;
    }
    pkt[pktLen++] = b;
    if (pktLen >= 9 && pktLen == 9 + (size_t)pkt[8] + 1) {
      uint8_t sum = 0;
      for (size_t i = 0; i < pktLen - 1; i++) sum += pkt[i];
      if (sum == pkt[pktLen - 1] && pkt[6] == 1 && pkt[7] == improv::RPC) improv::handle(pkt + 9, pkt[8]);
      pktLen = 0;
    } else if (pktLen >= sizeof pkt) {
      pktLen = 0;
    }
  }
}

void begin(const char *deviceKind) {
  kind = deviceKind;
  Serial.begin(115200);
  load();
  WiFi.persistent(false);
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
String Response::header(const char *name) const {
  for (size_t i = 0; i < headerCount; i++) if (headerNames[i].equalsIgnoreCase(name)) return headerValues[i];
  return "";
}

int request(const char *method, const String &path, const String &json, Response &out, uint8_t *into, size_t cap,
            size_t *got, const char *const *want, size_t nWant, const String *extra) {
  if (!wifiConnect()) return -1;
  String url = store.api + path;
  WiFiClientSecure tls;
  WiFiClient plain;
  HTTPClient http;
  http.setTimeout(20000);
  http.setReuse(false);
  bool ok;
  if (url.startsWith("https://")) {
    tls.setCACert(ROOT_CAS);
    ok = http.begin(tls, url);
  } else {
    ok = http.begin(plain, url);  // local development only
  }
  if (!ok) return -2;
  if (store.token.length()) http.addHeader("Authorization", "Bearer " + store.token);
  if (json.length()) http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Fw", FW_VERSION);
  if (extra) {
    int start = 0;
    while (start < (int)extra->length()) {
      int nl = extra->indexOf('\n', start);
      if (nl < 0) nl = extra->length();
      String h = extra->substring(start, nl);
      int c = h.indexOf(':');
      if (c > 0) http.addHeader(h.substring(0, c), h.substring(c + 1));
      start = nl + 1;
    }
  }
  if (want && nWant) http.collectHeaders((const char **)want, nWant);
  out.status = http.sendRequest(method, json);
  headerCount = 0;
  for (size_t i = 0; want && i < nWant && i < 8; i++) {
    headerNames[headerCount] = want[i];
    headerValues[headerCount++] = http.header(want[i]);
  }
  if (out.status == 200 && into) {
    WiFiClient *s = http.getStreamPtr();
    size_t n = 0;
    int len = http.getSize();
    uint32_t t0 = millis();
    while ((len < 0 || n < (size_t)len) && n < cap && millis() - t0 < 30000) {
      size_t avail = s->available();
      if (avail) n += s->readBytes(into + n, min(avail, cap - n));
      else if (!s->connected()) break;
      else delay(2);
    }
    if (got) *got = n;
  } else if (out.status > 0) {
    out.body = http.getString();
  }
  http.end();
  return out.status;
}

bool tryPair() {
  if (!store.code.length() || !store.api.length()) return false;
  JsonDocument req;
  req["code"] = store.code;
  req["mac"] = mac6();
  req["fw"] = FW_VERSION;
  req["chip"] = FW_NAME;
  String body;
  serializeJson(req, body);
  String saved = store.token;
  store.token = "";
  Response r;
  int st = request("POST", "/api/pair", body, r);
  if (st != 200) {
    store.token = saved;
    Serial.printf("ATLANTICO ERROR pairing failed (%d) %s\n", st, r.body.c_str());
    return false;
  }
  JsonDocument res;
  if (deserializeJson(res, r.body)) {
    Serial.println("ATLANTICO ERROR bad reply");
    return false;
  }
  store.token = res["token"].as<String>();
  store.deviceId = res["deviceId"].as<String>();
  String cfg;
  serializeJson(res["config"], cfg);
  store.config = cfg;
  store.code = "";
  save();
  Serial.printf("ATLANTICO PAIRED %s\n", store.deviceId.c_str());
  return true;
}

// ── Firmware updates ─────────────────────────────────────────────────────────
// The Worker answers 204 when this build is current, or says where the newer image is. The image
// comes through the Worker too, so the same pinned certificates cover it, and is checked by MD5
// before the device switches to it. A failed or interrupted download leaves the old firmware.
bool updateFirmware() {
  Response r;
  int st = request("GET", String("/api/device/firmware?env=") + FW_ENV + "&build=" + FW_BUILD, "", r);
  if (st != 200) return false;
  JsonDocument d;
  if (deserializeJson(d, r.body)) return false;
  String path = d["path"] | "";
  int size = d["size"] | 0;
  String md5 = d["md5"] | "";
  if (!path.length() || size <= 0) return false;
  Serial.printf("ATLANTICO UPDATE to build %d (%d bytes)\n", (int)(d["build"] | 0), size);

  String url = store.api + path;
  WiFiClientSecure tls;
  WiFiClient plain;
  HTTPClient http;
  http.setTimeout(30000);
  bool ok;
  if (url.startsWith("https://")) {
    tls.setCACert(ROOT_CAS);
    ok = http.begin(tls, url);
  } else {
    ok = http.begin(plain, url);
  }
  if (!ok) return false;
  http.addHeader("Authorization", "Bearer " + store.token);
  if (http.GET() != 200 || http.getSize() != size) {
    http.end();
    return false;
  }
  if (!Update.begin(size)) {
    Serial.printf("ATLANTICO ERROR update: %s\n", Update.errorString());
    http.end();
    return false;
  }
  if (md5.length()) Update.setMD5(md5.c_str());
  size_t written = Update.writeStream(*http.getStreamPtr());
  http.end();
  if (written != (size_t)size || !Update.end(true)) {
    Serial.printf("ATLANTICO ERROR update: %s\n", Update.errorString());
    Update.abort();
    return false;
  }
  Serial.println("ATLANTICO UPDATED, restarting");
  delay(300);
  ESP.restart();
  return true;
}

}  // namespace atl
