export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SHEET_ID = "1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo";

  try {
    const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Cartera`;
    const r    = await fetch(url);
    if (!r.ok) throw new Error(`Sheets error ${r.status}`);
    const raw  = await r.text();
    const json = JSON.parse(raw.replace(/^[^{]*/, "").replace(/\);?\s*$/, ""));

    const rows = json?.table?.rows || [];
    const cols = json?.table?.cols || [];

    // Log column names for debugging
    const colLabels = cols.map((c,i) => ({ i, label: c.label }));

    // Find columns by label (case insensitive)
    const find = (...names) => {
      for (const name of names) {
        const idx = cols.findIndex(c => (c.label||"").trim().toLowerCase().includes(name.toLowerCase()));
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const iSym   = find("ticker", "symbol");
    const iShr   = find("acciones", "shares", "quantity");
    const iAvg   = find("precio medio", "avg cost", "purchase", "coste");
    const iPrice = find("precio actual", "current price", "price");

    // Return debug info if columns not found
    if (iSym === -1 || iShr === -1) {
      return res.status(200).json({ 
        debug: true, 
        columns: colLabels,
        sample: rows.slice(0,3).map(r => r.c?.map(c => c?.v))
      });
    }

    const holdings = [];
    for (const row of rows) {
      const c      = row.c || [];
      const ticker = c[iSym]?.v;
      if (!ticker || typeof ticker !== "string") continue;
      const t = ticker.trim();
      if (!t || t === "TICKER" || t === "TOTAL" || t.startsWith("PORTFOLIO") || t.startsWith("Precios")) continue;

      const shares = toNum(c[iShr]);
      const avg    = toNum(c[iAvg]);
      const price  = iPrice !== -1 ? toNum(c[iPrice]) : 0;

      // Sanity check: price should be within 20x of avgCost
      // If price looks wrong (e.g. 100x avgCost), fall back to avgCost
      const safePrice = (price > 0 && price < avg * 20 && price > avg / 20) ? price : avg;

      if (shares > 0 && avg > 0) {
        holdings.push({
          symbol:  t,
          shares,
          avgCost: avg,
          price:   safePrice,
          value:   shares * safePrice,
        });
      }
    }

    if (!holdings.length) {
      return res.status(200).json({ 
        debug: true, 
        message: "No holdings found",
        columns: colLabels,
        rowCount: rows.length
      });
    }

    return res.status(200).json({ holdings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function toNum(cell) {
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  if (typeof cell.v === "string") {
    return parseFloat(cell.v.replace(/[^0-9.-]/g, "")) || 0;
  }
  return 0;
}
