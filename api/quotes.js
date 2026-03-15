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

    // Find column indices by label
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
    const iPrice = find("precio actual");
    const iVal   = find("valor actual");

    const holdings = [];
    for (const row of rows) {
      const c      = row.c || [];
      const ticker = c[iSym]?.v;
      if (!ticker || typeof ticker !== "string") continue;
      const t = ticker.trim();
      if (!t || t === "TICKER" || t === "TOTAL" || t.startsWith("PORTFOLIO") || t.startsWith("Precios")) continue;

      const shares = toNum(c[iShr]);
      const avg    = toNum(c[iAvg]);
      const price  = toNum(c[iPrice]);
      const value  = toNum(c[iVal]) || (shares * price);

      if (shares > 0 && avg > 0 && price > 0) {
        holdings.push({ symbol: t, shares, avgCost: avg, price, value });
      }
    }

    if (!holdings.length) throw new Error("No se encontraron posiciones. Columnas: " + cols.map(c=>c.label).join(", "));

    return res.status(200).json({ holdings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Google Visualization API returns numbers as actual JS numbers — no parsing needed
// But formatted values (f) use locale format. Always use .v (raw value) not .f
function toNum(cell) {
  if (!cell) return 0;
  // .v is always the raw numeric value from Google — use it directly
  if (typeof cell.v === "number") return cell.v;
  // Fallback: parse formatted string (cell.f) removing currency symbols
  // Google uses locale format e.g. "$322,16" (ES) or "$322.16" (EN)
  const s = String(cell.f || cell.v || "").replace(/[^0-9.,\-]/g, "").trim();
  if (!s) return 0;
  // Detect format: if last separator is comma and only 2 digits after → EU decimal
  const lastComma = s.lastIndexOf(",");
  const lastDot   = s.lastIndexOf(".");
  if (lastComma > lastDot && s.length - lastComma === 3) {
    // EU format: 1.234,56
    return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  }
  if (lastDot > lastComma && s.length - lastDot === 3) {
    // US format: 1,234.56 — but could also be 1.234 (no decimals)
    return parseFloat(s.replace(/,/g, "")) || 0;
  }
  // Single separator — if comma, treat as decimal
  if (lastComma !== -1 && lastDot === -1) {
    return parseFloat(s.replace(",", ".")) || 0;
  }
  return parseFloat(s.replace(/,/g, "")) || 0;
}
