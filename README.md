# Atlántico

A quiet smart-apartment system for a flat in Fuentebravía (El Puerto de Santa María, Cádiz).

- **The wall piece.** Fine contour lines drawn from the real sea outside: swell, wind, tide and the sun's position. It shows on any screen and on an e-ink frame.
- **Guest arrival.** Guests tap an NFC tag or scan a QR code and type their first name. Each guest gets their own star in the sky of the wall piece, and the lights go to Hosting. They also get the Wi-Fi.
  - **On arrival:** for 30 seconds, every screen plays the arrival. A shooting star lands on the guest's star, it ignites and reflects on the sea, and their name appears with a personal line. A first visit reads *tu estrella, desde hoy · llegas con levante*; a return reads *tercera visita · la anterior, hace 12 días*.
  - **Remembering guests:** the guest's phone remembers them, so next time they tap once (or not at all; see the NFC section).
  - **While they're here:** for six hours after they tap in, their star sparkles in gold with their first name beside it. Regulars' stars burn slightly brighter.
- **Light scenes.** Hosting, Evening, Focus and Off, plus Auto, which follows sunrise and sunset. A simulator runs today, and Govee bulbs connect with just an API key.
- **Plants.** There are four: an olive tree, a *Strelitzia nicolai*, a snake plant and a ZZ plant. Each has its own watering rules. Claude checks them every morning and writes one dry line per plant. You only hear about it, via Telegram, when something needs you.
- **Control page.** Owner only. It shows everything above, plus devices and alerts.

Everything runs today with **no hardware**. Each simulated device disappears when its real one pairs.

---

## Try it now (demo mode)

```bash
npm install
npm run demo
```

| | |
|---|---|
| Wall piece | http://localhost:8788/wall |
| Control (passcode `sim-owner`) | http://localhost:8788/control |
| Guest page | http://localhost:8788/hola |
| E-ink image | http://localhost:8787/art/panel.png?size=800x480 |

The **Demo** panel on the control page lets you:

- force a sea state (calm, poniente, levante, storm) or return to **live**
- pin the sun to sunrise, noon, sunset or night
- "ring the bell" as a guest (a name already on the wall, such as Lucía, arrives as a returning guest)
- dry out a plant, or empty or refill a reservoir
- fast-forward the plants a day or a week
- run the Claude plant check on demand
- knock a simulated device offline

The preview above it switches between the browser view, the black-and-white e-ink bitmap and the 6-colour bitmap.

### Live data or simulated?

- **The sea, wind and tide are always live.** They come from Open-Meteo, including in demo mode, unless you pick a sea state in the Demo panel.
- **The sun is always computed locally** from the date and the flat's coordinates. It's never fetched.
- **Devices are simulated** while `SIMULATE=true`: the panel, plant nodes and lights. The simulated soil dries at species-specific rates, faster on the sunny terrace, and the pumps water by the rules. The simulated reservoirs slowly empty.

The control page always says which is which, for example "Live sea and wind · Open-Meteo · updated 4 min ago", or "Demo sea: levante (simulated)".

---

## Setting it up for real (about 10 minutes)

You need a free Cloudflare account and a free GitHub account. On your Mac, run:

```bash
brew install node gh
npm install
npm run setup
```

`setup` does the following, in order. You can run it again safely.

1. Checks Node, git and the GitHub CLI.
2. Logs you into Cloudflare (a browser window opens).
3. Creates the **D1** database and the **KV** store, then writes their IDs into `wrangler.toml`.
4. Deploys the **Worker** and prints its URL.
5. Asks for secrets, which are stored in Cloudflare and never in the repo:
   - the owner passcode for the control page (press Enter to generate one)
   - an optional Claude API key for the plant check (console.anthropic.com)
   - an optional Telegram bot. It walks you through @BotFather and finds your chat ID automatically.
6. Creates a public GitHub repo, enables **GitHub Pages**, and points the site at the Worker.
7. Asks for a **Cloudflare API token**, used for nightly backups and auto-deploys. Create it at *dash.cloudflare.com → Profile → API Tokens*: use the "Edit Cloudflare Workers" template and add the permission *Account › D1 › Edit*.
8. Generates a **backup passphrase**. Save it in your password manager.
9. Prints your URLs.

