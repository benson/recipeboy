export function parseDuration(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const text = String(value || '').trim();
  if (!text) return 0;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Math.round(Number(text)));

  const iso = text.match(/^P(?:([\d.]+)D)?(?:T(?:([\d.]+)H)?(?:([\d.]+)M)?)?$/i);
  if (iso) return Math.max(0, Math.round((Number(iso[1] || 0) * 1440) + (Number(iso[2] || 0) * 60) + Number(iso[3] || 0)));

  const clock = text.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (clock) return (Number(clock[1]) * 60) + Number(clock[2]);

  let minutes = 0;
  let matched = false;
  const units = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m)\b/gi;
  for (const match of text.matchAll(units)) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    minutes += unit.startsWith('d') ? amount * 1440 : unit.startsWith('h') ? amount * 60 : amount;
    matched = true;
  }

  const lower = text.toLowerCase();
  if (/\b(?:an?|one)\s+hour\b/.test(lower) && !/\bhalf\s+(?:an?\s+)?hour\b/.test(lower)) {
    minutes += 60;
    matched = true;
  }
  if (/\b(?:half\s+(?:an?\s+)?hour|hour\s+and\s+a\s+half)\b/.test(lower)) {
    minutes += 30;
    matched = true;
  }
  if (/\bquarter\s+(?:of\s+)?(?:an?\s+)?hour\b/.test(lower)) {
    minutes += 15;
    matched = true;
  }

  return matched ? Math.max(0, Math.round(minutes)) : 0;
}

export function formatDuration(value) {
  const minutes = parseDuration(value);
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}
