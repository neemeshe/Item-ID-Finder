const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme'; // set this in your hosting provider's dashboard, not here
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- data store ----------------
// NOTE: this stores data as a JSON file on local disk. On some free hosting tiers,
// local disk is NOT guaranteed to persist across restarts/redeploys. Test this by
// saving data, letting the service go idle, then reloading before you rely on it —
// see README.md for how to switch to a real database if you need stronger guarantees.
const COUNTRIES = ['Philippines', 'India'];

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.updatedByCountry) parsed.updatedByCountry = { Philippines: parsed.updatedAt || null, India: null };
    if (!Array.isArray(parsed.items)) parsed.items = [];
    return parsed;
  } catch (e) {
    return { items: [], updatedByCountry: { Philippines: null, India: null } };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

let store = loadData();

// ---------------- search logic (same rules as the Claude Artifact / standalone HTML versions) ----------------
function normalize(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokenize(s) { return normalize(s).split(' ').filter(Boolean); }
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}
function fuzzyTokenMatch(qt, t) {
  if (qt.length < 4 || t.length < 4) return qt === t;
  // (1) whole-word typo tolerance — substitutions/transpositions/single drops in similar-length words
  const wholeThreshold = Math.max(1, Math.round(Math.max(qt.length, t.length) / 3));
  if (levenshtein(qt, t) <= wholeThreshold) return true;
  // (2) truncated-prefix tolerance — handles someone stopping partway through typing a longer word
  // (e.g. "stok" for "stockinette") without inflating the "distance" just because the word is long
  if (t.length > qt.length) {
    const window = t.slice(0, Math.min(t.length, qt.length + 1));
    const prefixThreshold = Math.max(1, Math.floor(qt.length / 4));
    if (levenshtein(qt, window) <= prefixThreshold) return true;
  }
  return false;
}
function runSearch(items, rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return [];
  const qTokens = tokenize(rawQuery);
  const scored = [];
  for (const item of items) {
    const idNorm = normalize(item.id);
    const nameNorm = normalize(item.name);
    const text = normalize([item.id, item.name, item.description, item.category, item.uom, item.costCenter].join(' '));
    let score = 0, tag = '';
    if (idNorm === q) { score = 1000; tag = 'Exact ID match'; }
    else if (q.length >= 3 && idNorm.includes(q)) { score += 200; tag = 'ID contains query'; }
    let hits = 0;
    for (const t of qTokens) {
      if (t.length < 2) continue;
      if (nameNorm.includes(t)) { score += 15; hits++; }
      else if (text.includes(t)) { score += 7; hits++; }
    }
    if (!tag && hits > 0) tag = hits === qTokens.length ? 'Strong match' : 'Partial match';
    if (score > 0) scored.push({ ...item, _score: score, _tag: tag });
  }
  if (scored.length < 3) {
    const already = new Set(scored.map(s => s.id + '|' + s.name));
    for (const item of items) {
      const key = item.id + '|' + item.name;
      if (already.has(key)) continue;
      const tokens = tokenize([item.id, item.name, item.description].join(' '));
      let hit = false;
      for (const qt of qTokens) {
        if (qt.length < 4) continue;
        for (const t of tokens) {
          if (fuzzyTokenMatch(qt, t)) { hit = true; break; }
        }
        if (hit) break;
      }
      if (hit) scored.push({ ...item, _score: 5, _tag: 'Possible match (typo?)' });
    }
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, 30);
}

// ---------------- API ----------------
app.get('/api/status', (req, res) => {
  const country = (req.query.country || '').toString();
  if (country && COUNTRIES.includes(country)) {
    const count = store.items.filter(it => it.country === country).length;
    res.json({ count, updatedAt: store.updatedByCountry[country] || null, scope: country });
  } else {
    res.json({
      count: store.items.length,
      updatedAt: null,
      scope: 'all',
      byCountry: COUNTRIES.map(c => ({
        country: c,
        count: store.items.filter(it => it.country === c).length,
        updatedAt: store.updatedByCountry[c] || null,
      })),
    });
  }
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toString();
  const country = (req.query.country || '').toString();
  const pool = (country && COUNTRIES.includes(country)) ? store.items.filter(it => it.country === country) : store.items;
  res.json({ results: runSearch(pool, q) });
});

// Admin: verify password only (used by the admin page to unlock the upload UI)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) res.json({ ok: true, countries: COUNTRIES });
  else res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// Admin: replace ONLY the given country's items, leaving the other country's data untouched.
// Expects { password, country, items: [{id,name,description,category,uom,sheet}] }
app.post('/api/admin/save', (req, res) => {
  const { password, country, items } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Incorrect password' });
  if (!COUNTRIES.includes(country)) return res.status(400).json({ ok: false, error: `country must be one of: ${COUNTRIES.join(', ')}` });
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'items must be an array' });

  const cleaned = items
    .map(it => ({
      id: String(it.id || '').trim(),
      name: String(it.name || '').trim(),
      description: String(it.description || '').trim(),
      category: String(it.category || '').trim(),
      uom: String(it.uom || '').trim(),
      costCenter: String(it.costCenter || '').trim(),
      sheet: String(it.sheet || '').trim(),
      country,
    }))
    .filter(it => it.id);

  const nowIso = new Date().toISOString();
  // keep every item NOT belonging to this country, replace this country's items with the new batch
  store.items = store.items.filter(it => it.country !== country).concat(cleaned);
  store.updatedByCountry[country] = nowIso;
  saveData(store);
  res.json({ ok: true, count: cleaned.length, updatedAt: nowIso, country });
});

app.listen(PORT, () => {
  console.log(`Item ID Finder running on port ${PORT}`);
});
