export interface Env {
  STATE: KVNamespace;
  DB: D1Database;
  SIMULATE: string;
  LAT: string;
  LON: string;
  PANEL_SIZES: string; // e.g. "800x480,1600x1200"
  PAGES_ORIGIN: string; // where the static site lives, for CORS
  SITE_URL?: string;    // the site itself (…github.io/atlantico): firmware updates come from here
  OWNER_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GOVEE_API_KEY?: string;
}
