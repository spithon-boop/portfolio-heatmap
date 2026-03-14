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

function getColor(pct) {
  if (pct == null) return "#111a28";
  const v = Math.max(-8, Math.min(8, pct));
  if (v >= 0) {
    const t = v / 8;
    return `rgb(${Math.round(8 + t * 12)}, ${Math.round(55 + t * 155)}, ${Math.round(28 + t * 32)})`;
  } else {
    const t = Math.abs(v) / 8;
    return `rgb(${Math.round(80 + t * 150)}, ${Math.round(12 + t * 10)}, ${Math.round(16 + t * 12)})`;
  }
}

const GAP = 2;
const fmtUSD = (v) => `$${Math.abs(v||0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${(v||0) >= 0 ? "+" : ""}${(v||0).toFixed(2)}%`;

// ─── Color for P&L pct ────────────────────────────────────────────────────────
function pnlColor(pct) {
  return (pct || 0) >= 0 ? "#4ac878" : "#d05050";
}

export default function App() {
  const [holdings, setHoldings]       = useState([]);
  const [loading, setLoading]         = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError]             = useState(null);
  const [tooltip, setTooltip]         = useState(null);
  const [colorBy, setColorBy]         = useState("pnl"); // "pnl" | "day"
  const [sz, setSz]                   = useState({ w: 390, h: 540 });
  const containerRef = useRef(null);
  const refreshTimer = useRef(null);

  // ── Resize ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setSz({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Fetch from Google Sheets via API ────────────────────────────────────
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
    refreshTimer.current = setInterval(fetchData, 120000); // refresh every 2 min
    return () => clearInterval(refreshTimer.current);
  }, [fetchData]);

  // ── Build items ──────────────────────────────────────────────────────────
  const items = holdings
    .filter(h => h.value > 0)
    .map(h => {
      const pnlPct = h.avgCost > 0 ? ((h.price - h.avgCost) / h.avgCost) * 100 : 0;
      return { ...h, pnlPct };
    })
    .sort((a, b) => b.value - a.value);

  const totalValue = items.reduce((s, i) => s + i.value, 0);
  const totalCost  = items.reduce((s, i) => s + i.shares * i.avgCost, 0);
  const totalPnL   = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const layout = items.length > 0 && sz.w > 10 && sz.h > 10
    ? squarify(items, 0, 0, sz.w, sz.h) : [];

  // ── Color logic ──────────────────────────────────────────────────────────
  const cellColor = (cell) => getColor(colorBy === "pnl" ? cell.pnlPct : 0);

  return (
    <div style={S.screen}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <span style={S.logo}>PORTFOLIO</span>
          <span style={S.logoAccent}>MAP</span>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {loading && <span style={S.dot} />}
          <button style={S.iconBtn} onClick={fetchData} title="Refrescar">↻</button>
          <a href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo"
            target="_blank" rel="noreferrer" style={{ ...S.iconBtn, textDecoration:"none", display:"flex", alignItems:"center", justifyContent:"center" }}
            title="Abrir Google Sheets">⊞</a>
        </div>
      </div>

      {/* Stats */}
      {items.length > 0 && (
        <div style={S.statsBar}>
          <Stat label="VALOR TOTAL" value={fmtUSD(totalValue)} />
          <div style={S.div} />
          <Stat label="COSTE TOTAL" value={fmtUSD(totalCost)} />
          <div style={S.div} />
          <Stat label="P&L TOTAL"
            value={`${totalPnL >= 0 ? "+" : "-"}${fmtUSD(totalPnL)}`}
            sub={fmtPct(totalPnLPct)}
            color={pnlColor(totalPnLPct)} />
          {lastUpdated && (
            <span style={{ marginLeft:"auto", fontSize:9, color:"#1a3050", alignSelf:"center" }}>
              {lastUpdated.toLocaleTimeString("es", { hour:"2-digit", minute:"2-digit" })}
            </span>
          )}
        </div>
      )}

      {/* Color mode selector */}
      {items.length > 0 && (
        <div style={S.metricBar}>
          <span style={S.metricLabel}>COLOR POR:</span>
          <button style={{ ...S.metricBtn, ...(colorBy==="pnl" ? S.metricOn : {}) }}
            onClick={() => setColorBy("pnl")}>P&L TOTAL</button>
          <button style={{ ...S.metricBtn, ...(colorBy==="day" ? S.metricOn : {}) }}
            onClick={() => setColorBy("day")}>CAMBIO HOY</button>
          <span style={{ marginLeft:"auto", fontSize:9, color:"#1a3050" }}>
            {items.length} posiciones
          </span>
        </div>
      )}

      {error && <div style={S.errorBar}>⚠ {error}</div>}

      {/* Treemap */}
      <div ref={containerRef} style={S.map}>
        {loading && items.length === 0 ? (
          <div style={S.center}>
            <div style={S.spinner} />
            <div style={{ fontSize:10, color:"#2a4060", letterSpacing:"0.2em", marginTop:16 }}>
              CARGANDO CARTERA...
            </div>
          </div>
        ) : items.length === 0 ? (
          <div style={S.center}>
            <div style={{ fontSize:11, color:"#2a4060" }}>No hay datos en Google Sheets</div>
          </div>
        ) : (
          <svg width="100%" height="100%"
            viewBox={`0 0 ${sz.w} ${sz.h}`}
            preserveAspectRatio="none" style={{ display:"block" }}>
            {layout.map((cell) => {
              const bg  = cellColor(cell);
              const fs  = Math.min(15, Math.max(8, Math.min(cell.w, cell.h) / 5));
              const sub = Math.max(7, fs * 0.72);
              const showName = cell.w > 38 && cell.h > 20;
              const showPct  = cell.h > 32 && cell.w > 34;
              const showWt   = cell.h > 56 && cell.w > 56;
              const midY = cell.y + cell.h / 2;
              const displayPct = colorBy === "pnl" ? cell.pnlPct : 0;

              return (
                <g key={cell.symbol} style={{ cursor:"pointer" }}
                  onClick={() => setTooltip(t => t?.symbol === cell.symbol ? null : cell)}>
                  <rect x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0,cell.w-GAP*2)} height={Math.max(0,cell.h-GAP*2)}
                    fill={bg} rx={1} />
                  <rect x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0,cell.w-GAP*2)} height={Math.min(cell.h*0.3,12)}
                    fill="white" opacity={0.05} rx={1} />
                  {showName && (
                    <text x={cell.x+cell.w/2}
                      y={showPct ? midY-(showWt ? fs*0.9 : 2) : midY+fs*0.38}
                      textAnchor="middle" fill="#e8f4ff"
                      fontSize={fs} fontFamily="'IBM Plex Mono',monospace" fontWeight="600"
                    >{cell.symbol}</text>
                  )}
                  {showPct && (
                    <text x={cell.x+cell.w/2}
                      y={showName ? midY+sub*0.6 : midY+sub*0.4}
                      textAnchor="middle"
                      fill={displayPct >= 0 ? "#6de89a" : "#e87070"}
                      fontSize={sub} fontFamily="'IBM Plex Mono',monospace"
                    >{fmtPct(displayPct)}</text>
                  )}
                  {showWt && (
                    <text x={cell.x+cell.w/2} y={midY+sub*0.6+sub+4}
                      textAnchor="middle" fill="#3a5a78"
                      fontSize={Math.max(7,sub*0.8)} fontFamily="'IBM Plex Mono',monospace"
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
            <span style={S.legendLbl}>-8%</span>
            {[-8,-5,-3,-1,0,1,3,5,8].map(v => (
              <div key={v} style={{ width:14, height:8, background:getColor(v) }} />
            ))}
            <span style={S.legendLbl}>+8%</span>
          </div>
        )}
      </div>

      {/* Detail bottom sheet */}
      {tooltip && (
        <div style={S.sheetOverlay} onClick={() => setTooltip(null)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:16 }}>
              <div>
                <div style={S.ttSymbol}>{tooltip.symbol}</div>
                <div style={S.ttMeta}>
                  {(tooltip.value/totalValue*100).toFixed(2)}% del portfolio
                </div>
              </div>
              <button style={S.closeBtn} onClick={() => setTooltip(null)}>✕</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
              {(() => {
                const pnl    = tooltip.value - tooltip.shares * tooltip.avgCost;
                const pnlPct = tooltip.avgCost > 0 ? ((tooltip.price - tooltip.avgCost) / tooltip.avgCost) * 100 : 0;
                return [
                  ["PRECIO ACTUAL",   fmtUSD(tooltip.price),    null],
                  ["PRECIO MEDIO",    fmtUSD(tooltip.avgCost),  null],
                  ["ACCIONES",        tooltip.shares?.toLocaleString("es"), null],
                  ["VALOR ACTUAL",    fmtUSD(tooltip.value),    null],
                  ["COSTE TOTAL",     fmtUSD(tooltip.shares * tooltip.avgCost), null],
                  ["P&L ($)",         `${pnl>=0?"+":"-"}${fmtUSD(pnl)}`, pnlColor(pnlPct)],
                  ["P&L (%)",         fmtPct(pnlPct),           pnlColor(pnlPct)],
                ].map(([lbl, val, col]) => (
                  <div key={lbl} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={S.ttLabel}>{lbl}</span>
                    <span style={{ ...S.ttValue, ...(col ? { color:col } : {}) }}>{val}</span>
                  </div>
                ));
              })()}
            </div>
            <div style={{ marginTop:18, fontSize:9, color:"#1a3050", textAlign:"center" }}>
              Datos desde Google Sheets · GOOGLEFINANCE()
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:2, padding:"0 12px 0 0" }}>
      <span style={{ fontSize:9, color:"#1e3a50", letterSpacing:"0.1em" }}>{label}</span>
      <span style={{ fontSize:11, color: color||"#7aacc8", fontWeight:500 }}>
        {value}
        {sub && <span style={{ fontSize:9, marginLeft:4, color }}>{sub}</span>}
      </span>
    </div>
  );
}

