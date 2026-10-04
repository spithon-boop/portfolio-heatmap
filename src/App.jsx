import { useState, useEffect, useCallback, useRef } from "react";

/* ─────────────────────────  Treemap (squarified)  ───────────────────────── */
function buildTreemap(items, W, H) {
  if (!items.length || W <= 0 || H <= 0) return [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return [];
  const nodes = items.map(i => ({ ...i, area: (i.value / total) * W * H }));
  return squarify(nodes, 0, 0, W, H);
}

function squarify(nodes, x, y, w, h) {
  if (!nodes.length) return [];
  if (nodes.length === 1) return [{ ...nodes[0], x, y, w, h }];
  const results = [];
  let rem = [...nodes], rx = x, ry = y, rw = w, rh = h;
  while (rem.length > 0) {
    if (rem.length === 1) { results.push({ ...rem[0], x: rx, y: ry, w: rw, h: rh }); break; }
    const row = []; let rowA = 0, prev = Infinity;
    const side = Math.min(rw, rh);
    for (let i = 0; i < rem.length; i++) {
      row.push(rem[i]); rowA += rem[i].area;
      const mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area));
      const ratio = Math.max((side * side * mx) / (rowA * rowA), (rowA * rowA) / (side * side * mn));
      if (ratio > prev && i > 0) { row.pop(); rowA -= rem[i].area; break; }
      prev = ratio;
    }
    rem = rem.slice(row.length);
    const rA = row.reduce((s, r) => s + r.area, 0);
    if (rw >= rh) {
      const cw = rA / rh; let cy = ry;
      row.forEach(r => { const ch = (r.area / rA) * rh; results.push({ ...r, x: rx, y: cy, w: cw, h: ch }); cy += ch; });
      rx += cw; rw -= cw;
    } else {
      const rh2 = rA / rw; let cx = rx;
      row.forEach(r => { const cw2 = (r.area / rA) * rw; results.push({ ...r, x: cx, y: ry, w: cw2, h: rh2 }); cx += cw2; });
      ry += rh2; rh -= rh2;
    }
    if (rw < 0.5 || rh < 0.5) break;
  }
  return results;
}

const PAL = {
  up:   ["#64AE62", "#4A8A4B", "#1F4B22"],
  down: ["#9C4B4F", "#883B3F", "#6A2528"],
  flat: "#3C4043",
  dotUp: "#8FE28F",
  dotDown: "#F7A6A9",
};
const FLOOR = { total: 5, "1d": 0.5, "1w": 1.5, "1m": 3, ytd: 5 };

function makeColorScale(values, metricKey) {
  const floor = FLOOR[metricKey] ?? 1;
  const maxUp = Math.max(floor, ...values.filter(v => v > 0));
  const maxDn = Math.max(floor, ...values.filter(v => v < 0).map(Math.abs));
  return pct => {
    if (pct == null || Math.abs(pct) < 0.005) return PAL.flat;
    const t = Math.abs(pct) / (pct > 0 ? maxUp : maxDn);
    const step = t < 0.18 ? 0 : t < 0.66 ? 1 : 2;
    return (pct > 0 ? PAL.up : PAL.down)[step];
  };
}

