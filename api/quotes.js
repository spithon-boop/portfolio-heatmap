export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SHEET_ID = "1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo";

  try {
    // Use Google Sheets JSON API — much cleaner than CSV, no parsing issues
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Cartera`;
    const res2 = await fetch(url);
    if (!res2.ok) throw new Error(`Google Sheets error ${res2.status}`);

    // Google wraps JSON in /*O_o*/google.visualization.Query.setResponse({...});
    const raw  = await res2.text();
    const json = JSON.parse(raw.replace(/^[^{]*/, "").replace(/\);?\s*$/, ""));
    const rows = json?.table?.rows || [];
    const cols = json?.table?.cols || [];

    // Find column indices by label
    const colIdx = {};
    cols.forEach((c, i) => {
      const lbl = (c.label || "").trim().toUpperCase();
      colIdx[lbl] = i;
    });

    // Expected columns: TICKER, ACCIONES, PRECIO MEDIO, PRECIO ACTUAL, VALOR ACTUAL, ...
    const iSym   = colIdx["TICKER"]        ?? 0;
    const iShr   = colIdx["ACCIONES"]      ?? 1;
    const iAvg   = colIdx["PRECIO MEDIO"]  ?? 2;
    const iPrice = colIdx["PRECIO ACTUAL"] ?? 3;
    const iVal   = colIdx["VALOR ACTUAL"]  ?? 4;

    const holdings = [];
    for (const row of rows) {
      const cells  = row.c || [];
      const ticker = cells[iSym]?.v;
      if (!ticker || ticker === "TICKER" || ticker === "TOTAL") continue;

      const shares = numVal(cells[iShr]);
      const avg    = numVal(cells[iAvg]);
      const price  = numVal(cells[iPrice]);
      const value  = numVal(cells[iVal]) || shares * price;

      if (shares > 0 && avg > 0 && price > 0) {
        holdings.push({ symbol: ticker, shares, avgCost: avg, price, value });
      }
    }

    if (!holdings.length) throw new Error("No se encontraron posiciones con datos completos");
    return res.status(200).json({ holdings });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Extract numeric value from Google Visualization cell
function numVal(cell) {
  if (!cell) return 0;
  if (typeof cell.v === "number") return cell.v;
  if (typeof cell.v === "string") return parseFloat(cell.v.replace(/[^0-9.-]/g, "")) || 0;
  return 0;
}
