// Atlántico plant node: soil moisture, temperature, reservoir level, one pump.
// Wakes every ~20 min, reports, does what the Worker says, deep-sleeps.
// Without Wi-Fi it follows the last rules it was given (stored in flash), and if the
// moisture sensor looks broken it falls back to a plain "every N days" schedule.
//
// Wiring (XIAO ESP32-C3):
//   D0  capacitive soil sensor AOUT       D7  soil sensor VCC (powered only while reading)
//   D2  DS18B20 data (4.7k pull-up)       D4/D5  VL53L0X SDA/SCL (in the reservoir lid)
//   D10 pump MOSFET gate (logic-level, e.g. IRLZ44N; flyback diode across the pump)
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <atlantico.h>
#include <VL53L0X.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#define SOIL_PIN D0
#define SOIL_POWER D7
#define TEMP_PIN D2
#define PUMP_PIN D10

static const uint32_t MAX_PUMP_S = 60;   // absolute cap per watering
RTC_DATA_ATTR uint64_t clockS = 0;       // seconds since first boot (survives deep sleep)
RTC_DATA_ATTR uint64_t lastWaterS = 0;
RTC_DATA_ATTR uint32_t pendingMl[8];     // waterings done offline, reported later
RTC_DATA_ATTR uint64_t pendingAt[8];
RTC_DATA_ATTR uint8_t pendingN = 0;
RTC_DATA_ATTR uint32_t dayMl = 0;
RTC_DATA_ATTR uint64_t dayStartS = 0;

struct Rules {
  float waterBelow = 25, doseMl = 250, minIntervalH = 72, maxDailyMl = 500, fallbackEveryDays = 7, pumpMlPerSec = 25;
} rules;
struct Calib { int dry = 3000, wet = 1300; int emptyMm = 250, fullMm = 30; } calib;

static void loadRules() {
  JsonDocument cfg;
  if (deserializeJson(cfg, atl::store.config)) return;
  JsonObject r = cfg["rules"];
  if (!r.isNull()) {
    rules.waterBelow = r["waterBelow"] | rules.waterBelow;
    rules.doseMl = r["doseMl"] | rules.doseMl;
    rules.minIntervalH = r["minIntervalH"] | rules.minIntervalH;
    rules.maxDailyMl = r["maxDailyMl"] | rules.maxDailyMl;
    rules.fallbackEveryDays = r["fallbackEveryDays"] | rules.fallbackEveryDays;
    rules.pumpMlPerSec = r["pumpMlPerSec"] | rules.pumpMlPerSec;
  }
  calib.dry = cfg["soilDry"] | calib.dry;
  calib.wet = cfg["soilWet"] | calib.wet;
  calib.emptyMm = cfg["tankEmptyMm"] | calib.emptyMm;
  calib.fullMm = cfg["tankFullMm"] | calib.fullMm;
}

static void saveRules(JsonObjectConst r) {
  JsonDocument cfg;
  deserializeJson(cfg, atl::store.config);
  cfg["rules"] = r;
  String s;
  serializeJson(cfg, s);
  if (s != atl::store.config) { atl::store.config = s; atl::save(); }
}

// Returns NAN when the sensor reading is implausible (unplugged, shorted, out of soil).
static float readMoisture() {
  pinMode(SOIL_POWER, OUTPUT);
  digitalWrite(SOIL_POWER, HIGH);
  delay(150);
  uint32_t sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogRead(SOIL_PIN); delay(5); }
  digitalWrite(SOIL_POWER, LOW);
  int raw = sum / 16;
  if (raw < 300 || raw > 4000) return NAN;
  float pct = 100.0f * (calib.dry - raw) / (float)(calib.dry - calib.wet);
  return constrain(pct, 0.0f, 100.0f);
}

static float readTemp() {
  OneWire ow(TEMP_PIN);
  DallasTemperature ds(&ow);
  ds.begin();
  ds.requestTemperatures();
  float t = ds.getTempCByIndex(0);
  return t == DEVICE_DISCONNECTED_C ? NAN : t;
}

