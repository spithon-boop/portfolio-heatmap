export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SHEET_ID = "1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo";

  try {
    // Fetch Cartera sheet (gid=0)
    const cartUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Cartera`;
    const cartRes = await fetch(cartUrl);
    if (!cartRes.ok) throw new Error(`Google Sheets error ${cartRes.status}`);
    const cartCSV = await cartRes.text();

    const holdings = parseCarteraCSV(cartCSV);
    return res.status(200).json({ holdings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function parseCarteraCSV(csv) {
  const lines = csv.trim().split("\n").filter(l => l.trim());
  const holdings = [];

  for (const line of lines) {
    const cols = parseCSVLine(line);
    if (!cols[0]) continue;

    const ticker = cols[0].replace(/"/g, "").trim();
    // Skip header rows and total row
    if (!ticker || ticker === "TICKER" || ticker === "TOTAL" ||
        ticker.startsWith("PORTFOLIO") || ticker.startsWith("Precios")) continue;

    const shares   = parseFloat(cols[1]?.replace(/"/g, "").replace(",", ".")) || 0;
    const avgCost  = parseFloat(cols[2]?.replace(/"/g, "").replace(/[$,]/g, "").replace(",", ".")) || 0;
    const curPrice = parseFloat(cols[3]?.replace(/"/g, "").replace(/[$,]/g, "").replace(",", ".")) || 0;

    if (shares > 0 && ticker.length > 0) {
      holdings.push({
        symbol:   ticker,
        shares,
        avgCost,
        price:    curPrice,
        value:    shares * curPrice,
      });
    }
  }
  return holdings;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