After that, `git push` is all that's needed:

- Changes to the Worker deploy themselves.
- The site and firmware rebuild themselves.
- `npm run deploy` does the same by hand.

### Costs

Everything fits within the free tiers:

- **Cloudflare Workers:** 100k requests/day. A USB-powered panel uses about 4,300/day.
- **D1 and KV**
- **GitHub Pages and Actions**
- **Open-Meteo:** free for non-commercial use.

The only paid item is the Claude plant check: about one short request a day, which costs cents per month.

On Cloudflare's free plan a request may use 10 ms of CPU. Rendering a panel image takes about 7–10 ms, and each image is cached in KV, so most panel requests just read the cache. If you ever see error 1102 in the Worker logs, Workers Paid ($5/month) removes the limit.

---

## Adding devices (under a minute each)

Open **Control → Add device** in **Chrome or Edge** on your Mac. Safari can't talk to USB.

### Wall panel (e-ink)

1. Pick **Wall panel** and the board, either the Seeed XIAO 7.5″ or the 7.3″ Spectra 6 colour panel.
2. Choose the power option:
   - **USB:** welcomes appear within about 20 seconds.
   - **Battery:** the panel updates every 15 minutes.
3. Plug the board into the Mac with a USB-C **data** cable and press **Install**. The page flashes the firmware, then asks for your Wi-Fi (this is Improv Wi-Fi).
4. Close the install window and press **Pair**. The page sends a one-time code over the same cable. The panel contacts the Worker and gets its own token, and the simulated panel disappears from the device list.

If Wi-Fi drops, the panel keeps showing the last image. E-paper needs no power to hold a picture.

### Plant node

These steps are the same as for the panel. The difference is that you choose **which plant** the node waters.

- Every 20 minutes the node wakes, reports soil moisture, temperature and reservoir level, waters if the Worker says so, and goes back to sleep.
- **If Wi-Fi or the internet is down,** it keeps watering by the last rules it was given, which are stored on the device.
- **If the moisture sensor looks broken,** it falls back to "every N days".
- There is always a daily maximum and a 60-second pump cap.
- **Calibrate once:** in the plant's *Rules*, set "Pump ml/s". Run the pump for 10 seconds into a measuring jug and divide the volume by 10.

### Lights (Govee)

1. In the Govee Home app, go to *Profile › Settings › Apply for API Key*. The key arrives by email.
2. On **Add device → Lights**, paste the key, press **Find bulbs**, tick the ones you want, and press **Use these bulbs**.

Adding another brand means writing one small adapter object in `worker/src/lights.ts` that implements `LightAdapter`'s `list()` and `set()`.

### Guests: NFC tag and QR code

- Write the guest page URL with `?door` on the end (`…/hola?door`) to an NFC sticker as a **URL record**, using an app such as *NFC Tools*. Print the same URL as a QR code for phones without NFC.
  - When a phone that has been here before opens the `?door` link, the guest is checked in straight away, with no tapping. Without `?door`, they get a single "Entrar" button.
- **Returning guests:**
  - The guest's phone keeps a small key, so the wall recognises them.
  - If the phone has forgotten them (Safari clears site data after about a week without a visit), typing the same first name asks "¿Has estado aquí antes?". Answering yes joins the visit to their existing star instead of creating a new one.
  - Tapping in again within the same six-hour stay doesn't count as a new visit.
- **Who's here:** **Control → Guests** shows each guest's number of visits and who is *here now*. **End visit** stops a star sparkling early (the star stays on the wall).
- **iPhone vs Android and Wi-Fi over NFC:**
  - iPhones read URL tags fine, but **can't join Wi-Fi from an NFC tag**. iOS doesn't support Wi-Fi records on tags. That's why the tag opens the web page instead.
  - Android can join from a Wi-Fi NFC record, but support varies by manufacturer, so the page is used there too.
  - On the page, guests can copy the password with one tap. On Android, they can long-press the QR code and pick "Scan QR code". A second device can scan the code directly.
  - iPhones also offer "Share Password" automatically when a friend's iPhone is nearby.
