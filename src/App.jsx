import { useState, useEffect, useCallback, useRef } from "react";

// ─── Treemap: fills 100% of space ────────────────────────────────────────────
function buildTreemap(items, W, H) {
  if (!items.length || W <= 0 || H <= 0) return [];
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return [];
  // Normalize values to fill exact W×H
  const scaled = items.map(i => ({ ...i, area: (i.value / total) * W * H }));
  return slice(scaled, 0, 0, W, H);
}

function slice(items, x, y, w, h) {
  if (!items.length) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];

  const total = items.reduce((s, i) => s + i.area, 0);
  const results = [];
  let remaining = [...items];
  let rx = x, ry = y, rw = w, rh = h;

  while (remaining.length > 0) {
    if (remaining.length === 1) {
      results.push({ ...remaining[0], x: rx, y: ry, w: rw, h: rh });
      break;
    }

    const row = [];
    let rowArea = 0;
    const side = Math.min(rw, rh);
    let prevRatio = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      row.push(remaining[i]);
      rowArea += remaining[i].area;
      const rowTotal = rowArea;
      const maxA = Math.max(...row.map(r => r.area));
      const minA = Math.min(...row.map(r => r.area));
      const ratio = Math.max(
        (side * side * maxA) / (rowTotal * rowTotal),
        (rowTotal * rowTotal) / (side * side * minA)
      );
      if (ratio > prevRatio && i > 0) {
        row.pop();
        rowArea -= remaining[i].area;
        break;
      }
      prevRatio = ratio;
    }

    remaining = remaining.slice(row.length);
    const rowAreaFinal = row.reduce((s, r) => s + r.area, 0);

    if (rw >= rh) {
      const colW = rowAreaFinal / rh;
      let cy = ry;
      row.forEach(r => {
        const cellH = (r.area / rowAreaFinal) * rh;
        results.push({ ...r, x: rx, y: cy, w: colW, h: cellH });
        cy += cellH;
      });
      rx += colW;
      rw -= colW;
    } else {
      const rowH = rowAreaFinal / rw;
      let cx = rx;
      row.forEach(r => {
        const cellW = (r.area / rowAreaFinal) * rw;
        results.push({ ...r, x: cx, y: ry, w: cellW, h: rowH });
        cx += cellW;
      });
      ry += rowH;
      rh -= rowH;
    }
    if (rw < 0.5 || rh < 0.5) break;
  }
  return results;
}

