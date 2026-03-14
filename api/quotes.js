export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const symbols = req.query.symbols || "";
  if (!symbols.trim()) {
    return res.status(400).json({ error: "symbols param required" });
  }

  try {
    const encoded = encodeURIComponent(symbols.trim());
    const url =
      `https://query1.finance.yahoo.com/v7/finance/quote` +
      `?symbols=${encoded}` +
      `&fields=regularMarketPrice,regularMarketChangePercent,` +
      `regularMarketChange,shortName,regularMarketVolume,` +
      `fiftyTwoWeekHigh,fiftyTwoWeekLow`;

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance responded with ${response.status}`);
    }

    const data = await response.json();
    const results = data?.quoteResponse?.result || [];

    const quotes = results.map((q) => ({
      symbol:        q.symbol,
      shortName:     q.shortName || q.symbol,
      price:         q.regularMarketPrice,
      change:        q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
      volume:        q.regularMarketVolume,
      week52High:    q.fiftyTwoWeekHigh,
      week52Low:     q.fiftyTwoWeekLow,
    }));

    return res.status(200).json({ quotes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