const S = {
  screen:     { height:"100dvh", background:"#070c14", fontFamily:"'IBM Plex Mono',monospace", color:"#c0d0e0", display:"flex", flexDirection:"column", overflow:"hidden" },
  header:     { padding:"12px 16px 10px", borderBottom:"1px solid #0d1e30", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  logo:       { fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:800, color:"#d0e8ff", letterSpacing:"-0.02em" },
  logoAccent: { fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, color:"#3a7abf", letterSpacing:"-0.02em" },
  iconBtn:    { background:"transparent", border:"1px solid #0e2030", color:"#3a6080", fontSize:15, cursor:"pointer", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center" },
  dot:        { width:6, height:6, borderRadius:"50%", background:"#3a7abf", animation:"pulse 1s infinite", display:"inline-block" },
  statsBar:   { padding:"7px 16px", borderBottom:"1px solid #0a1820", display:"flex", gap:0, flexShrink:0, overflowX:"auto", alignItems:"center" },
  div:        { width:1, background:"#0a1a2a", margin:"0 12px 0 0", alignSelf:"stretch" },
  metricBar:  { padding:"5px 16px", borderBottom:"1px solid #0a1820", display:"flex", gap:4, alignItems:"center", flexShrink:0 },
  metricLabel:{ fontSize:9, color:"#1e3a50", letterSpacing:"0.1em", marginRight:4 },
  metricBtn:  { background:"transparent", border:"1px solid #0e2030", color:"#2a4a60", fontSize:10, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", padding:"3px 10px", letterSpacing:"0.06em" },
  metricOn:   { background:"#0e2540", borderColor:"#2a5a8a", color:"#6ab0e0" },
  errorBar:   { padding:"6px 16px", background:"#1a0e0e", borderBottom:"1px solid #3a1010", fontSize:10, color:"#8a4040", flexShrink:0 },
  map:        { flex:1, position:"relative", overflow:"hidden" },
  center:     { position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" },
  spinner:    { width:36, height:36, border:"2px solid #1e3050", borderTop:"2px solid #3a7abf", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  legend:     { position:"absolute", bottom:8, right:8, display:"flex", alignItems:"center", gap:2, pointerEvents:"none" },
  legendLbl:  { fontSize:8, color:"#1e3050" },
  sheetOverlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", zIndex:100 },
  sheet:      { width:"100%", background:"#0a1525", borderTop:"1px solid #1a3050", padding:"22px 20px 36px", borderRadius:"12px 12px 0 0" },
  ttSymbol:   { fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:800, color:"#d0e8ff" },
  ttMeta:     { fontSize:10, color:"#2a4560", marginTop:2 },
  ttLabel:    { fontSize:10, color:"#1e3a50", letterSpacing:"0.1em" },
  ttValue:    { fontSize:13, color:"#8ab8d8", fontWeight:500 },
  closeBtn:   { background:"transparent", border:"1px solid #1a2a3a", color:"#2a4a60", width:28, height:28, cursor:"pointer", fontSize:12 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { overscroll-behavior:none; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  @keyframes spin { to { transform:rotate(360deg); } }
  button:active { opacity:0.7; }
  ::-webkit-scrollbar { display:none; }
`;
