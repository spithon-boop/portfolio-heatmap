import { useState, useEffect, useCallback, useRef } from "react";

// ─── Squarified Treemap ───────────────────────────────────────────────────────
function squarify(items, x, y, w, h) {
  if (!items.length) return [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0 || w <= 0 || h <= 0) return [];
  const results = [];
  let remaining = [...items];
  let rx = x, ry = y, rw = w, rh = h;
  while (remaining.length > 0) {
    const row = [];
    let rowSum = 0;
    const shortSide = Math.min(rw, rh);
    let best = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const item = remaining[i];
      const scaled = (item.value / total) * (rw * rh);
      row.push({ ...item, scaled });
      rowSum += scaled;
      const maxEl = Math.max(...row.map(r => r.scaled));
      const minEl = Math.min(...row.map(r => r.scaled));
      const ratio = Math.max(
        (shortSide * shortSide * maxEl) / (rowSum * rowSum),
        (rowSum * rowSum) / (shortSide * shortSide * minEl)
      );
      if (ratio > best) { row.pop(); rowSum -= scaled; break; }
      best = ratio;
    }
    if (row.length === 0) {
      const item = remaining[0];
      row.push({ ...item, scaled: (item.value / total) * (rw * rh) });
      rowSum = row[0].scaled;
    }
    remaining = remaining.slice(row.length);
    const rowTotal = row.reduce((s, r) => s + r.scaled, 0);
    if (rw <= rh) {
      const rowH = Math.max(1, rowTotal / rw);
      let cx = rx;
      row.forEach(r => {
        const cw = Math.max(1, r.scaled / rowH);
        results.push({ ...r, x: cx, y: ry, w: cw, h: rowH });
        cx += cw;
      });
      ry += rowH; rh -= rowH;
    } else {
      const rowW = Math.max(1, rowTotal / rh);
      let cy = ry;
      row.forEach(r => {
        const ch = Math.max(1, r.scaled / rowW);
        results.push({ ...r, x: rx, y: cy, w: rowW, h: ch });
        cy += ch;
      });
      rx += rowW; rw -= rowW;
    }
    if (rw < 1 || rh < 1) break;
  }
  return results;
}

