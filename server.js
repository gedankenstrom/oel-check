const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');

const app = express();
app.use(bodyParser.json());

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