// ─── Finviz colors ────────────────────────────────────────────────────────────
function getColor(pct) {
  if (pct == null) return "#1e293b";
  const v = Math.max(-12, Math.min(12, pct));
  if (v >= 0) {
    const t = v / 12;
    const g = Math.round(80 + t * 175);
    const r = Math.round(0  + t * 15);
    return `rgb(${r},${g},0)`;
  } else {
    const t = Math.abs(v) / 12;
    const r = Math.round(80 + t * 175);
    return `rgb(${r},0,0)`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const GAP    = 2;
const fmtPct = v => `${(v||0)>=0?"+":""}${(v||0).toFixed(2)}%`;
const fmtUSD = v => `$${Math.abs(v||0).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK   = v => {
  const a = Math.abs(v||0), s = (v||0)>=0?"+":"-";
  if (a>=1e6) return `${s}$${(a/1e6).toFixed(1)}M`;
  if (a>=1e3) return `${s}$${(a/1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
};
const pnlCol = v => (v||0)>=0 ? "#4ade80" : "#f87171";

const METRICS = [
  { key:"total", label:"P&L",    pctKey:"pnlPct" },
  { key:"1d",    label:"1 Día",  pctKey:"chg1d"  },
  { key:"1w",    label:"1 Sem",  pctKey:null     },
  { key:"1m",    label:"1 Mes",  pctKey:null     },
  { key:"ytd",   label:"YTD",    pctKey:null     },
];

export default function App() {
  const [holdings,    setHoldings]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);
  const [tooltip,     setTooltip]     = useState(null);
  const [metric,      setMetric]      = useState("total");
  const [dispMode,    setDispMode]    = useState("pct");
  const [sz,          setSz]          = useState({ w:800, h:600 });
  const mapRef   = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setSz({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    if (mapRef.current) obs.observe(mapRef.current);
    return () => obs.disconnect();
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/quotes");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setHoldings(data.holdings || []);
      setLastUpdated(new Date());
    } catch(e) { setError(e.message); }
    finally    { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 120000);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  // Enrich
  const items = holdings.filter(h => h.value > 0).map(h => {
    const cost   = h.shares * h.avgCost;
    const pnl    = h.value - cost;
    const pnlPct = cost > 0 ? ((h.price - h.avgCost) / h.avgCost) * 100 : 0;
    return { ...h, cost, pnl, pnlPct };
  }).sort((a,b) => b.value - a.value);

  const totalValue  = items.reduce((s,i)=>s+i.value,0);
  const totalCost   = items.reduce((s,i)=>s+i.cost,0);
  const totalPnL    = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL/totalCost)*100 : 0;

  const cur         = METRICS.find(m => m.key === metric);
  const getCellPct  = c => cur.pctKey ? (c[cur.pctKey]??null) : null;
  const getCellDisp = c => {
    const pct = getCellPct(c);
    if (pct === null) return "—";
    if (dispMode === "pct") return fmtPct(pct);
    return fmtK((pct/100) * c.value);
  };

  const layout = buildTreemap(items, sz.w, sz.h);

  return (
    <div style={S.screen}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={S.header}>
        <span style={S.logo}>PORTFOLIO <span style={{color:"#38bdf8"}}>MAP</span></span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {loading && <div style={S.dot}/>}
          <button style={S.iconBtn} onClick={fetchData} title="Refrescar">↻</button>
          <a href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo"
            target="_blank" rel="noreferrer"
            style={{...S.iconBtn,textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center"}}
            title="Google Sheets">⊞</a>
        </div>
      </div>

      {/* Stats */}
      {items.length > 0 && (
        <div style={S.statsBar}>
          <SI label="VALOR"  value={fmtUSD(totalValue)} />
          <div style={S.sdiv}/>
          <SI label="P&L"
            value={`${totalPnL>=0?"+":"-"}${fmtUSD(totalPnL)}`}
            sub={`(${fmtPct(totalPnLPct)})`}
            color={pnlCol(totalPnLPct)} />
          <div style={S.sdiv}/>
          <SI label="POSICIONES" value={`${items.length}`} />
          {lastUpdated && (
            <span style={{marginLeft:"auto",fontSize:10,color:"#475569",alignSelf:"center",flexShrink:0}}>
              {lastUpdated.toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}
            </span>
          )}
        </div>
      )}

      {/* Controls */}
      {items.length > 0 && (
        <div style={S.ctrlBar}>
          <div style={{display:"flex",gap:3,flex:1,overflowX:"auto"}}>
            {METRICS.map(m => (
              <button key={m.key}
                style={{
                  ...S.pill,
                  ...(metric===m.key ? S.pillOn : {}),
                  ...(!m.pctKey ? {opacity:0.35,cursor:"default"} : {}),
                }}
                onClick={() => m.pctKey && setMetric(m.key)}>{m.label}</button>
            ))}
          </div>
          <div style={S.toggle}>
            <button style={{...S.tBtn,...(dispMode==="pct"?S.tOn:{})}} onClick={()=>setDispMode("pct")}>%</button>
            <button style={{...S.tBtn,...(dispMode==="usd"?S.tOn:{})}} onClick={()=>setDispMode("usd")}>$</button>
          </div>
        </div>
      )}

      {error && <div style={S.errBar}>⚠ {error}</div>}

      {/* Map — fills ALL remaining space */}
      <div ref={mapRef} style={S.map}>
        {loading && items.length === 0 ? (
          <div style={S.center}>
            <div style={S.spinner}/>
            <div style={{fontSize:11,color:"#475569",marginTop:14,letterSpacing:"0.15em"}}>CARGANDO...</div>
          </div>
        ) : (
          <svg
            style={{position:"absolute",inset:0,display:"block"}}
            width={sz.w} height={sz.h}
          >
            {layout.map(cell => {
              const pct    = getCellPct(cell);
              const bg     = getColor(pct);
              const disp   = getCellDisp(cell);
              const isPos  = (pct??0) >= 0;
              const noData = pct === null;

              const cw = Math.max(0, cell.w - GAP * 2);
              const ch = Math.max(0, cell.h - GAP * 2);
              const cx = cell.x + GAP;
              const cy = cell.y + GAP;

              // Font size scales with cell area — big cells get big text
              const area  = cw * ch;
              const fs    = Math.min(22, Math.max(10, Math.sqrt(area) / 9));
              const subFs = Math.min(16, Math.max(9,  Math.sqrt(area) / 12));
              const wgtFs = Math.min(11, Math.max(7,  Math.sqrt(area) / 18));

              const showTicker = cw > 28 && ch > 16;
              const showVal    = ch > 34 && cw > 32;
              const showWgt    = ch > 60 && cw > 60;

              // Center text block vertically
              const nLines  = showVal ? (showWgt ? 3 : 2) : 1;
              const lineH   = subFs + 6;
              const blockH  = fs + (nLines - 1) * lineH;
              const midX    = cx + cw / 2;
              const midY    = cy + ch / 2;
              const textY   = midY - blockH / 2 + fs * 0.75;

              return (
                <g key={cell.symbol} style={{cursor:"pointer"}}
                   onClick={() => setTooltip(t => t?.symbol === cell.symbol ? null : cell)}>
                  {/* Cell background */}
                  <rect x={cx} y={cy} width={cw} height={ch} fill={bg} rx={1}/>
                  {/* Top gloss */}
                  <rect x={cx} y={cy} width={cw} height={Math.min(ch * 0.4, 18)}
                    fill="white" opacity={0.07} rx={1}/>
                  {/* Ticker — always white, bold */}
                  {showTicker && (
                    <text x={midX} y={showVal ? textY : midY + fs * 0.35}
                      textAnchor="middle" fill="white"
                      fontSize={fs} fontFamily="Arial,sans-serif" fontWeight="900"
                      style={{userSelect:"none"}}>
                      {cell.symbol}
                    </text>
                  )}
                  {/* Value */}
                  {showVal && (
                    <text x={midX} y={textY + lineH}
                      textAnchor="middle"
                      fill={noData ? "rgba(255,255,255,0.3)" : "white"}
                      fontSize={subFs} fontFamily="Arial,sans-serif" fontWeight="700"
                      style={{userSelect:"none"}}>
                      {disp}
                    </text>
                  )}
                  {/* Weight */}
                  {showWgt && (
                    <text x={midX} y={textY + lineH * 2}
                      textAnchor="middle" fill="rgba(255,255,255,0.55)"
                      fontSize={wgtFs} fontFamily="Arial,sans-serif"
                      style={{userSelect:"none"}}>
                      {(cell.value / totalValue * 100).toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Color legend */}
        {layout.length > 0 && (
          <div style={S.legend}>
            {[-10,-5,-2,0,2,5,10].map(v => (
              <div key={v} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:24,height:11,background:getColor(v),borderRadius:1}}/>
                <span style={{fontSize:8,color:"#64748b"}}>{v>0?"+":""}{v}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {tooltip && (() => {
        const pnl    = tooltip.pnl    ?? (tooltip.value - tooltip.shares * tooltip.avgCost);
        const pnlPct = tooltip.pnlPct ?? (tooltip.avgCost > 0 ? ((tooltip.price - tooltip.avgCost) / tooltip.avgCost) * 100 : 0);
        const wt     = totalValue > 0 ? (tooltip.value / totalValue * 100).toFixed(2) : "0";
        return (
          <div style={S.overlay} onClick={() => setTooltip(null)}>
            <div style={S.sheet} onClick={e => e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
                <div>
                  <div style={S.ttTicker}>{tooltip.symbol}</div>
                  <div style={S.ttSub}>{wt}% del portfolio · {tooltip.shares} acciones</div>
                </div>
                <button style={S.closeBtn} onClick={() => setTooltip(null)}>✕</button>
              </div>
              <div style={S.ttGrid}>
                {[
                  ["PRECIO ACTUAL", fmtUSD(tooltip.price),                              null],
                  ["PRECIO MEDIO",  fmtUSD(tooltip.avgCost),                            null],
                  ["VALOR ACTUAL",  fmtUSD(tooltip.value),                              null],
                  ["COSTE TOTAL",   fmtUSD(tooltip.shares * tooltip.avgCost),           null],
                  ["P&L ($)",       `${pnl>=0?"+":"-"}${fmtUSD(pnl)}`,                pnlCol(pnl)],
                  ["P&L (%)",       fmtPct(pnlPct),                                    pnlCol(pnlPct)],
                ].map(([l,v,c]) => (
                  <div key={l} style={S.ttRow}>
                    <span style={S.ttLbl}>{l}</span>
                    <span style={{...S.ttVal,...(c?{color:c}:{})}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:14,fontSize:9,color:"#334155",textAlign:"center"}}>
                Google Sheets · GOOGLEFINANCE() · {lastUpdated?.toLocaleTimeString("es")}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SI({label, value, sub, color}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,paddingRight:16,flexShrink:0}}>
      <span style={{fontSize:9,color:"#475569",letterSpacing:"0.1em"}}>{label}</span>
      <span style={{fontSize:13,color:color||"#94a3b8",fontWeight:700}}>
        {value}
        {sub && <span style={{fontSize:11,marginLeft:5,color:color}}>{sub}</span>}
      </span>
    </div>
  );
}

const S = {
  screen:  {height:"100dvh",background:"#0f172a",fontFamily:"Arial,Helvetica,sans-serif",color:"#e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden"},
  header:  {padding:"10px 14px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"#020817"},
  logo:    {fontSize:16,fontWeight:900,color:"#f1f5f9",letterSpacing:"0.06em"},
  iconBtn: {background:"transparent",border:"1px solid #334155",color:"#64748b",fontSize:14,cursor:"pointer",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:3},
  dot:     {width:7,height:7,borderRadius:"50%",background:"#38bdf8",animation:"pulse 1s infinite",flexShrink:0},
  statsBar:{padding:"7px 14px",borderBottom:"1px solid #1e293b",display:"flex",alignItems:"center",flexShrink:0,overflowX:"auto",gap:0,background:"#020817"},
  sdiv:    {width:1,background:"#1e293b",margin:"0 16px 0 0",alignSelf:"stretch",flexShrink:0},
  ctrlBar: {padding:"5px 10px",borderBottom:"1px solid #1e293b",display:"flex",gap:6,alignItems:"center",flexShrink:0,background:"#020817"},
  pill:    {background:"transparent",border:"1px solid #334155",color:"#64748b",fontSize:10,cursor:"pointer",padding:"4px 10px",borderRadius:2,whiteSpace:"nowrap",flexShrink:0,fontWeight:700},
  pillOn:  {background:"#172554",borderColor:"#3b82f6",color:"#93c5fd"},
  toggle:  {display:"flex",border:"1px solid #334155",borderRadius:3,overflow:"hidden",flexShrink:0},
  tBtn:    {background:"transparent",border:"none",color:"#64748b",fontSize:12,cursor:"pointer",padding:"4px 13px",fontWeight:700},
  tOn:     {background:"#172554",color:"#93c5fd"},
  errBar:  {padding:"5px 14px",background:"#1c0a0a",borderBottom:"1px solid #7f1d1d",fontSize:10,color:"#fca5a5",flexShrink:0},
  map:     {flex:1,position:"relative",overflow:"hidden",background:"#0f172a"},
  center:  {position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"},
  spinner: {width:34,height:34,border:"2px solid #1e293b",borderTop:"2px solid #38bdf8",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
  legend:  {position:"absolute",bottom:10,right:12,display:"flex",gap:6,alignItems:"flex-end",pointerEvents:"none",background:"rgba(2,8,23,0.7)",padding:"6px 8px",borderRadius:4},
  overlay: {position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"flex-end",zIndex:100},
  sheet:   {width:"100%",background:"#020817",borderTop:"1px solid #1e293b",padding:"22px 18px 40px",borderRadius:"18px 18px 0 0"},
  ttTicker:{fontSize:28,fontWeight:900,color:"#f1f5f9",letterSpacing:"-0.01em"},
  ttSub:   {fontSize:11,color:"#475569",marginTop:4},
  ttGrid:  {display:"flex",flexDirection:"column",gap:0},
  ttRow:   {display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #1e293b"},
  ttLbl:   {fontSize:10,color:"#475569",letterSpacing:"0.1em"},
  ttVal:   {fontSize:15,color:"#e2e8f0",fontWeight:700},
  closeBtn:{background:"transparent",border:"1px solid #334155",color:"#64748b",width:30,height:30,cursor:"pointer",fontSize:13,borderRadius:3},
};

const CSS = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { overscroll-behavior:none; background:#0f172a; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.15} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  button:active { opacity:0.6; }
  ::-webkit-scrollbar { display:none; }
`;
