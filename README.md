# Atlántico

A quiet smart-apartment system for a flat in Fuentebravía (El Puerto de Santa María, Cádiz).

- **The wall piece.** Fine lines drawn from the real sea outside: swell, wind, tide, sun, moon, clouds and rain. It shows on any screen and on an e-ink frame.
  - **A new edition every day.** Each midnight (Cádiz time) brings a numbered edition, such as *Nº 12 · Bandas · lunes 19 de octubre*. Each one has:
    - its own drawing style, one of seven:
      - *Líneas*;
      - *Puntos* (stipple);
      - *Bandas* (the swell as bands of light);
      - *Horizonte* (a few long lines under a big sky);
      - *Trazo* (calligraphic);
      - *Relieve* (ridgelines, nearer waves hiding the ones behind, like a mountain-range print);
      - *Contornos* (the bay as a topographic map);
    - its own palette, horizon height and grain.
    - Consecutive days never share a style or a palette.
  - **Day and night.** The wall follows the real sky: paper by day, night after sunset.
    - By day the sun hides the stars, as in life. Guests who are here are **sails on the bay** instead, heeling with the real wind, and a few gulls drift across.
    - At dusk the sails go in as the stars come out.
    - A daytime arrival is a wake crossing the bay and a sail being hoisted; a night arrival is a shooting star.
  - **Every guest is their own.**
    - Boats come in five kinds (sloop, catamaran, lateen *falucho*, schooner, gaff cutter), each with its own pennant. The mainsail changes each visit: stripes, their visit number, an emblem, or plain.
    - Stars come in six kinds (sparkle, diffraction cross, six-point, ringed, binary pair, haloed), each twinkling at its own pace. Regulars grow extra rays and a halo.
  - **Physics of the water and the air.**
    - Boats ride the real swell: they pitch along the slope of the wave beneath them, heel with the wind and roll in time with the wave period.
    - Stars twinkle more in wind and low over the horizon, and a guest's star lays a faint reflection on the waves.
    - Everything moves smoothly and always drifts back to its place.
  - **Guests never quite leave.**
    - By night their sparkle settles into their quiet star, which stays on the wall.
    - By day their boat sails out of the bay and its gold fades to white. From then on it's one of the small white sails that pass by far out, a few at a time.
    - Deleted guests do vanish, since that is what deleting asks for.
  - **Surprises, never the same twice.**
    - The Worker rolls real random dice (`crypto.getRandomValues`) every 15 minutes, from 08:00 to midnight. That's about five big surprises a day (more with guests here) and small ones most hours, each at a random moment.
    - Every screen in the house plays the same surprise at the same instant.
    - Each surprise is grown from a random seed:
      - one to three elements (dolphins, a whale, a four-masted ship, a regatta, starlings, a diving gull, flying fish, kites, balloons, a sun pillar, a rainbow, meteors, a comet, fireworks with reflections, sky lanterns, the lighthouse, an aurora, jellyfish, glowing waves, a moonbow, a new constellation named after a guest who is here, a message in a bottle, a golden wave);
      - each with its own count, path, depth, speed, size, colour and timing;
      - plus how the sea and sky answer, a melody (mode, key, tempo, timbre), a light pattern for the lamps, and a name, such as *Delfines y un cometa · Dolphins and a comet*.
    - **Demo → Surprises** plays one now (random, small, or led by any element).
  - **The sky is live.**
    - The moon appears with its real phase and position, and lights a path on the water at night.
    - Weather is drawn like an engraving's sky, and drifts with the real wind:
      - fair days get wisps of cirrus;
      - building cloud gets billowing cumulus with shaded bases;
      - overcast is a hatched grey ceiling;
      - rain falls in slanting curtains from the clouds and rings the water where it lands.
    - The captions add sea temperature, the tide (rising or falling, and when the next high or low water is) and the moon.
