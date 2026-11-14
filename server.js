const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '16kb' }));

const authUsername = process.env.AUTH_USERNAME;
const authPassword = process.env.AUTH_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const cookieSecure = process.env.SESSION_COOKIE_SECURE === 'true';
const sessionCookieName = 'oil_tracker_session';
const sessionDurationMs = 8 * 60 * 60 * 1000;

if (!authUsername || !authPassword || !sessionSecret || sessionSecret.length < 32) {
  console.error('AUTH_USERNAME, AUTH_PASSWORD und SESSION_SECRET (mindestens 32 Zeichen) müssen gesetzt sein.');
  process.exit(1);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signSession(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function readSessionCookie(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookie = cookieHeader.split(';').map(value => value.trim()).find(value => value.startsWith(`${sessionCookieName}=`));
  if (!cookie) return false;

  try {
    const token = decodeURIComponent(cookie.slice(sessionCookieName.length + 1));
    const separator = token.lastIndexOf('.');
    if (separator < 1) return false;

    const payload = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    if (!safeEqual(signature, signSession(payload))) return false;

    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(session.exp) && session.exp > Date.now();
  } catch {
    return false;
  }
}

function setSessionCookie(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + sessionDurationMs })).toString('base64url');
  const token = `${payload}.${signSession(payload)}`;
  const secure = cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secure}`);
}

function clearSessionCookie(res) {
  const secure = cookieSecure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

const loginAttempts = new Map();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 10;

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: readSessionCookie(req) });
});

app.post('/api/login', (req, res) => {
  const now = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const attempt = loginAttempts.get(clientIp);

  if (attempt && now - attempt.startedAt < loginWindowMs && attempt.count >= maxLoginAttempts) {
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
  }

  const { username, password } = req.body || {};
  if (!safeEqual(username || '', authUsername) || !safeEqual(password || '', authPassword)) {
    const current = attempt && now - attempt.startedAt < loginWindowMs
      ? attempt
      : { startedAt: now, count: 0 };
    current.count += 1;
    loginAttempts.set(clientIp, current);
    return res.status(401).json({ error: 'Benutzername oder Passwort ist nicht korrekt.' });
  }

  loginAttempts.delete(clientIp);
  setSessionCookie(res);
  res.json({ authenticated: true });
});

app.post('/api/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

app.use('/api', (req, res, next) => {
  if (!readSessionCookie(req)) {
    return res.status(401).json({ error: 'Bitte anmelden.' });
  }
  next();
});

const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'data.json');
fs.ensureDirSync(dataDir);
if (!fs.existsSync(dataFile)) fs.writeJsonSync(dataFile, []);

// ---------------- HILFSFUNKTIONEN ---------------------

function calculateCumulative(entries, currentKm, addedOil, oilChange) {
  if (oilChange) return "0.00";
  if (entries.length === 0) return "-";

  let lastOilChangeIndex = entries.map(e => e.oilChange).lastIndexOf(true);
  if (lastOilChangeIndex === -1) lastOilChangeIndex = 0;

  const kmSinceChange = currentKm - entries[lastOilChangeIndex].km;

  const oilSum =
    entries
      .slice(lastOilChangeIndex + 1)
      .reduce((sum, e) => sum + (e.oilChange ? 0 : e.oil), 0)
    + addedOil;

  if (kmSinceChange <= 0) return "-";

  return ((oilSum / kmSinceChange) * 1000).toFixed(2);
}

function calculateSegment(entries, currentKm, addedOil, oilChange) {
  if (entries.length === 0) return "-";
  if (oilChange) return "-";

  const last = entries[entries.length - 1];
  const kmDiff = currentKm - last.km;

  if (kmDiff <= 0) return "-";

  return ((addedOil / kmDiff) * 1000).toFixed(2);
}

// ---------------- API: ENTRIES LADEN -------------------

app.get('/api/entries', async (req, res) => {
  try {
    const entries = await fs.readJson(dataFile);
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Daten" });
  }
});

// ---------------- API: EINTRAG HINZUFÜGEN -------------

app.post('/api/entries', async (req, res) => {
  try {
    const { date, km, oil = 0, coolant = false, oilChange = false } = req.body;
    let entries = await fs.readJson(dataFile);

    if (!date || !km) {
      return res.status(400).json({ error: "Datum und KM erforderlich" });
    }

    let kmDriven = entries.length > 0 ? km - entries[entries.length - 1].km : "-";

    let oilAmount = oilChange ? 5000 : oil;

    const oilPer1000Cumulative = calculateCumulative(entries, km, oil, oilChange);
    const oilPer1000Segment = calculateSegment(entries, km, oil, oilChange);

    const entry = {
      id: Date.now(),
      date,
      km,
      kmDriven,
      oil: oilAmount,
      coolant,
      oilChange,
      oilPer1000Cumulative,
      oilPer1000Segment
    };

    entries.push(entry);
    await fs.writeJson(dataFile, entries, { spaces: 2 });

    res.json(entry);

  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern" });
  }
});

// ---------------- API: EINTRAG LÖSCHEN -----------------

app.delete('/api/entries/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let entries = await fs.readJson(dataFile);

    const filtered = entries.filter(e => e.id !== id);

    if (filtered.length === entries.length)
      return res.status(404).json({ error: "Eintrag nicht gefunden" });

    await fs.writeJson(dataFile, filtered, { spaces: 2 });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ---------------- API: AUTOMATISCHE REPARATUR ---------

app.get('/api/repair', async (req, res) => {
  try {
    let entries = await fs.readJson(dataFile);
    if (entries.length === 0) {
      return res.json({ success: true, message: "Keine Einträge vorhanden" });
    }

    entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      if (i === 0) e.kmDriven = "-";
      else e.kmDriven = e.km - entries[i - 1].km;

      const addedOil = e.oilChange ? 5000 : e.oil;

      e.oilPer1000Cumulative = calculateCumulative(entries.slice(0, i), e.km, addedOil, e.oilChange);
      e.oilPer1000Segment = calculateSegment(entries.slice(0, i), e.km, addedOil, e.oilChange);
    }

    await fs.writeJson(dataFile, entries, { spaces: 2 });

    res.json({ success: true, message: "Alle Werte repariert & neu berechnet." });

  } catch (err) {
    res.status(500).json({ error: "Reparatur fehlgeschlagen" });
  }
});

// ---------------- CSV EXPORT --------------------------

app.get('/api/export/csv', async (req, res) => {
  try {
    const entries = await fs.readJson(dataFile);

    let csv = "Datum,KM,Gefahren,Oil,Coolant,OilChange,Cumulative,Segment\n";

    entries.forEach(e => {
      csv += `${e.date},${e.km},${e.kmDriven},${e.oil},${e.coolant},${e.oilChange},${e.oilPer1000Cumulative},${e.oilPer1000Segment}\n`;
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.send(csv);

  } catch (err) {
    res.status(500).json({ error: "CSV Fehler" });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Öl-Tracker läuft auf Port ${port}`));
