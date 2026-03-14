from http.server import BaseHTTPRequestHandler
import json
import urllib.request
import urllib.parse

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        # Parse query params
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        symbols = params.get("symbols", [""])[0]

        if not symbols:
            self._send(400, {"error": "symbols param required"})
            return

        try:
            data = fetch_quotes(symbols)
            self._send(200, data)
        except Exception as e:
            self._send(500, {"error": str(e)})

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, body):
        self.send_response(code)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def log_message(self, format, *args):
        pass  # suppress logs


def fetch_quotes(symbols_str):
    """Fetch quotes from Yahoo Finance v8 API"""
    symbols = [s.strip().upper() for s in symbols_str.split(",") if s.strip()]
    symbols_encoded = urllib.parse.quote(",".join(symbols))

    url = (
        f"https://query1.finance.yahoo.com/v8/finance/spark"
        f"?symbols={symbols_encoded}&range=1d&interval=1d"
    )

    # Also fetch quote details
    quote_url = (
        f"https://query1.finance.yahoo.com/v7/finance/quote"
        f"?symbols={symbols_encoded}"
        f"&fields=regularMarketPrice,regularMarketChangePercent,"
        f"regularMarketChange,shortName,longName,regularMarketVolume,"
        f"marketCap,fiftyTwoWeekHigh,fiftyTwoWeekLow,"
        f"regularMarketDayHigh,regularMarketDayLow"
    )

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
    }

    req = urllib.request.Request(quote_url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as resp:
        raw = json.loads(resp.read().decode())

    results = raw.get("quoteResponse", {}).get("result", [])

    quotes = []
    for q in results:
        quotes.append({
            "symbol": q.get("symbol"),
            "shortName": q.get("shortName") or q.get("longName") or q.get("symbol"),
            "price": q.get("regularMarketPrice"),
            "change": q.get("regularMarketChange"),
            "changePercent": q.get("regularMarketChangePercent"),
            "volume": q.get("regularMarketVolume"),
            "marketCap": q.get("marketCap"),
            "dayHigh": q.get("regularMarketDayHigh"),
            "dayLow": q.get("regularMarketDayLow"),
            "week52High": q.get("fiftyTwoWeekHigh"),
            "week52Low": q.get("fiftyTwoWeekLow"),
        })

    return {"quotes": quotes}
