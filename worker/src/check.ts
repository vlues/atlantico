// Daily plant check: Claude reads a week of history and writes one dry line per plant.
// Only lines marked `attention` become alerts (and Telegram messages).
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env';
import { listPlants, type Plant } from './plants';
import { now, logAlert } from './util';

interface Line { id: string; line: string; attention: boolean }

const SYSTEM = `You look after four plants in a flat in Fuentebravía, El Puerto de Santa María (Cádiz, Spain).
Each morning you get a week of sensor history per plant: soil moisture (%), temperature (°C), reservoir level (%), and waterings.
Write exactly one line per plant: at most 14 words, plain, dry, adult. No emoji, no exclamation marks, no cheerleading.
Set attention=true only when a person should do something: reservoir under 20%; moisture stuck below the plant's threshold despite waterings (pump, tube or sensor fault); moisture staying above 65% for days (overwatering or drainage); temperature outside the plant's limits; readings that are implausible or missing for more than a day.
When nothing needs doing, say so briefly and set attention=false.`;

const SCHEMA = {
  type: 'object',
  properties: {
    plants: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, line: { type: 'string' }, attention: { type: 'boolean' } },
        required: ['id', 'line', 'attention'],
        additionalProperties: false,
      },
    },
  },
  required: ['plants'],
  additionalProperties: false,
};

async function summarize(env: Env, p: Plant) {
  const since = now() - 7 * 86400000;
  const days = await env.DB.prepare(`SELECT date(ts / 1000, 'unixepoch') AS day,
      ROUND(MIN(moisture), 1) AS m_min, ROUND(MAX(moisture), 1) AS m_max,
      ROUND(MIN(temp), 1) AS t_min, ROUND(MAX(temp), 1) AS t_max, ROUND(MIN(reservoir)) AS res, COUNT(*) AS n
    FROM readings WHERE plant_id = ? AND ts > ? GROUP BY day ORDER BY day`).bind(p.id, since).all();
  const water = await env.DB.prepare(`SELECT date(ts / 1000, 'unixepoch') AS day, ml, source FROM waterings
    WHERE plant_id = ? AND ts > ? ORDER BY ts`).bind(p.id, since).all();
  const latest = await env.DB.prepare('SELECT ts, moisture, temp, reservoir FROM readings WHERE plant_id = ? ORDER BY ts DESC LIMIT 1').bind(p.id).first<any>();
  return {
    id: p.id, name: p.name, species: p.species,
    rules: { waterBelow: p.rules.waterBelow, tempMin: p.rules.tempMin, tempMax: p.rules.tempMax, doseMl: p.rules.doseMl },
    latest: latest && { ...latest, hoursAgo: Math.round((now() - latest.ts) / 3600000) },
    days: days.results, waterings: water.results,
  };
}

/** Rule-based lines, used when there is no Claude key or the call fails. */
function plainLines(data: Awaited<ReturnType<typeof summarize>>[]): Line[] {
  return data.map((d) => {
    const l = d.latest;
    if (!l || l.hoursAgo > 26) return { id: d.id, line: 'No readings for over a day. Check the node.', attention: true };
    if (l.reservoir != null && l.reservoir < 20) return { id: d.id, line: `Reservoir at ${Math.round(l.reservoir)}%. Refill soon.`, attention: true };
    if (l.temp != null && (l.temp < d.rules.tempMin || l.temp > d.rules.tempMax)) return { id: d.id, line: `${l.temp} °C is outside its comfortable range.`, attention: true };
    return { id: d.id, line: `Moisture ${Math.round(l.moisture)}%, ${d.waterings.length} watering${d.waterings.length === 1 ? '' : 's'} this week. Fine.`, attention: false };
  });
}

export async function dailyCheck(env: Env): Promise<{ lines: Line[]; via: string }> {
  const plants = await listPlants(env);
  const data = await Promise.all(plants.map((p) => summarize(env, p)));
  let lines: Line[] | null = null;
  let via = 'rules';
  if (env.ANTHROPIC_API_KEY) {
    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const res: any = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: `Today is ${new Date().toISOString().slice(0, 10)}.\n${JSON.stringify(data)}` }],
      } as any);
      if (res.stop_reason !== 'refusal') {
        const text = res.content.find((b: any) => b.type === 'text')?.text ?? '';
        const parsed = JSON.parse(text) as { plants: Line[] };
        lines = parsed.plants.filter((l) => plants.some((p) => p.id === l.id));
        via = 'claude';
      }
    } catch (err) {
      console.error('claude check failed', err);
      await logAlert(env, 'system', null, `Plant check fell back to simple rules (${String(err).slice(0, 100)}).`, 1);
    }
  }
  lines ??= plainLines(data);

  const attention: string[] = [];
  for (const l of lines) {
    const p = plants.find((x) => x.id === l.id)!;
    await env.DB.prepare('UPDATE plants SET last_check = ? WHERE id = ?').bind(l.line, l.id).run();
    if (l.attention) attention.push(`${p.name}: ${l.line}`);
  }
  if (attention.length) {
    const sent = await telegram(env, `Atlántico · plants\n${attention.join('\n')}`);
    for (const a of attention) await logAlert(env, 'plant', a.split(':')[0], a, sent ? 1 : 0);
  }
  await env.STATE.put('check:last', JSON.stringify({ at: now(), via }));
  return { lines, via };
}

export async function telegram(env: Env, text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
    });
    return r.ok;
  } catch { return false; }
}
