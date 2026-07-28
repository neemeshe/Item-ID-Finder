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
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { items: [], updatedAt: null };
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8');
}

let store = loadData();

// ---------------- search logic (same rules as the Claude Artifact / standalone HTML versions) ----------------
function normalize(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function tokenize(s) { return normalize(s).split(' ').filter(Boolean); }
function withinEditDistance1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    edits++;
    if (edits > 1) return false;
    if (la === lb) { i++; j++; } else if (la > lb) { i++; } else { j++; }
  }
  if (i < la || j < lb) edits++;
  return edits <= 1;
}
function runSearch(items, rawQuery) {
  const q = normalize(rawQuery);
  if (!q) return [];
  const qTokens = tokenize(rawQuery);
  const scored = [];
  for (const item of items) {
    const idNorm = normalize(item.id);
    const nameNorm = normalize(item.name);
    const text = normalize([item.id, item.name, item.description, item.category, item.uom].join(' '));
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
          if (Math.abs(t.length - qt.length) <= 1 && withinEditDistance1(qt, t)) { hit = true; break; }
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
  res.json({ count: store.items.length, updatedAt: store.updatedAt });
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toString();
  res.json({ results: runSearch(store.items, q) });
});

// Admin: verify password only (used by the admin page to unlock the upload UI)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) res.json({ ok: true });
  else res.status(401).json({ ok: false, error: 'Incorrect password' });
});

// Admin: replace the item list. Expects { password, items: [{id,name,description,category,uom,sheet}] }
app.post('/api/admin/save', (req, res) => {
  const { password, items } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ ok: false, error: 'Incorrect password' });
  if (!Array.isArray(items)) return res.status(400).json({ ok: false, error: 'items must be an array' });

  const cleaned = items
    .map(it => ({
      id: String(it.id || '').trim(),
      name: String(it.name || '').trim(),
      description: String(it.description || '').trim(),
      category: String(it.category || '').trim(),
      uom: String(it.uom || '').trim(),
      sheet: String(it.sheet || '').trim(),
    }))
    .filter(it => it.id);

  store = { items: cleaned, updatedAt: new Date().toISOString() };
  saveData(store);
  res.json({ ok: true, count: cleaned.length, updatedAt: store.updatedAt });
});

app.listen(PORT, () => {
  console.log(`Item ID Finder running on port ${PORT}`);
});
