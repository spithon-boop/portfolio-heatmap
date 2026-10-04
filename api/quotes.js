export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SHEET_ID = "1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo";

  // currency param: "EUR" (default) or "USD"
  const currency = (req.query.currency || "EUR").toUpperCase();

  try {
    const url  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Cartera`;
    const r    = await fetch(url);
    if (!r.ok) throw new Error(`Sheets error ${r.status}`);
    const raw  = await r.text();
    const json = JSON.parse(raw.replace(/^[^{]*/, "").replace(/\);?\s*$/, ""));

    const rows = json?.table?.rows || [];
    const cols = json?.table?.cols || [];

    const find = (...names) => {
      for (const name of names) {
        const idx = cols.findIndex(c =>
          (c.label||"").trim().toLowerCase().includes(name.toLowerCase())
        );
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const iSym   = find("ticker");
    const iShr   = find("acciones");
    const iAvg   = find("precio medio");
    const iPrice = find("precio actual");   // already in EUR from Sheet
    const iVal   = find("valor actual");    // already in EUR from Sheet
    const iCost  = find("coste total");     // already in EUR from Sheet
    const iDiv   = find("divisa");          // new column N
    const iFX    = find("fx");              // new column O (FX→EUR rate)
    const i1d    = find("chg1d");
    const i1w    = find("chg1w");
    const i1m    = find("chg1m");
    const iYtd   = find("chgytd");

    // Get live EURUSD rate for USD display mode
    let eurUsd = 1.08; // fallback
    if (currency === "USD") {
      try {
        const fxUrl = "https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Cartera&tq=select%20O%20limit%201";
        // Use a simple approximation — the Sheet already has FX rates
        // We'll read it from the holdings data itself
        eurUsd = 1.08;
      } catch (_) {}
    }

    const holdings = [];
    for (const row of rows) {
      const c      = row.c || [];
      const ticker = c[iSym]?.v;
      if (!ticker || typeof ticker !== "string") continue;
      const t = ticker.trim();
      if (!t || t === "TICKER" || t === "TOTAL" || t.startsWith("PORTFOLIO") || t.startsWith("Precios")) continue;

      const shares   = toNum(c[iShr]);
      const avgEUR   = toNum(c[iAvg]);   // precio medio en divisa original
      const priceEUR = toNum(c[iPrice]); // precio actual ya en EUR
      const valueEUR = toNum(c[iVal]);   // valor actual en EUR
      const costEUR  = toNum(c[iCost]);  // coste total en EUR
      const divisa   = c[iDiv]?.v || "USD";
      const fx       = toNum(c[iFX]) || 1; // tasa EUR: 1 si EUR, ~1.08 si USD

      if (shares > 0 && avgEUR > 0 && priceEUR > 0) {
        // Convert to requested currency if needed
        const rate = currency === "USD" ? (1 / fx || 1.08) : 1;

        const toChg = (cell) => {
          const v = toNum(cell);
          if (v === 0) return null;
          return Math.abs(v) < 1 ? v * 100 : v;
        };

        holdings.push({
          symbol:   t,
          shares,
          avgCost:  avgEUR * rate,
          price:    priceEUR * rate,
          value:    valueEUR * rate,
          cost:     costEUR * rate,
          divisa,
          currency,
          chg1d:    i1d  !== -1 ? toChg(c[i1d])  : null,
          chg1w:    i1w  !== -1 ? toChg(c[i1w])  : null,
          chg1m:    i1m  !== -1 ? toChg(c[i1m])  : null,
          chgYtd:   iYtd !== -1 ? toChg(c[iYtd]) : null,
        });
      }
    }

    if (!holdings.length) throw new Error("No se encontraron posiciones. Columnas: " + cols.map(c=>c.label).join(", "));

    return res.status(200).json({ holdings, currency });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function toNum(cell) {
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  const s = String(cell.f || cell.v || "").replace(/[^0-9.,\-]/g, "").trim();
  if (!s) return 0;
  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");
  if (lastComma > lastDot && s.length - lastComma === 3) {
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (lastDot > lastComma && s.length - lastDot === 3) {
    return parseFloat(s.replace(/,/g, "")) || 0;
  }
  if (lastComma !== -1 && lastDot === -1) {
    return parseFloat(s.replace(",", ".")) || 0;
  }
  return parseFloat(s.replace(/,/g, "")) || 0;
}
