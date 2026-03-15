export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const SHEET_ID = "1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo";

  try {
    // 1. Get positions from Google Sheets (shares + avg cost only)
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Cartera`;
    const sheetRes = await fetch(sheetUrl);
    if (!sheetRes.ok) throw new Error(`Google Sheets error ${sheetRes.status}`);
    const csv = await sheetRes.text();
    const positions = parseCarteraCSV(csv);
    if (!positions.length) throw new Error("No se encontraron posiciones");

    // 2. Get ALL market data from Yahoo Finance (price, 1D change, 52w)
    const symbols = positions.map(p => p.symbol).join(",");
    const quotes  = await fetchYahoo(symbols);

    // 3. Merge — price always from Yahoo, never from Sheet
    const holdings = positions.map(p => {
      const q      = quotes[p.symbol] || {};
      const price  = q.price || p.avgCost; // fallback to avg cost if Yahoo fails
      const value  = p.shares * price;
      return {
        symbol:    p.symbol,
        shares:    p.shares,
        avgCost:   p.avgCost,
        price,
        value,
        chg1d:     q.changePercent ?? null,
        chg1dVal:  q.change != null ? q.change * p.shares : null,
        week52High: q.week52High ?? null,
        week52Low:  q.week52Low  ?? null,
      };
    }).filter(h => h.value > 0);

    return res.status(200).json({ holdings });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Parse Sheet CSV — only extract ticker, shares, avgCost ────────────────────
function parseCarteraCSV(csv) {
  const lines = csv.trim().split("\n").filter(l => l.trim());
  const positions = [];
  for (const line of lines) {
    const cols   = parseCSVLine(line);
    const ticker = cols[0]?.replace(/"/g, "").trim();
    if (!ticker || ticker === "TICKER" || ticker === "TOTAL" ||
        ticker.startsWith("PORTFOLIO") || ticker.startsWith("Precios")) continue;
    const shares  = parseEuNum(cols[1]);
    const avgCost = parseEuNum(cols[2]);
    if (shares > 0 && avgCost > 0 && ticker.length > 0) {
      positions.push({ symbol: ticker, shares, avgCost });
    }
  }
  return positions;
}

// Parse European or US number format robustly
function parseEuNum(raw) {
  if (!raw) return 0;
  let s = raw.replace(/"/g, "").replace(/[$\s]/g, "").trim();
  if (!s) return 0;
  // Remove thousand separators: if both . and , present
  if (s.includes(".") && s.includes(",")) {
    // Determine which is decimal: last one wins
    const lastDot   = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastComma > lastDot) {
      // European: 1.234,56
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // US: 1,234.56
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // Only comma — could be decimal (EU) or thousands (rare)
    // If more than one comma, it's thousands separator
    const commas = (s.match(/,/g) || []).length;
    if (commas > 1) {
      s = s.replace(/,/g, "");
    } else {
      // Single comma — check if it looks like decimal (e.g. 154,49)
      const afterComma = s.split(",")[1] || "";
      if (afterComma.length <= 2) {
        s = s.replace(",", "."); // treat as decimal
      } else {
        s = s.replace(",", ""); // treat as thousands
      }
    }
  }
  return parseFloat(s) || 0;
}

function parseCSVLine(line) {
  const result = [];
  let current = "", inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

// ── Yahoo Finance ─────────────────────────────────────────────────────────────
async function fetchYahoo(symbols) {
  const map = {};
  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Referer": "https://finance.yahoo.com/",
      },
    });
    if (!res.ok) return map;
    const data = await res.json();
    (data?.quoteResponse?.result || []).forEach(q => {
      map[q.symbol] = {
        price:         q.regularMarketPrice,
        change:        q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        week52High:    q.fiftyTwoWeekHigh,
        week52Low:     q.fiftyTwoWeekLow,
      };
    });
  } catch {}
  return map;
}