- Set the Wi-Fi details and the wall greeting under **Control → Guests**. The default greeting is *Bienvenido*. You can change it to something neutral, such as *Te damos la bienvenida*.
- **Privacy:**
  - Only a first name is stored, with a visit count and the time of the last arrival. No email, no phone number, no IP address.
  - A guest's name is shown on the wall only while they're here, as the guest page tells them. The wall's data address is public, as the wall itself is, so anyone with the link could see who is here at that moment.
  - Arrivals are rate-limited to 8 per 10 minutes per connection and 60 per day in total.
  - A hidden field catches bots.
  - Guests can delete their own entry from the phone they first arrived on, and you can delete any entry from the control page.
  - Being recognised by name alone never allows deleting a star, because typing a name is not proof of who someone is.

---

## Parts list (for later)

All parts below are USB-powered, renter-friendly and need no drilling. Prices are **rough US estimates from October 2026**, not checked on Amazon.com; check before buying.

| For | Part | ≈ USD |
|---|---|---|
| Wall panel (B/W) | Seeed Studio **XIAO 7.5″ ePaper Panel** (ESP32-C3, 800×480, USB-C, battery included) | 70–85 |
| *or* wall panel (colour) | Waveshare **7.3″ e-Paper (E) Spectra 6** panel + Seeed **XIAO ePaper driver board** + **XIAO ESP32-S3 Plus** | 120–140 |
| Hanging | Command picture-hanging strips (large) | 10–15 |
| Plant node ×4 | Seeed **XIAO ESP32-C3** (3-pack, plus one more) | 25 + 9 |
| | Capacitive soil moisture sensor v2.0 (5-pack) | 8–10 |
| | DS18B20 waterproof temperature probe (5-pack) | 10–12 |
| | VL53L0X time-of-flight distance sensor (×4; it sits in the reservoir lid) | 25–35 |
| | 5 V mini submersible pump + 4 m silicone tube (×4) | 30–45 |
| | Logic-level MOSFET modules (IRLZ44N or similar, 5-pack) + 1N5819 diodes | 10–12 |
| | 3–5 L opaque reservoir per plant (food-safe box with lid) | 10–15 each |
| Power | USB-C 5 V chargers, 100–240 V (they work in Spain and the US) + cables | 8–12 each |
| Lights | **Govee** Wi-Fi bulbs, E26 for the US or **E27 for Spain** (4-pack) | 30–45 |
| Guests | NTAG215 NFC stickers (10-pack) | 8–10 |

**Firmware pins:**

- The plant wiring is printed at the top of `firmware/src/plant/main.cpp`.
- The panel pins for the Seeed board come from community sources. **Check them against Seeed's driver-board schematic before the first flash.** They live in `firmware/platformio.ini` as `EPD_CS`, `EPD_DC`, `EPD_RST` and `EPD_BUSY`.

---

## Moving house (PCS)

Nothing important lives on a device; it's all in Cloudflare, and that data is backed up every night.