const NAMES = {
  NVDA: "NVIDIA", META: "Meta Platforms", MSFT: "Microsoft", GOOGL: "Alphabet", GOOG: "Alphabet",
  AAPL: "Apple", AMZN: "Amazon", TSLA: "Tesla", CRWD: "CrowdStrike", DDOG: "Datadog",
  SNDK: "SanDisk", AVGO: "Broadcom", VST: "Vistra", "BRK.B": "Berkshire Hathaway",
  "BRK-B": "Berkshire Hathaway", LLY: "Eli Lilly", SPCX: "SPAC & New Issue ETF", AMD: "AMD",
  NFLX: "Netflix", PLTR: "Palantir", TSM: "TSMC", ASML: "ASML", V: "Visa", MA: "Mastercard",
  JPM: "JPMorgan Chase", COST: "Costco", NOW: "ServiceNow", ORCL: "Oracle", CRM: "Salesforce",
  ADBE: "Adobe", INTC: "Intel", MU: "Micron", UBER: "Uber", SHOP: "Shopify", NET: "Cloudflare",
  SNOW: "Snowflake", PANW: "Palo Alto Networks", ANET: "Arista Networks", CEG: "Constellation Energy",
  IBKR: "Interactive Brokers", HOOD: "Robinhood", COIN: "Coinbase", MSTR: "Strategy",
  NVO: "Novo Nordisk", UNH: "UnitedHealth", WMT: "Walmart", KO: "Coca-Cola", PEP: "PepsiCo",
};
const cleanSym = s => String(s || "").replace(/^[A-Z]+:/, "").trim();
const displaySym = s => cleanSym(s).replace(/-(?=[A-Z]$)/, ".");
const nameOf = s => NAMES[displaySym(s)] || NAMES[cleanSym(s)] || "";
const logoUrl = s => `https://financialmodelingprep.com/image-stock/${displaySym(s).replace(".", "-")}.png`;
const initials = s => {
  const n = nameOf(s);
  if (n) { const p = n.split(/\s+/); return (p[0][0] + (p[1]?.[0] || "")).toUpperCase(); }
  return displaySym(s).slice(0, 2);
};

