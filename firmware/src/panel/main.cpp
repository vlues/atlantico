// Atlántico wall panel. Fetches a ready-made bitmap from the Worker and shows it.
// USB power: polls a tiny version string every ~20 s and redraws only on change (instant welcomes).
// Battery: deep sleep 15 min between updates. E-paper keeps the last image with no power,
// so if Wi-Fi is down the wall simply keeps showing the last sea.
#include <Arduino.h>
#include <SPI.h>
#include <WiFi.h>
#include <atlantico.h>
#include <GxEPD2_BW.h>
#include <GxEPD2_7C.h>
#include <Fonts/FreeSerif12pt7b.h>

#if defined(PANEL_BW_750_T7)
GxEPD2_BW<GxEPD2_750_T7, GxEPD2_750_T7::HEIGHT> display(GxEPD2_750_T7(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
static const int COLORS = 2;
#elif defined(PANEL_6C_730_E6)
GxEPD2_7C<GxEPD2_730c_GDEP073E01, GxEPD2_730c_GDEP073E01::HEIGHT / 4> display(GxEPD2_730c_GDEP073E01(EPD_CS, EPD_DC, EPD_RST, EPD_BUSY));
static const int COLORS = 6;
#else
#error "choose a panel"
#endif

RTC_DATA_ATTR char lastVersion[48] = "";
RTC_DATA_ATTR uint32_t failures = 0;
RTC_DATA_ATTR uint32_t updateCheckIn = 0;  // seconds until the next firmware check (0 = now)

static uint8_t *image = nullptr;
static size_t imageCap = 0;

static bool batteryMode() {
  JsonDocument cfg;
  deserializeJson(cfg, atl::store.config);
  return cfg["power"] == "battery";
}

static int batteryPercent() {
#if BATTERY_PIN >= 0
  uint32_t mv = analogReadMilliVolts(BATTERY_PIN) * 2;  // 1:2 divider
  return constrain(map(mv, 3300, 4150, 0, 100), 0, 100);
#else
  return -1;
#endif
}

static void message(const char *title, const char *line) {
  display.setRotation(0);
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    display.setTextColor(GxEPD_BLACK);
    display.setFont(&FreeSerif12pt7b);
    display.setCursor(60, display.height() / 2 - 10);
    display.print(title);
    display.setFont(nullptr);
    display.setCursor(60, display.height() / 2 + 20);
    display.print(line);
  } while (display.nextPage());
}

static uint16_t sixColor(uint8_t v) {
  switch (v) {
    case 0: return GxEPD_BLACK;
    case 1: return GxEPD_WHITE;
    case 2: return GxEPD_YELLOW;
    case 3: return GxEPD_RED;
    case 4: return GxEPD_BLUE;
    default: return GxEPD_GREEN;
  }
}

static void draw(int w, int h, int colors) {
  display.setRotation(w < h ? 1 : 0);
  display.setFullWindow();
  display.firstPage();
  do {
    if (colors == 6) {
      for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) {
          size_t i = (size_t)y * w + x;
          uint8_t v = (image[i >> 1] >> ((i & 1) ? 0 : 4)) & 0x0f;
          if (v != 1) display.drawPixel(x, y, sixColor(v));
          else display.drawPixel(x, y, GxEPD_WHITE);
        }
    } else {
      display.fillScreen(GxEPD_WHITE);
      display.drawBitmap(0, 0, image, w, h, GxEPD_BLACK);  // 1 bits = black
    }
  } while (display.nextPage());
  display.hibernate();
}

// One update cycle. Returns seconds until the next one.
static uint32_t update() {
  if (!atl::wifiConnect()) { failures++; return min<uint32_t>(60 * failures, 1800); }

  atl::Response poll;
  int st = atl::request("GET", "/api/panel/poll", "", poll);
  if (st == 401) {  // unpaired from the control page
    atl::store.token = "";
    atl::save();
    message("Atlantico", "Unpaired. Open Add device to pair again.");
    return 3600;
  }
  if (st != 200) { failures++; return min<uint32_t>(60 * failures, 1800); }
  failures = 0;
  String version = poll.body;
  version.trim();
  if (version == lastVersion) return batteryMode() ? 900 : 20;

  static const char *want[] = {"x-width", "x-height", "x-colors", "x-sleep-seconds", "x-version"};
  atl::Response img;
  size_t got = 0;
  String extra = String("X-Battery:") + batteryPercent() + "\nX-RSSI:" + atl::rssi();
  st = atl::request("GET", "/art/panel.bin", "", img, image, imageCap, &got, want, 5, &extra);
  if (st != 200) { failures++; return 120; }
  int w = img.header("x-width").toInt(), h = img.header("x-height").toInt(), colors = img.header("x-colors").toInt();
  size_t expected = colors == 6 ? (size_t)w * h / 2 : (size_t)((w + 7) / 8) * h;
  if (got != expected || colors != COLORS) {
    Serial.printf("panel: unexpected image %dx%d c%d (%u bytes)\n", w, h, colors, (unsigned)got);
    return 300;
  }
  draw(w, h, colors);
  strlcpy(lastVersion, img.header("x-version").c_str(), sizeof lastVersion);
  uint32_t s = img.header("x-sleep-seconds").toInt();
  return s ? s : 900;
}

static void setupMode() {
  message("Atlantico", "Connect over USB on the Add device page.");
  uint32_t t0 = millis();
  while (!atl::paired()) {
    atl::poll();
    if (atl::store.code.length() && WiFi.status() == WL_CONNECTED && millis() % 5000 < 20) atl::tryPair();
    if (millis() - t0 > 15UL * 60 * 1000 && batteryMode()) esp_deep_sleep(3600ULL * 1000000);
    delay(10);
  }
}

void setup() {
  atl::begin("panel");
  SPI.begin();
  display.init(0, false, 10, false);
  imageCap = COLORS == 6 ? 800 * 480 / 2 : 800 * 480 / 8;
#if defined(BOARD_HAS_PSRAM)
  image = (uint8_t *)ps_malloc(imageCap);
#endif
  if (!image) image = (uint8_t *)malloc(imageCap);

  // Give the Add-device page a few seconds to talk to us on every boot.
  uint32_t t0 = millis();
  while (millis() - t0 < 3000) { atl::poll(); delay(10); }
  if (!atl::paired()) setupMode();
}

void loop() {
  uint32_t next = update();
  // Once a day, while Wi-Fi is up anyway, look for newer firmware (restarts into it if found).
  if (updateCheckIn == 0 && atl::paired() && WiFi.status() == WL_CONNECTED) {
    updateCheckIn = 86400;
    atl::updateFirmware();
  }
  updateCheckIn -= min(updateCheckIn, next);
  if (batteryMode()) {
    WiFi.disconnect(true);
    esp_deep_sleep((uint64_t)next * 1000000ULL);
  }
  uint32_t until = millis() + next * 1000;
  while ((int32_t)(until - millis()) > 0) { atl::poll(); delay(20); }
}