- **Guest arrival.** Guests tap an NFC tag or scan a QR code and type their first name. Each guest gets their own star in the sky of the wall piece, and the lights go to Hosting. They also get the Wi-Fi.
  - **On arrival:** for 30 seconds, every screen plays the arrival. A shooting star lands on the guest's star, it ignites and reflects on the sea, and their name appears with a personal line. A first visit reads *tu estrella, desde hoy · llegas con levante*; a return reads *tercera visita · la anterior, hace 12 días*.
  - **Remembering guests:** the guest's phone remembers them. Next time, tapping the tag is the whole check-in, with no typing and no buttons.
  - **While they're here:** for six hours after they tap in, their star sparkles in gold. Their first name curves around it, with a small *aquí · here*, and sways slowly at its own pace (different for every star, every day). Regulars' stars burn slightly brighter.
  - **Arriving together:** people who tap in close together share one welcome: *Bienvenidos · Welcome, everyone*, all their names, and *dos estrellas nuevas · una que vuelve*.
    - Every star gets its own entrance, a beat apart.
    - The sea opens a clearing for the names, so the arriving stars stay in view.
    - Someone joining a welcome that is already playing doesn't restart it for the others.
  - **Spanish first, English beneath,** on the wall and on the phone.
  - **Tap in, tap out.** Tapping the door tag again on the way out, 45 minutes or more into a stay, says goodbye.
    - The guest's phone shows *Hasta pronto*, with a one-tap *Me quedo* undo. The wall shows the goodbye too.
    - When the last guest leaves, lights that guests switched to Hosting go back to Auto.
    - Guests who don't tap out stop shining after six hours.
  - **Music, no sign-in.** After checking in, guests can add songs to the room from their phone:
    - search, or paste a link from Spotify, Apple Music or YouTube (it's matched to the same song on Spotify);
    - or press *Sorpréndeme* for five songs, chosen by Claude, that follow what's playing.
    - When a guest's song comes on, the wall shows *La canción de Ana* (and whose is next), their star pulses, and the lamps by the wall breathe once. The guest's phone says it's theirs, and vibrates on Android.
    - Each guest can have up to three songs waiting.
  - **The first-arrival tour.** After checking in, the guest's phone tells the story of the flat, one stop per screen: the sea, their star, the day's drawing, the real sky, the plants and the light.
    - As each stop scrolls into view, the wall shows it too. The sea gets callouts, their star pulses, all five styles pass by, and the moon is circled.
    - The lamps near what's being described brighten while the rest dim. For the light stop, the whole room goes from noon to dusk.
    - Sound is opt-in, with one tap: surf and soft chimes on the phone, and an arrival chime on the wall once someone has tapped it.
    - The lamps return to the scene on their own about 30 seconds after the last stop.
    - If several guests tour at once, the first one leads the wall and lamps, and the others still get the full story on their phones.
- **Light scenes.** Hosting, Evening, Focus and Off, plus Auto, which follows sunrise and sunset. A simulator runs today, and Govee bulbs connect with just an API key.
- **Plants.** There are four: an olive tree, a *Strelitzia nicolai*, a snake plant and a ZZ plant. Each has its own watering rules. Claude checks them every morning and writes one dry line per plant. You only hear about it, via Telegram, when something needs you.
- **Control page.** Owner only. It shows everything above, plus devices and alerts. You sign in once per browser, and it stays signed in.
- **Updates itself.**
  - Push a change and the Worker, site and firmware rebuild.
  - Wall screens reload themselves when a new version is published.
  - Panels and plant nodes install new firmware on their own, checking once a day.

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
- show every daily style on the wall in turn, preview any of the next week's editions, or force one style
- play the guest tour on the wall and lamps, stop by stop
- "ring the bell" as a guest (a name already on the wall, such as Lucía, arrives as a returning guest)
- dry out a plant, or empty or refill a reservoir
- fast-forward the plants a day or a week
- run the Claude plant check on demand
- knock a simulated device offline

The preview above it switches between the browser view, the black-and-white e-ink bitmap and the 6-colour bitmap.

### Live data or simulated?

- **The sea, wind, tide, sea temperature, clouds and rain are always live.** They come from Open-Meteo, including in demo mode, unless you pick a sea state in the Demo panel. The next high or low water is found from the hourly sea-level forecast.
- **The sun and moon are always computed locally** from the date and the flat's coordinates. They're never fetched.
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

The page starts with **What to get**: a checklist with search links. Ticks are remembered in that browser.
- **Start here** needs no tools: the Seeed XIAO 7.5″ ePaper Panel, Govee bulbs, NFC stickers and chargers.
- **Plants:** essentials (sensor, pump, switch, reservoir) and optional extras (temperature, reservoir level). They connect with jumper wires and screw terminals, so no soldering.

Each device then takes three steps:
1. Plug it in.
2. Press **Install** and pick your Wi-Fi.
3. Close the window. **It pairs itself.**

### Wall panel (e-ink)

1. Pick **Wall panel** and the board, either the Seeed XIAO 7.5″ or the 7.3″ Spectra 6 colour panel.
2. Choose the power option:
   - **USB:** welcomes appear within about 20 seconds.
   - **Battery:** the panel updates every 15 minutes.
3. Plug the board into the Mac with a USB-C **data** cable and press **Install**. The page flashes the firmware, then asks for your Wi-Fi (this is Improv Wi-Fi).
4. Close the install window. The page sends a one-time code over the same cable by itself, because Chrome remembers the port it just flashed. The panel contacts the Worker and gets its own token, and the simulated panel disappears from the device list. If nothing happens, press **Pair**.

If Wi-Fi drops, the panel keeps showing the last image. E-paper needs no power to hold a picture.

**Firmware updates are automatic.**
- Once a day, each panel and plant node asks the Worker whether a newer build exists.
- If one does, the device downloads it, checks its MD5, installs it and restarts.
- A failed or interrupted download leaves the old firmware running.
- Builds are numbered by the GitHub Actions run that made them. The control page shows each device's version.

### Screen (TV, tablet or monitor)

This is the full-colour, moving version of the wall. Nothing is flashed.

1. On the screen, open `…/atlantico/wall`. Scan the QR on **Add device → Screen** with a tablet, or type the address into a TV's browser.
2. A small card in its corner shows a **4-digit code** and a QR code.
3. Scan that QR with your phone and press **Add screen**, or type the code on Add device. The card changes to *Conectada*.

From then on the screen:
- checks in every five minutes and shows in **Devices** (screens that are switched off never raise offline alerts);
- keeps the display awake;
- **dims or goes dark from 00:30 to 07:00**, except during arrivals, the tour and guests' songs;
- with **OLED care** on, drifts the picture a few pixels now and then so the captions can't burn in.

Change the night setting and OLED care per screen in **Devices**; the screen picks it up within seconds.

**What looks best:**

| | Pick | Why | Holds it, no screws |
|---|---|---|---|
| **Just Atlántico, big** | A matte art TV (**Hisense CanvasTV 55″** or The Frame) with a **Raspberry Pi 5** behind it, about $90 | The TV only ever shows the wall. It starts on power-up, comes back by itself, and the Pi switches the TV off at night and on in the morning (HDMI-CEC). | A **floor easel stand** rated 35 kg+, or a **floor-to-ceiling tension pole** (Neomounts FPMA-CF200: 37–70″, 30 kg) against a solid ceiling. |
| Best for Atlántico | **TCL NXTPAPER 14** (≈ 760 g) or **NXTPAPER 11** (≈ 500 g), about $170–350 | A matte, paper-like screen: no reflections, and the light palettes read like print. | A slim case plus **4 pairs of Command Large picture-hanging strips**. They're rated 16 lb (≈ 7 kg) for four pairs, about ten times the tablet. Or a **tabletop easel stand** on a shelf. |
| The big statement | **Hisense CanvasTV** (best value), **Samsung The Frame** (most polished), **TCL NXTFRAME** | A matte art TV at 55″ and up. Atlántico runs in its web browser, not its Art Mode. | A **floor easel stand** rated 35 kg or more for 43–65″ (VIVO, ECOTINY or KONIC, about $100), or Samsung's Studio Stand. A 55″ CanvasTV weighs about 18 kg, so **never use adhesive**. |
| Deepest night sky | Any **OLED** tablet or TV | True black, so only the lines and stars glow. | As above, by weight. Turn on OLED care. |
| Already have one | Any iPad, tablet, TV or laptop | It works today. Glossy screens reflect; a matte screen protector helps. | A stand, or strips for a light tablet. |

**Walls:**
- Adhesive strips need **smooth, painted walls**. Don't use them on **gotelé** (the textured plaster in many Spanish flats), wallpaper, brick, or paint less than a week old. Use a stand there.
- Put the strips on a case or frame, never on the tablet itself.
- Keep any load well under the rating.
- Floor easels: stand them against a wall, out of the way, and skip anti-tip straps that need a screw.

**A Raspberry Pi behind a TV (the dedicated screen):**
1. Put Raspberry Pi OS (with desktop) on a microSD card with **Raspberry Pi Imager**, setting your Wi-Fi and a user there.
2. Plug the Pi into the TV, open Terminal on it, and paste the line shown on **Add device → Screen**: `curl -fsSL https://vlues.github.io/atlantico/kiosk.sh | bash`.
3. It sets up the following, then reboots:
   - automatic login;
   - the wall full screen with sound, restarted by itself if it ever closes;
   - no screen blanking;
   - optionally, TV off 00:30–07:00 (turn on HDMI-CEC in the TV: Anynet+ on Samsung, CEC on Hisense, T-Link on TCL).
4. The wall shows a 4-digit code. Scan it with your phone to add the screen.

**Keeping it on:**
- **iPad:** Add to Home Screen, then use Guided Access and set Auto-Lock to Never.
- **Android:** use **Fully Kiosk Browser** (Start URL, Keep screen on, Launch on boot).
- **Smart TV:** use its browser, and turn off Auto Power Off, the sleep timer and the screen saver.

### Plant node

These steps are the same as for the panel. The difference is that you choose **which plant** the node waters.

- Every 20 minutes the node wakes, reports soil moisture, temperature and reservoir level, waters if the Worker says so, and goes back to sleep.
- **If Wi-Fi or the internet is down,** it keeps watering by the last rules it was given, which are stored on the device.
- **If the moisture sensor looks broken,** it falls back to "every N days".
- There is always a daily maximum and a 60-second pump cap.
- **Calibrate once:** in the plant's *Rules*, set "Pump ml/s". Run the pump for 10 seconds into a measuring jug and divide the volume by 10.

### Lights (Govee)

1. In the Govee Home app, go to *Profile › Settings › Apply for API Key*. The key arrives by email.
2. On **Add device → Lights**, paste the key and press **Find bulbs**. Tick the ones you want and say where each one is (by the wall, by the plants, by the sofa or elsewhere). Then press **Use these bulbs**.
   - The guest tour uses those positions. You can change them later under **Control → Light → Where each lamp is**.
   - Lamps are only sent what changed, because Govee allows a few requests per bulb per minute.

Adding another brand means writing one small adapter object in `worker/src/lights.ts` that implements `LightAdapter`'s `list()` and `set()`.

### Guests: NFC tag and QR code

- Write the guest page URL with `?door` on the end (`…/hola?door`) to an NFC sticker as a **URL record**, using an app such as *NFC Tools*. Print the same URL as a QR code for phones without NFC.
  - `?door` is what makes tapping out work. Opening the page any other way, for example from history to see the Wi-Fi again, never signs anyone out.

#### How arriving and leaving work

- **Arriving:**
  - The first time, a guest taps the tag (or scans the code) and types their first name. Their phone remembers them from then on.
  - Every visit after that, tapping the tag *is* the check-in, with no typing and no buttons.
  - If the phone has forgotten them, typing the same name finds their star again.
- **Being here:** for six hours after a tap, their star shines gold with their name. The guest tour and the music section are open to them.
- **Leaving:** they can tap the tag on the way out (after 45 minutes or more), or simply go; their star stops shining after six hours. You can also end a visit from **Control → Guests**.
- **Nothing tracks phones in the background.** There's no location, no Wi-Fi sniffing and no Bluetooth. Only the tap.
- **What to set up:** the sticker by the door, the Wi-Fi details under **Control → Guests**, and, if you want music, **Control → Music** once.
- **Returning guests** (all automatic, nothing to answer):
  - The guest's phone keeps a small key. Opening the page on that phone checks them in by itself.
  - If the phone has forgotten them (Safari clears site data after about a week without a visit), they type their first name and it joins their existing star.
    - The exception is when a guest with that name is in the flat right now; then it's someone else, who gets their own star.
    - If a phone is shared, a quiet "¿No eres…? · Not …?" link on the page switches person.
  - Tapping in again within the same six-hour stay doesn't count as a new visit. A reload or second tap within two minutes doesn't replay the welcome.
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
| Hanging | Command picture-hanging strips, large: 16 lb (≈ 7 kg) per 4 pairs, smooth painted walls only (not gotelé or wallpaper). The panel is far lighter. | 10–15 |
| *or* screen (colour, motion) | **TCL NXTPAPER 14** matte tablet + slim case, or a matte art TV on a floor easel stand. See [Screen](#screen-tv-tablet-or-monitor). | 170–350 |
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

- **Waves, tide and sea temperature:** Open-Meteo Marine API, `https://marine-api.open-meteo.com/v1/marine`.
  - Current fields: `wave_height`, `wave_period`, `wave_direction`, `sea_level_height_msl` (tide relative to mean sea level) and `sea_surface_temperature`.
  - Hourly field: `sea_level_height_msl`, for the next high and low water.
  - Docs: https://open-meteo.com/en/docs/marine-weather-api
- **Wind, clouds and rain:** Open-Meteo Forecast API, `https://api.open-meteo.com/v1/forecast`. Fields: `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `temperature_2m`, `cloud_cover` and `precipitation`. Docs: https://open-meteo.com/en/docs
- **Sun position:** computed locally in `web/lib/sun.js`, using a low-precision solar ephemeris from the Astronomical Almanac / NOAA. It's accurate to about 0.1°.
- **Moon position and phase:** computed locally in `web/lib/moon.js`, using low-precision lunar theory (Meeus). It's accurate to about a degree, and was checked against the 8 April 2024 eclipse new moon and the 23 April 2024 full moon.
- **Govee:** https://developer.govee.com (`openapi.api.govee.com/router/api/v1`)
- **Improv Wi-Fi Serial:** https://www.improv-wifi.com/serial/
- **ESP Web Tools 10.4.0:** https://esphome.github.io/esp-web-tools/
- **Fonts:**
  - Cormorant Garamond, by Christian Thalmann (SIL OFL)
  - Inter (SIL OFL)
- **QR codes:** `qrcode-generator` 1.4.4 by Kazuhiko Arase (MIT), vendored in `web/vendor/`.

---

### Signing in

- **The passcode is typed once per browser.**
  - The control page swaps the passcode for a session that the browser keeps. The session lasts a year after it was last used, and survives passcode changes.
  - **Control → Signed in** lists every browser that's signed in.
  - **Sign out everywhere** ends every session at once. Use it if a phone is lost, or after changing the passcode because it leaked.
- **Add it to the home screen.** On iPhone: Share › Add to Home Screen.
  - The control page then opens like an app.
  - Home-screen apps keep their storage, while Safari tabs lose site data after about a week without a visit. So this is what keeps an iPhone signed in for good.
  - The wall installs the same way and opens full screen, which suits a tablet on the wall.

### Music (Spotify, once)

You need **Spotify Premium** on the account that plays in the flat, and any Spotify Connect speaker (Sonos, Echo, a TV, or the Mac itself).

1. Go to **Control → Music** and follow its three steps:
   - create a free app at developer.spotify.com and tick **Web API**;
   - paste the redirect URI the page shows;
   - paste the app's Client ID and Client secret, then press **Connect Spotify** and approve.
2. Optionally press **Choose the room's speaker**. Guests' songs then start there when nothing is playing.

**Guests:**
- Guests never sign in. Their songs join your queue.
- Apple Music has no way for a website to queue songs on a speaker, so Apple Music links are matched to the same song on Spotify.
- Without a Claude key, *Sorpréndeme* suggests more by the artist that's playing.
- Spotify's development mode only needs the owner's account. Search returns at most 10 results (Spotify's 2026 limit), and this uses 5.

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