/* ─────────────────────────  Formato con divisa  ───────────────────────── */
const fmtPct = v => `${(v || 0) >= 0 ? "+" : ""}${(v || 0).toFixed(2)}%`;
const fmtMoney = (v, cur) => {
  const sym = cur === "USD" ? "$" : "€";
  return `${sym}${Math.abs(v || 0).toLocaleString("es", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtK = (v, cur) => {
  const sym = cur === "USD" ? "$" : "€";
  const a = Math.abs(v || 0);
  const s = (v || 0) >= 0 ? "+" : "-";
  return `${s}${sym}${a.toLocaleString("es", { maximumFractionDigits: 0 })}`;
};
const pnlCol = v => (v || 0) >= 0 ? "#8FE28F" : "#F7A6A9";

const METRICS = [
  { key: "1d",    label: "Hoy",       pctKey: "chg1d",  adj: "diaria" },
  { key: "1w",    label: "1 semana",  pctKey: "chg1w",  adj: "semanal" },
  { key: "1m",    label: "1 mes",     pctKey: "chg1m",  adj: "mensual" },
  { key: "ytd",   label: "YTD",       pctKey: "chgYtd", adj: "del año" },
  { key: "total", label: "P&L total", pctKey: "pnlPct", adj: "total" },
];

const C = {
  bg: "#131314", card: "#1E1F20", text: "#E3E3E3", dim: "#C4C7C5", faint: "#8E918F",
  line: "#444746", chipOn: "#004A77", chipOnTxt: "#C2E7FF", accent: "#A8C7FA",
};
const GAP = 8;

/* ─────────────────────────  App  ───────────────────────── */
export default function App() {
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [metric, setMetric] = useState("1d");
  const [dispMode, setDispMode] = useState("pct");
  const [currency, setCurrency] = useState("EUR"); // EUR | USD
  const [hidden, setHidden] = useState(false);
  const [sz, setSz] = useState({ w: 360, h: 500 });
  const mapRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const calcH = (w) => {
      // iPhone 15: 852px alto lógico. Queremos que el mapa llene la pantalla
      // cuando solo se ve el mapa (header+resumen+chips han subido fuera).
      // El mapa está dentro de .card con padding 18px top + 14px bottom = 32px.
      // Solo restamos ese padding interno del card.
      const vh = window.innerHeight;
      return vh - 32;
    };
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const w = Math.floor(e.contentRect.width);
        setSz({ w, h: calcH(w) });
      }
    });
    if (mapRef.current) obs.observe(mapRef.current);
    return () => obs.disconnect();
  }, []);

  const fetchData = useCallback(async (cur) => {
    const activeCur = cur || currency;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/quotes?currency=${activeCur}`);
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHoldings(data.holdings || []);
      setLastUpdated(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [currency]);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(() => fetchData(), 120000);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // Refetch when currency changes
  const toggleCurrency = () => {
    const next = currency === "EUR" ? "USD" : "EUR";
    setCurrency(next);
    fetchData(next);
  };

  const items = holdings.filter(h => h.value > 0).map(h => {
    const cost = h.cost ?? h.shares * h.avgCost;
    const pnl = h.value - cost;
    const pnlPct = cost > 0 ? ((h.value - cost) / cost) * 100 : 0;
    return { ...h, cost, pnl, pnlPct };
  }).sort((a, b) => b.value - a.value);

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalCost  = items.reduce((s, i) => s + i.cost, 0);
  const totalPnL   = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const cur = METRICS.find(m => m.key === metric);
  const pctOf = c => c[cur.pctKey] ?? null;
  const colorOf = makeColorScale(items.map(pctOf).filter(v => v != null), metric);
  const dispOf = c => {
    const p = pctOf(c);
    if (p == null) return "—";
    return dispMode === "pct" ? fmtPct(p) : fmtK((p / 100) * c.value, currency);
  };

  const cells = buildTreemap(items, sz.w + GAP, sz.h + GAP).map(c => ({
    ...c, x: c.x, y: c.y,
    w: Math.max(0, c.w - GAP), h: Math.max(0, c.h - GAP),
  }));

  const withData = items.filter(i => pctOf(i) != null);
  const wVal = withData.reduce((s, i) => s + i.value, 0);
  const avg = wVal ? withData.reduce((s, i) => s + i.value * pctOf(i), 0) / wVal : null;
  const ups = withData.filter(i => pctOf(i) > 0).length;
  const downs = withData.filter(i => pctOf(i) < 0).length;
  const best = [...withData].sort((a, b) => pctOf(b) - pctOf(a))[0];
  const worst = [...withData].sort((a, b) => pctOf(a) - pctOf(b))[0];
  const mood = avg == null ? "" : (ups && downs)
    ? `mixta con una tendencia ligeramente ${avg >= 0 ? "positiva" : "negativa"}`
    : avg >= 0 ? "positiva" : "negativa";

  const curSym = currency === "EUR" ? "€" : "$";

  return (
    <div className="app">
      <style>{CSS}</style>

      {/* Top bar */}
      <header className="top">
        <div className="brand"><b>Portfolio</b> <span>Map</span></div>
        <div className="actions">
          {/* Botón EUR/USD */}
          <button className="curbtn" onClick={toggleCurrency} title="Cambiar divisa">
            {currency === "EUR" ? "€ EUR" : "$ USD"}
          </button>
          <button className={`icon${loading ? " spin" : ""}`} onClick={() => fetchData()} aria-label="Refrescar">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
          </button>
          <a className="icon" href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo" target="_blank" rel="noreferrer" aria-label="Google Sheets">
            <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z"/></svg>
          </a>
          <div className="avatar">S</div>
        </div>
      </header>

      {/* Resumen */}
      {items.length > 0 && (
        <div className="summary">
          <div className="sumrow">
            <div className="total">{hidden ? "••••••" : fmtMoney(totalValue, currency)}</div>
            <button className="eyebtn" onClick={() => setHidden(h => !h)} aria-label={hidden ? "Mostrar" : "Ocultar"}>
              {hidden ? (
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11.83 9L15 12.16V12a3 3 0 0 0-3-3zm-4.3.8L9 12.06a3 3 0 0 0 3 2.94c.18 0 .36-.01.53-.05l1.37 1.37A5 5 0 0 1 12 17a5 5 0 0 1-5-5c0-.83.21-1.61.58-2.3m-4.6-3.52L4.27 7.5C3.08 8.45 2.08 9.64 1.35 11c1.56 2.73 4.65 4.7 8.65 4.7.92 0 1.82-.1 2.66-.29L14.7 17.44A10 10 0 0 1 10 18.7C4.67 18.7 1.17 15.4.18 11a10 10 0 0 1 2.75-4.72M10 5.3c5.33 0 8.83 3.3 9.82 7.7a10 10 0 0 1-3.73 5.72l-1.5-1.5A7.9 7.9 0 0 0 17.65 13C16.14 10.27 13.05 8.3 9.05 8.3c-.73 0-1.43.08-2.1.23L5.12 6.72A10 10 0 0 1 10 5.3m0 0"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>
              )}
            </button>
          </div>
          <div className="pnl" style={{ color: hidden ? C.faint : pnlCol(totalPnL) }}>
            {hidden ? "•••••• (••••)" : `${totalPnL >= 0 ? "▲" : "▼"} ${totalPnL >= 0 ? "+" : "-"}${fmtMoney(totalPnL, currency)} (${fmtPct(totalPnLPct)})`}
            <span className="muted"> · {items.length} posiciones{lastUpdated ? ` · ${lastUpdated.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          </div>
        </div>
      )}

      {/* Chips */}
      {items.length > 0 && (
        <div className="chips">
          <div className="chiprow">
            {METRICS.map(m => (
              <button key={m.key} className={`chip${metric === m.key ? " on" : ""}`} onClick={() => setMetric(m.key)}>
                {metric === m.key && <span className="check">✓</span>}{m.label}
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={dispMode === "pct" ? "on" : ""} onClick={() => setDispMode("pct")}>%</button>
            <button className={dispMode === "usd" ? "on" : ""} onClick={() => setDispMode("usd")}>{curSym}</button>
          </div>
        </div>
      )}

      {error && <div className="err">⚠ {error}</div>}

      {/* Heatmap */}
      <section className="card">
        <div ref={mapRef} className="map" style={{ height: sz.h }}>
          {loading && items.length === 0 ? (
            <div className="loading"><div className="spinner" /></div>
          ) : cells.map(cell => {
            const p = pctOf(cell);
            const { w, h } = cell;
            const tiny = w < 46 || h < 40;
            const small = !tiny && (w < 96 || h < 74);
            const showName = !small && !tiny && w >= 130 && h >= 110 && nameOf(cell.symbol);
            const logoTop = !small && !tiny && w >= 150 && h >= 90;
            const logoBottom = !logoTop && !small && !tiny && h >= 150 && w >= 80;
            const showDot = !tiny && w >= 112;
            const r = Math.min(18, w / 4, h / 4);
            return (
              <button key={cell.symbol} className="tile"
                style={{ left: cell.x, top: cell.y, width: w, height: h, background: colorOf(p), borderRadius: r }}
                onClick={() => setDetail(cell)}>
                {!tiny && (
                  <div className={`tinfo${small ? " sm" : ""}`} style={{ paddingRight: logoTop ? 60 : undefined }}>
                    <div className="tk">{displaySym(cell.symbol)}</div>
                    {showName && <div className="nm">{nameOf(cell.symbol)}</div>}
                    <div className="pc">
                      <span>{dispOf(cell)}</span>
                      {showDot && p != null && <i className="dot" style={{ background: p >= 0 ? PAL.dotUp : PAL.dotDown }} />}
                    </div>
                  </div>
                )}
                {tiny && w >= 28 && h >= 18 && <div className="tk xs">{displaySym(cell.symbol)}</div>}
                {(logoTop || logoBottom) && <Logo sym={cell.symbol} pos={logoTop ? "top" : "bottom"} />}
              </button>
            );
          })}
        </div>

        {avg != null && (
          <p className="temp">
            <b>Performance Temperature:</b> La temperatura {cur.adj} de su cartera es {mood} ({fmtPct(avg)} ponderado),
            con {ups} {ups === 1 ? "valor" : "valores"} al alza y {downs} a la baja
            {best && pctOf(best) > 0 ? <>, impulsada principalmente por <b>{displaySym(best.symbol)}</b> ({fmtPct(pctOf(best))})</> : null}
            {worst && pctOf(worst) < 0 ? <>; el mayor lastre es <b>{displaySym(worst.symbol)}</b> ({fmtPct(pctOf(worst))})</> : null}.
          </p>
        )}
      </section>

      {/* Detalle */}
      {detail && (() => {
        const d = detail;
        const wt = totalValue > 0 ? (d.value / totalValue * 100).toFixed(2) : "0";
        const rows = [
          ["Precio actual",   fmtMoney(d.price, currency)],
          ["Precio medio",    fmtMoney(d.avgCost, currency)],
          ["Valor actual",    fmtMoney(d.value, currency)],
          ["Coste total",     fmtMoney(d.cost, currency)],
          ["P&L",             `${d.pnl >= 0 ? "+" : "-"}${fmtMoney(d.pnl, currency)}`, pnlCol(d.pnl)],
          ["P&L (%)",         fmtPct(d.pnlPct), pnlCol(d.pnlPct)],
          ["Divisa original", d.divisa || "—"],
          ["Hoy",             d.chg1d  != null ? fmtPct(d.chg1d)  : "—", d.chg1d  != null ? pnlCol(d.chg1d)  : null],
          ["1 semana",        d.chg1w  != null ? fmtPct(d.chg1w)  : "—", d.chg1w  != null ? pnlCol(d.chg1w)  : null],
          ["1 mes",           d.chg1m  != null ? fmtPct(d.chg1m)  : "—", d.chg1m  != null ? pnlCol(d.chg1m)  : null],
          ["YTD",             d.chgYtd != null ? fmtPct(d.chgYtd) : "—", d.chgYtd != null ? pnlCol(d.chgYtd) : null],
        ];
        return (
          <div className="scrim" onClick={() => setDetail(null)}>
            <div className="sheet" onClick={e => e.stopPropagation()}>
              <div className="grab" />
              <div className="shead">
                <Logo sym={d.symbol} pos="inline" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="stk">{displaySym(d.symbol)}</div>
                  <div className="snm">{nameOf(d.symbol) || "—"} · {wt}% · {d.shares} acciones</div>
                </div>
                <button className="icon" onClick={() => setDetail(null)} aria-label="Cerrar">✕</button>
              </div>
              {rows.map(([l, v, c]) => (
                <div key={l} className="srow"><span>{l}</span><b style={{ color: c || C.text }}>{v}</b></div>
              ))}
              <div className="foot">Yahoo Finance via Google Sheets · {currency} · {lastUpdated?.toLocaleTimeString("es")}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function Logo({ sym, pos }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={`logo ${pos}`}>
      {failed
        ? <span className="ini">{initials(sym)}</span>
        : <img src={logoUrl(sym)} alt="" onError={() => setFailed(true)} />}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@6..144,400;6..144,500;6..144,700&family=Roboto:wght@400;500;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{background:${C.bg};overscroll-behavior:none}
.app{height:100dvh;display:flex;flex-direction:column;overflow-y:auto;-webkit-overflow-scrolling:touch;background:${C.bg};color:${C.text};
  font-family:'Google Sans Flex','Google Sans','Roboto',-apple-system,BlinkMacSystemFont,sans-serif;
  padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
button{font-family:inherit;color:inherit;border:none;background:none;cursor:pointer}
.top{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 8px;flex-shrink:0}
.brand{font-size:23px;letter-spacing:-0.2px}
.brand b{font-weight:500;color:#fff}.brand span{color:${C.dim};font-weight:400}
.actions{display:flex;align-items:center;gap:6px}
.icon{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;color:${C.dim};text-decoration:none;font-size:16px}
.icon:active{background:rgba(255,255,255,.08)}
.icon.spin svg{animation:spin 0.9s linear infinite}
.curbtn{height:32px;padding:0 12px;border-radius:16px;border:1px solid ${C.line};color:${C.chipOnTxt};background:${C.chipOn};font-size:13px;font-weight:600;letter-spacing:0.3px;flex-shrink:0}
.curbtn:active{opacity:0.8}
.avatar{width:36px;height:36px;border-radius:50%;background:#7E57C2;color:#fff;display:grid;place-items:center;font-weight:500;font-size:16px;margin-left:4px}
.summary{padding:2px 20px 10px;flex-shrink:0}
.sumrow{display:flex;align-items:center;gap:10px}
.total{font-size:30px;font-weight:400;color:#fff;letter-spacing:-0.3px}
.eyebtn{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;color:${C.faint};flex-shrink:0;margin-top:2px}
.eyebtn:active{background:rgba(255,255,255,.08)}
.pnl{font-size:14px;margin-top:2px;font-weight:500}
.muted{color:${C.faint};font-weight:400}
.chips{display:flex;align-items:center;gap:8px;padding:0 16px 12px;flex-shrink:0}
.chiprow{display:flex;gap:8px;overflow-x:auto;flex:1;scrollbar-width:none}
.chiprow::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;height:32px;padding:0 14px;border-radius:8px;border:1px solid ${C.line};color:${C.dim};font-size:14px;font-weight:500;display:flex;align-items:center;gap:6px;white-space:nowrap}
.chip.on{background:${C.chipOn};border-color:${C.chipOn};color:${C.chipOnTxt}}
.check{font-size:13px}
.seg{display:flex;border:1px solid ${C.line};border-radius:16px;overflow:hidden;flex-shrink:0}
.seg button{height:30px;width:36px;font-size:14px;font-weight:500;color:${C.dim}}
.seg button.on{background:${C.chipOn};color:${C.chipOnTxt}}
.err{margin:0 16px 10px;padding:8px 12px;border-radius:12px;background:#601410;color:#F9DEDC;font-size:13px;flex-shrink:0}
.card{flex-shrink:0;margin:0 12px 16px;background:${C.card};border-radius:24px;padding:18px 16px 14px;display:flex;flex-direction:column}
.card h2{font-size:22px;font-weight:400;color:#E8EAED;letter-spacing:-0.1px}
.sub{font-size:13.5px;line-height:1.4;color:${C.dim};margin:6px 0 14px}
.map{position:relative;flex-shrink:0}
.tile{position:absolute;overflow:hidden;text-align:left;color:#F1F3F4;transition:filter .15s}
.tile:active{filter:brightness(1.12)}
.tinfo{position:absolute;inset:0;padding:14px 16px}
.tinfo.sm{padding:8px 9px}
.tk{font-size:17px;font-weight:500;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tinfo.sm .tk{font-size:13px}
.tk.xs{font-size:10.5px;padding:4px 5px;opacity:.9}
.nm{font-size:15px;color:rgba(255,255,255,.72);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc{display:flex;align-items:center;gap:9px;margin-top:8px;font-size:17px;font-weight:500;white-space:nowrap}
.tinfo.sm .pc{font-size:12px;margin-top:3px}
.dot{width:16px;height:16px;border-radius:50%;display:inline-block;flex-shrink:0}
.logo{width:40px;height:40px;border-radius:11px;background:rgba(0,0,0,.28);display:grid;place-items:center;overflow:hidden;flex-shrink:0}
.logo.top{position:absolute;top:10px;right:10px}
.logo.bottom{position:absolute;left:16px;bottom:14px}
.logo.inline{width:48px;height:48px;border-radius:13px;background:#2D2F31}
.logo img{width:24px;height:24px;object-fit:contain}
.logo.inline img{width:30px;height:30px}
.ini{font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:15px;color:#fff}
.temp{font-size:15px;line-height:1.5;color:${C.dim};margin-top:14px;flex-shrink:0}
.temp b{color:#fff;font-weight:500}
.loading{position:absolute;inset:0;display:grid;place-items:center}
.spinner{width:36px;height:36px;border-radius:50%;border:3px solid #333;border-top-color:${C.accent};animation:spin .8s linear infinite}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:100;animation:fade .15s}
.sheet{width:100%;background:${C.card};border-radius:28px 28px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom));max-height:85dvh;overflow-y:auto;animation:up .2s ease-out}
.grab{width:32px;height:4px;border-radius:2px;background:${C.line};margin:0 auto 16px}
.shead{display:flex;align-items:center;gap:14px;margin-bottom:12px}
.stk{font-size:24px;font-weight:500;color:#fff}
.snm{font-size:13px;color:${C.faint};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srow{display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #2D2F31;font-size:15px}
.srow span{color:${C.dim}}.srow b{font-weight:500}
.foot{margin-top:14px;font-size:11px;color:${C.faint};text-align:center}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes fade{from{opacity:0}}
@keyframes up{from{transform:translateY(40px);opacity:.4}}
`;
