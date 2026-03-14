export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const symbols = req.query.symbols || "";
  if (!symbols.trim()) return res.status(400).json({ error: "symbols param required" });

  try {
    const quotes = await fetchWithFallback(symbols.trim());
    return res.status(200).json({ quotes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function fetchWithFallback(symbols) {
  // Try v7 endpoint first, then v8 as fallback
  const endpoints = [
    `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,shortName,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow&corsDomain=finance.yahoo.com&crumb=`,
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange,shortName,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow`,
  ];

  const agents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  ];

  let lastError = null;
  for (let i = 0; i < endpoints.length; i++) {
    try {
      const response = await fetch(endpoints[i], {
        headers: {
          "User-Agent": agents[i % agents.length],
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Origin": "https://finance.yahoo.com",
          "Referer": "https://finance.yahoo.com/",
          "Cache-Control": "no-cache",
        },
      });

      if (response.status === 429) {
        lastError = new Error("Yahoo Finance rate limit (429). Intenta en unos segundos.");
        continue;
      }
      if (!response.ok) {
        lastError = new Error(`Yahoo Finance error ${response.status}`);
        continue;
      }

      const data = await response.json();
      const results = data?.quoteResponse?.result || [];
      return results.map((q) => ({
        symbol:        q.symbol,
        shortName:     q.shortName || q.symbol,
        price:         q.regularMarketPrice,
        change:        q.regularMarketChange,
        changePercent: q.regularMarketChangePercent,
        volume:        q.regularMarketVolume,
        week52High:    q.fiftyTwoWeekHigh,
        week52Low:     q.fiftyTwoWeekLow,
      }));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("No se pudo conectar con Yahoo Finance");
}