1. **Before you go:** in GitHub, go to Actions → *Nightly backup* → **Run workflow**. This takes a fresh encrypted backup.
2. **Same Cloudflare account, new address:** change `LAT`/`LON` in `wrangler.toml`. Also change `HOME.coastFacing` in `web/lib/art.js`, which is the direction you look out to sea (it's 245° here). Then run `npm run deploy`. The wall redraws for the new sea.
   - **If the new home isn't by the sea:** Open-Meteo's marine API returns no waves inland, and the art falls back to a calm surface.
3. **New Wi-Fi:** plug each device into the Mac and open *Add device*. The install window offers **Change Wi-Fi** without re-flashing. Pairing is kept.
4. **New Cloudflare account:** run `npm run setup` (it creates everything new), then `npm run restore` and enter the backup passphrase. Re-pair the devices, since the Worker URL changed.
5. **Voltage:** USB chargers rated 100–240 V work in both countries. Govee bulbs come as E26 for the US and E27 for Spain, so swap them or use adapters.

To restore from a specific day, take an older `backups/atlantico.sql.enc` from the git history and run `npm run restore -- path/to/file`.

---

## How it fits together

```
GitHub Pages (static)                Cloudflare Worker (TypeScript)           Devices
  /wall      canvas, live     ─────▶  /api/wall, /art/panel.{png,bin}  ◀──── e-ink panel (poll + image)
  /hola      guest arrival    ─────▶  /api/arrive (rate limited)
  /control   owner only       ─────▶  /api/overview, scenes, demo      ────▶ Govee cloud API
  /add       ESP Web Tools    ─────▶  /api/pairing  ◀── /api/pair ───────── plant node / panel
                                       cron */15: weather, simulator, auto light, offline alerts
                                       cron 07:30: Claude plant check → Telegram
                                       D1: plants, readings, visitors, settings, arrivals · KV: caches, rate limits
```

- **One renderer.** `web/lib/art.js` turns conditions into lines. That same code draws:
  - the browser canvas
  - the Worker's SVG live view (`/art/live`)
  - the e-ink bitmaps, via `web/lib/raster.js`. These use anti-aliased lines and real Cormorant Garamond outlines, reduced to 1-bit or Spectra 6 colours.
- **Panel files.**
  - `panel.bin` is raw: 1 bit per pixel with MSB first and 1 = black, or 4 bits per pixel for colour.
  - The panel draws it with no decoding.
  - `panel.png` is the same image, for viewing.
- **Firmware: Arduino (PlatformIO), not ESPHome.**
  - ESPHome is designed around Home Assistant. Pulling a bitmap with a per-device token, and pairing by a one-time code over USB, would mean fighting it.
  - Plain Arduino needs a few hundred lines, and nothing to install on your Mac.
  - GitHub Actions builds the firmware. ESP Web Tools flashes it, and Improv sets the Wi-Fi.
  - TLS is verified against pinned root certificates. These are the CAs Cloudflare uses, valid into the 2030s.
- **Security:**
  - The control page is public HTML, but every owner API call needs the passcode. Ten wrong tries locks that connection out for an hour.
  - Device tokens are stored only as SHA-256 hashes.
  - The repo is public, so backups are AES-256 encrypted.

### Sources (checked October 2026)

- **Waves and tide:** Open-Meteo Marine API, `https://marine-api.open-meteo.com/v1/marine`. Fields: `wave_height`, `wave_period`, `wave_direction`, `sea_level_height_msl` (tide relative to mean sea level). Docs: https://open-meteo.com/en/docs/marine-weather-api
- **Wind:** Open-Meteo Forecast API, `https://api.open-meteo.com/v1/forecast`. Fields: `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `temperature_2m`. Docs: https://open-meteo.com/en/docs
- **Sun position:** computed locally in `web/lib/sun.js`, using a low-precision solar ephemeris from the Astronomical Almanac / NOAA. It's accurate to about 0.1°.
- **Govee:** https://developer.govee.com (`openapi.api.govee.com/router/api/v1`)
- **Improv Wi-Fi Serial:** https://www.improv-wifi.com/serial/
- **ESP Web Tools 10.4.0:** https://esphome.github.io/esp-web-tools/
- **Fonts:**
  - Cormorant Garamond, by Christian Thalmann (SIL OFL)
  - Inter (SIL OFL)
- **QR codes:** `qrcode-generator` 1.4.4 by Kazuhiko Arase (MIT), vendored in `web/vendor/`.

---

## Maintenance

Every version is pinned:

- npm packages, via `package-lock.json` and exact versions
- the PlatformIO platform and libraries
- the ESP Web Tools URL
- the GitHub Actions, by major version

The things most likely to need a touch in a few years:

- **Claude model ID:** `worker/src/check.ts` uses `claude-opus-5-5`. If Anthropic retires it, the check quietly falls back to simple rules and logs an alert. Then update the ID.
- **Open-Meteo field names:** these are in `worker/src/weather.ts`.
- **Root certificates:** these are in `firmware/lib/atlantico/root_cas.h`. They're valid to 2035–2036.

Local commands:

| Command | Does |
|---|---|
| `npm run demo` / `npm run sim` | everything locally, simulated devices |
| `npm test` | renderer and sun tests |
| `npm run check` | type-check the Worker |
| `npm run deploy` | deploy the Worker and push |
| `npm run restore` | load an encrypted backup into D1 |
| `node scripts/build-font.mjs` | regenerate e-ink font outlines (only if you change fonts) |