static float readReservoir() {
  Wire.begin();
  VL53L0X tof;
  tof.setTimeout(300);
  if (!tof.init()) return NAN;
  int mm = tof.readRangeSingleMillimeters();
  if (tof.timeoutOccurred() || mm > 2000) return NAN;
  float pct = 100.0f * (calib.emptyMm - mm) / (float)(calib.emptyMm - calib.fullMm);
  return constrain(pct, 0.0f, 100.0f);
}

static uint32_t pump(uint32_t ml, float reservoir) {
  if (!isnan(reservoir) && reservoir < 5) return 0;
  if (clockS - dayStartS > 86400) { dayStartS = clockS; dayMl = 0; }
  if (dayMl + ml > rules.maxDailyMl) ml = rules.maxDailyMl > dayMl ? rules.maxDailyMl - dayMl : 0;
  if (!ml) return 0;
  uint32_t ms = min<uint32_t>((uint32_t)(1000.0f * ml / max(1.0f, rules.pumpMlPerSec)), MAX_PUMP_S * 1000);
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, HIGH);
  delay(ms);
  digitalWrite(PUMP_PIN, LOW);
  dayMl += ml;
  lastWaterS = clockS;
  return ml;
}

static void offlineRules(float moisture, float reservoir) {
  bool sensorOk = !isnan(moisture);
  uint64_t since = clockS - lastWaterS;
  bool due = sensorOk
    ? moisture < rules.waterBelow && since >= rules.minIntervalH * 3600
    : since >= rules.fallbackEveryDays * 86400;
  if (!due) return;
  uint32_t ml = pump(rules.doseMl, reservoir);
  if (ml && pendingN < 8) { pendingMl[pendingN] = ml; pendingAt[pendingN++] = clockS; }
}

static uint32_t cycle() {
  loadRules();
  float m = readMoisture(), t = readTemp(), r = readReservoir();
  Serial.printf("plant: moisture %.1f temp %.1f reservoir %.1f\n", m, t, r);

  JsonDocument rep;
  if (!isnan(m)) rep["moisture"] = m;
  if (!isnan(t)) rep["temp"] = t;
  if (!isnan(r)) rep["reservoir"] = r;
  rep["rssi"] = atl::rssi();
  rep["fw"] = FW_VERSION;
  JsonArray w = rep["watered"].to<JsonArray>();
  for (uint8_t i = 0; i < pendingN; i++) {
    JsonObject o = w.add<JsonObject>();
    o["ml"] = pendingMl[i];
    o["ago_s"] = (uint32_t)(clockS - pendingAt[i]);
    o["source"] = "local-fallback";
  }
  String body;
  serializeJson(rep, body);

  atl::Response res;
  int st = atl::wifiConnect() ? atl::request("POST", "/api/device/report", body, res) : -1;
  if (st == 200) {
    pendingN = 0;
    JsonDocument d;
    if (!deserializeJson(d, res.body)) {
      if (!d["rules"].isNull()) { saveRules(d["rules"]); loadRules(); }
      uint32_t ml = d["water_ml"] | 0;
      if (ml) pump(ml, r);
      return d["sleep"] | 1200;
    }
    return 1200;
  }
  if (st == 401) { atl::store.token = ""; atl::save(); return 60; }
  offlineRules(m, r);  // Worker unreachable: keep the plant alive on local rules
  return 1800;
}

void setup() {
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);  // never start with the pump on
  atl::begin("plant");
  uint32_t t0 = millis();
  while (millis() - t0 < 3000) { atl::poll(); delay(10); }
  // Unpaired: stay awake for the Add-device page (and still water on the fallback schedule).
  while (!atl::paired()) {
    atl::poll();
    if (atl::store.code.length() && WiFi.status() == WL_CONNECTED && millis() % 5000 < 20) atl::tryPair();
    delay(10);
    if (millis() > 30UL * 60 * 1000) break;
  }
}

void loop() {
  uint32_t awakeStart = millis();
  uint32_t sleepS = atl::paired() ? cycle() : (offlineRules(readMoisture(), readReservoir()), 1800);
  clockS += (millis() - awakeStart) / 1000 + sleepS;
  WiFi.disconnect(true);
  esp_deep_sleep((uint64_t)sleepS * 1000000ULL);
}