// ─── Color ────────────────────────────────────────────────────────────────────
function getColor(pct) {
  if (pct == null) return "#111a28";
  const v = Math.max(-15, Math.min(15, pct));
  if (v >= 0) {
    const t = v / 15;
    return `rgb(${Math.round(10 + t * 10)}, ${Math.round(60 + t * 150)}, ${Math.round(30 + t * 30)})`;
  } else {
    const t = Math.abs(v) / 15;
    return `rgb(${Math.round(90 + t * 145)}, ${Math.round(15 + t * 10)}, ${Math.round(18 + t * 14)})`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const GAP = 3;
const fmtUSD  = (v) => `$${Math.abs(v||0).toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtUSD2 = (v) => `$${Math.abs(v||0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct  = (v, showPlus=true) => `${showPlus && (v||0)>=0 ? "+" : ""}${(v||0).toFixed(2)}%`;
const pnlCol  = (v) => (v||0) >= 0 ? "#50e87a" : "#e85050";

// ─── Metric definitions ───────────────────────────────────────────────────────
// Each metric defines: what pct to color by, what label to show in cell
const METRICS = [
  { key: "total", label: "P&L Total",  pctFn: (h) => h.pnlPct,  dolFn: (h) => h.pnl  },
  { key: "1d",    label: "1 Día",      pctFn: (h) => h.chg1d,   dolFn: (h) => h.chg1dVal },
  { key: "1w",    label: "1 Semana",   pctFn: (h) => h.chg1w,   dolFn: (h) => h.chg1wVal },
  { key: "1m",    label: "1 Mes",      pctFn: (h) => h.chg1m,   dolFn: (h) => h.chg1mVal },
  { key: "ytd",   label: "YTD",        pctFn: (h) => h.chgYtd,  dolFn: (h) => h.chgYtdVal },
];

export default function App() {
  const [holdings,    setHoldings]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);
  const [tooltip,     setTooltip]     = useState(null);
  const [metric,      setMetric]      = useState("total"); // which time period
  const [displayMode, setDisplayMode] = useState("pct");   // "pct" | "usd"
  const [sz,          setSz]          = useState({ w: 390, h: 500 });
  const containerRef = useRef(null);
  const refreshTimer = useRef(null);

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setSz({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/quotes");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHoldings(data.holdings || []);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    clearInterval(refreshTimer.current);
    refreshTimer.current = setInterval(fetchData, 120000);
    return () => clearInterval(refreshTimer.current);
  }, [fetchData]);

  // ── Enrich items ──────────────────────────────────────────────────────────
  // Note: Google Sheets only gives us current price & avg cost.
  // 1d/1w/1m/ytd changes require Yahoo Finance — for now we surface them
  // as "N/D" and show only what we have. Can be enhanced later via API.
  const items = holdings
    .filter(h => h.value > 0)
    .map(h => {
      const pnl    = h.value - h.shares * h.avgCost;
      const pnlPct = h.avgCost > 0 ? ((h.price - h.avgCost) / h.avgCost) * 100 : 0;
      // Placeholders for time-based changes (will be populated when API supports it)
      return {
        ...h, pnl, pnlPct,
        chg1d: h.chg1d ?? null, chg1dVal: h.chg1d != null ? (h.chg1d/100) * h.value : null,
        chg1w: null, chg1wVal: null,
        chg1m: null, chg1mVal: null,
        chgYtd: null, chgYtdVal: null,
      };
    })
    .sort((a, b) => b.value - a.value);

  const totalValue   = items.reduce((s, i) => s + i.value, 0);
  const totalCost    = items.reduce((s, i) => s + i.shares * i.avgCost, 0);
  const totalPnL     = totalValue - totalCost;
  const totalPnLPct  = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const currentMetric = METRICS.find(m => m.key === metric);

  // Color & display value per cell
  const getCellPct = (cell) => currentMetric.pctFn(cell);
  const getCellVal = (cell) => displayMode === "pct"
    ? (getCellPct(cell) != null ? fmtPct(getCellPct(cell)) : "N/D")
    : (currentMetric.dolFn(cell) != null ? `${currentMetric.dolFn(cell)>=0?"+":"-"}${fmtUSD(currentMetric.dolFn(cell))}` : "N/D");

  const layout = items.length > 0 && sz.w > 10 && sz.h > 10
    ? squarify(items, 0, 0, sz.w, sz.h) : [];

  // ── Total P&L for current metric ──────────────────────────────────────────
  const metricTotalPct = metric === "total" ? totalPnLPct : null;
  const metricTotalUsd = metric === "total" ? totalPnL    : null;

  return (
    <div style={S.screen}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={S.logo}>PORTFOLIO <span style={S.logoAccent}>MAP</span></span>
          {loading && <span style={S.dot} />}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          <button style={S.iconBtn} onClick={fetchData} title="Refrescar">↻</button>
          <a href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo"
            target="_blank" rel="noreferrer"
            style={{ ...S.iconBtn, textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center" }}
            title="Google Sheets">⊞</a>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {items.length > 0 && (
        <div style={S.statsBar}>
          <div style={S.statBlock}>
            <span style={S.statLbl}>VALOR</span>
            <span style={S.statVal}>{fmtUSD(totalValue)}</span>
          </div>
          <div style={S.statDivider} />
          <div style={S.statBlock}>
            <span style={S.statLbl}>P&L TOTAL</span>
            <span style={{ ...S.statVal, color: pnlCol(totalPnLPct) }}>
              {totalPnL >= 0 ? "+" : "-"}{fmtUSD(totalPnL)}
              <span style={{ fontSize:10, marginLeft:5 }}>({fmtPct(totalPnLPct)})</span>
            </span>
          </div>
          {lastUpdated && (
            <span style={{ marginLeft:"auto", fontSize:9, color:"#1e3a50", alignSelf:"center", flexShrink:0 }}>
              {lastUpdated.toLocaleTimeString("es", { hour:"2-digit", minute:"2-digit" })}
            </span>
          )}
        </div>
      )}

      {/* ── Controls bar ── */}
      {items.length > 0 && (
        <div style={S.controlBar}>
          {/* Time metric pills */}
          <div style={{ display:"flex", gap:3, flex:1, flexWrap:"nowrap", overflowX:"auto" }}>
            {METRICS.map(m => (
              <button key={m.key}
                style={{ ...S.pill, ...(metric===m.key ? S.pillOn : {}) }}
                onClick={() => setMetric(m.key)}>{m.label}</button>
            ))}
          </div>
          {/* % / $ toggle */}
          <div style={S.toggle}>
            <button style={{ ...S.toggleBtn, ...(displayMode==="pct" ? S.toggleOn : {}) }}
              onClick={() => setDisplayMode("pct")}>%</button>
            <button style={{ ...S.toggleBtn, ...(displayMode==="usd" ? S.toggleOn : {}) }}
              onClick={() => setDisplayMode("usd")}>$</button>
          </div>
        </div>
      )}

      {error && <div style={S.errorBar}>⚠ {error}</div>}

      {/* ── Treemap ── */}
      <div ref={containerRef} style={S.map}>
        {loading && items.length === 0 ? (
          <div style={S.center}>
            <div style={S.spinner} />
            <div style={{ fontSize:10, color:"#2a4060", letterSpacing:"0.15em", marginTop:14 }}>CARGANDO...</div>
          </div>
        ) : items.length === 0 ? (
          <div style={S.center}>
            <div style={{ fontSize:12, color:"#2a4060" }}>Sin datos</div>
          </div>
        ) : (
          <svg width="100%" height="100%"
            viewBox={`0 0 ${sz.w} ${sz.h}`}
            preserveAspectRatio="none" style={{ display:"block" }}>
            {layout.map((cell) => {
              const pct  = getCellPct(cell);
              const bg   = getColor(pct);
              const disp = getCellVal(cell);
              const isPos = (pct ?? 0) >= 0;

              // Adaptive font sizes based on cell dimensions
              const minDim  = Math.min(cell.w, cell.h);
              const fs      = Math.min(16, Math.max(9,  minDim / 4.5));
              const subFs   = Math.min(13, Math.max(8,  minDim / 5.5));
              const wgtFs   = Math.min(10, Math.max(7,  minDim / 7));

              const showTicker = cell.w > 32 && cell.h > 18;
              const showVal    = cell.h > 34 && cell.w > 36;
              const showWeight = cell.h > 58 && cell.w > 58;

              const midY = cell.y + cell.h / 2;
              // Vertical positioning: center the text block
              const lineSpacing = subFs + 4;
              const blockH = showVal ? (showWeight ? fs + lineSpacing * 2 : fs + lineSpacing) : fs;
              const topY   = midY - blockH / 2 + fs * 0.8;

              return (
                <g key={cell.symbol} style={{ cursor:"pointer" }}
                  onClick={() => setTooltip(t => t?.symbol === cell.symbol ? null : cell)}>
                  {/* Background */}
                  <rect
                    x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0, cell.w-GAP*2)}
                    height={Math.max(0, cell.h-GAP*2)}
                    fill={bg} rx={2}
                  />
                  {/* Shine overlay */}
                  <rect
                    x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0, cell.w-GAP*2)}
                    height={Math.min(cell.h*0.35, 16)}
                    fill="white" opacity={0.06} rx={2}
                  />
                  {/* Ticker */}
                  {showTicker && (
                    <text
                      x={cell.x + cell.w/2}
                      y={showVal ? topY : midY + fs*0.35}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.95)"
                      fontSize={fs}
                      fontFamily="'IBM Plex Mono',monospace"
                      fontWeight="700"
                      letterSpacing="0.02em"
                    >{cell.symbol}</text>
                  )}
                  {/* Value (% or $) */}
                  {showVal && (
                    <text
                      x={cell.x + cell.w/2}
                      y={topY + lineSpacing}
                      textAnchor="middle"
                      fill={isPos ? "rgba(120,255,160,0.95)" : "rgba(255,110,110,0.95)"}
                      fontSize={subFs}
                      fontFamily="'IBM Plex Mono',monospace"
                      fontWeight="500"
                    >{disp}</text>
                  )}
                  {/* Weight */}
                  {showWeight && (
                    <text
                      x={cell.x + cell.w/2}
                      y={topY + lineSpacing * 2}
                      textAnchor="middle"
                      fill="rgba(180,210,240,0.45)"
                      fontSize={wgtFs}
                      fontFamily="'IBM Plex Mono',monospace"
                    >{(cell.value/totalValue*100).toFixed(1)}%</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Legend */}
        {layout.length > 0 && (
          <div style={S.legend}>
            <span style={S.legendLbl}>−15%</span>
            {[-15,-10,-5,-2,0,2,5,10,15].map(v => (
              <div key={v} style={{ width:13, height:7, background:getColor(v), borderRadius:1 }} />
            ))}
            <span style={S.legendLbl}>+15%</span>
          </div>
        )}
      </div>

      {/* ── Detail sheet ── */}
      {tooltip && (() => {
        const pnl    = tooltip.value - tooltip.shares * tooltip.avgCost;
        const pnlPct = tooltip.avgCost > 0 ? ((tooltip.price - tooltip.avgCost) / tooltip.avgCost) * 100 : 0;
        const weight = (tooltip.value / totalValue * 100).toFixed(2);
        return (
          <div style={S.overlay} onClick={() => setTooltip(null)}>
            <div style={S.sheet} onClick={e => e.stopPropagation()}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
                <div>
                  <div style={S.ttTicker}>{tooltip.symbol}</div>
                  <div style={S.ttSub}>{weight}% del portfolio</div>
                </div>
                <button style={S.closeBtn} onClick={() => setTooltip(null)}>✕</button>
              </div>
              <div style={S.ttGrid}>
                {[
                  ["PRECIO ACTUAL",  fmtUSD2(tooltip.price),              null],
                  ["PRECIO MEDIO",   fmtUSD2(tooltip.avgCost),            null],
                  ["ACCIONES",       (tooltip.shares||0).toLocaleString(), null],
                  ["VALOR ACTUAL",   fmtUSD2(tooltip.value),              null],
                  ["COSTE TOTAL",    fmtUSD2(tooltip.shares * tooltip.avgCost), null],
                  ["P&L ($)",        `${pnl>=0?"+":"-"}${fmtUSD2(pnl)}`, pnlCol(pnl)],
                  ["P&L (%)",        fmtPct(pnlPct),                      pnlCol(pnlPct)],
                ].map(([lbl, val, col]) => (
                  <div key={lbl} style={S.ttRow}>
                    <span style={S.ttLbl}>{lbl}</span>
                    <span style={{ ...S.ttVal, ...(col ? {color:col} : {}) }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={S.ttFooter}>Google Sheets · GOOGLEFINANCE() · {lastUpdated?.toLocaleTimeString("es")}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  screen:      { height:"100dvh", background:"#06080f", fontFamily:"'IBM Plex Mono',monospace", color:"#b0c8e0", display:"flex", flexDirection:"column", overflow:"hidden" },
  header:      { padding:"11px 16px 9px", borderBottom:"1px solid #0c1c2c", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0, background:"#08101a" },
  logo:        { fontFamily:"'Syne',sans-serif", fontSize:16, fontWeight:800, color:"#cce4ff", letterSpacing:"-0.01em" },
  logoAccent:  { color:"#4a8fd4" },
  iconBtn:     { background:"transparent", border:"1px solid #112030", color:"#3a6880", fontSize:14, cursor:"pointer", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:3 },
  dot:         { width:6, height:6, borderRadius:"50%", background:"#4a8fd4", animation:"pulse 1s infinite", display:"inline-block", marginLeft:4 },
  statsBar:    { padding:"8px 16px", borderBottom:"1px solid #0a1620", display:"flex", gap:0, flexShrink:0, overflowX:"auto", alignItems:"center", background:"#070e18" },
  statBlock:   { display:"flex", flexDirection:"column", gap:1, paddingRight:14 },
  statLbl:     { fontSize:9, color:"#1a3850", letterSpacing:"0.12em", textTransform:"uppercase" },
  statVal:     { fontSize:12, color:"#6a9ec0", fontWeight:600 },
  statDivider: { width:1, background:"#091828", margin:"0 14px 0 0", alignSelf:"stretch" },
  controlBar:  { padding:"6px 12px", borderBottom:"1px solid #0a1620", display:"flex", gap:8, alignItems:"center", flexShrink:0, background:"#070e18" },
  pill:        { background:"transparent", border:"1px solid #0e2030", color:"#284860", fontSize:10, cursor:"pointer", padding:"4px 9px", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.04em", borderRadius:2, whiteSpace:"nowrap", flexShrink:0 },
  pillOn:      { background:"#0c2540", borderColor:"#2a5888", color:"#60a8d8" },
  toggle:      { display:"flex", border:"1px solid #0e2030", borderRadius:3, overflow:"hidden", flexShrink:0 },
  toggleBtn:   { background:"transparent", border:"none", color:"#284860", fontSize:11, cursor:"pointer", padding:"4px 10px", fontFamily:"'IBM Plex Mono',monospace", fontWeight:600 },
  toggleOn:    { background:"#0c2540", color:"#60a8d8" },
  errorBar:    { padding:"5px 16px", background:"#160a0a", borderBottom:"1px solid #3a1010", fontSize:10, color:"#9a4040", flexShrink:0 },
  map:         { flex:1, position:"relative", overflow:"hidden" },
  center:      { position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" },
  spinner:     { width:32, height:32, border:"2px solid #0e2030", borderTop:"2px solid #3a7abf", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  legend:      { position:"absolute", bottom:8, right:10, display:"flex", alignItems:"center", gap:2, pointerEvents:"none" },
  legendLbl:   { fontSize:8, color:"#1a3050" },
  overlay:     { position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"flex-end", zIndex:100 },
  sheet:       { width:"100%", background:"#080f1a", borderTop:"1px solid #162840", padding:"20px 20px 38px", borderRadius:"14px 14px 0 0" },
  ttTicker:    { fontFamily:"'Syne',sans-serif", fontSize:26, fontWeight:800, color:"#cce4ff", letterSpacing:"-0.01em" },
  ttSub:       { fontSize:10, color:"#1e3a55", marginTop:2 },
  ttGrid:      { display:"flex", flexDirection:"column", gap:11 },
  ttRow:       { display:"flex", justifyContent:"space-between", alignItems:"center" },
  ttLbl:       { fontSize:10, color:"#1a3850", letterSpacing:"0.1em" },
  ttVal:       { fontSize:14, color:"#7ab0d0", fontWeight:600 },
  ttFooter:    { marginTop:20, fontSize:9, color:"#112030", textAlign:"center" },
  closeBtn:    { background:"transparent", border:"1px solid #162030", color:"#284860", width:28, height:28, cursor:"pointer", fontSize:12, borderRadius:2 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Syne:wght@700;800&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { overscroll-behavior:none; background:#06080f; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.25} }
  @keyframes spin   { to { transform:rotate(360deg); } }
  button:active { opacity:0.65; }
  ::-webkit-scrollbar { display:none; }
`;
