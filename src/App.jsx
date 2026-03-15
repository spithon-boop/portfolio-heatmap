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
      const scaled = (remaining[i].value / total) * (rw * rh);
      row.push({ ...remaining[i], scaled });
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
      const sc = (remaining[0].value / total) * (rw * rh);
      row.push({ ...remaining[0], scaled: sc });
      rowSum = sc;
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

// ─── Finviz-style color scale ─────────────────────────────────────────────────
function getColor(pct) {
  if (pct == null) return "#1a2535";
  const v = Math.max(-10, Math.min(10, pct));
  if (v >= 0) {
    const t = v / 10;
    // Finviz greens: dark green → bright green
    const r = Math.round(0  + t * 20);
    const g = Math.round(100 + t * 110);
    const b = Math.round(0  + t * 20);
    return `rgb(${r},${g},${b})`;
  } else {
    const t = Math.abs(v) / 10;
    // Finviz reds: dark red → bright red
    const r = Math.round(100 + t * 130);
    const g = Math.round(0   + t * 10);
    const b = Math.round(0   + t * 10);
    return `rgb(${r},${g},${b})`;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const GAP    = 2;
const fmtPct = (v) => `${(v||0)>=0?"+":""}${(v||0).toFixed(2)}%`;
const fmtUSD = (v) => `$${Math.abs(v||0).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK   = (v) => {
  const a = Math.abs(v||0);
  const sign = (v||0) >= 0 ? "+" : "-";
  if (a >= 1e6) return `${sign}$${(a/1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a/1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
};
const pnlCol = (v) => (v||0) >= 0 ? "#4ade80" : "#f87171";

const METRICS = [
  { key:"total", label:"P&L Total", pctKey:"pnlPct",  dolKey:"pnl"      },
  { key:"1d",    label:"1 Día",     pctKey:"chg1d",   dolKey:"chg1dVal" },
  { key:"1w",    label:"1 Semana",  pctKey:null,       dolKey:null       },
  { key:"1m",    label:"1 Mes",     pctKey:null,       dolKey:null       },
  { key:"ytd",   label:"YTD",       pctKey:null,       dolKey:null       },
];

export default function App() {
  const [holdings,    setHoldings]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error,       setError]       = useState(null);
  const [tooltip,     setTooltip]     = useState(null);
  const [metric,      setMetric]      = useState("total");
  const [dispMode,    setDispMode]    = useState("pct");
  const [sz,          setSz]          = useState({ w:800, h:500 });
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

  const totalValue  = items.reduce((s,i) => s+i.value, 0);
  const totalCost   = items.reduce((s,i) => s+i.cost,  0);
  const totalPnL    = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL/totalCost)*100 : 0;
  const total1dVal  = items.reduce((s,i) => s+(i.chg1dVal??0), 0);
  const total1dPct  = totalValue > 0 ? items.reduce((s,i) => s+(i.chg1d??0)*i.value,0)/totalValue : 0;

  const cur = METRICS.find(m => m.key === metric);
  const getCellPct  = (c) => cur.pctKey ? (c[cur.pctKey]??null) : null;
  const getCellDisp = (c) => {
    const pct = getCellPct(c);
    if (pct === null) return "—";
    if (dispMode === "pct") return fmtPct(pct);
    const dv = cur.dolKey ? c[cur.dolKey] : null;
    return dv != null ? fmtK(dv) : fmtPct(pct);
  };

  const layout = items.length > 0 && sz.w > 10 && sz.h > 10
    ? squarify(items, 0, 0, sz.w, sz.h) : [];

  return (
    <div style={S.screen}>
      <style>{CSS}</style>

      {/* ── Header ── */}
      <div style={S.header}>
        <span style={S.logo}>PORTFOLIO <span style={{color:"#38bdf8"}}>MAP</span></span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {loading && <div style={S.spinner2}/>}
          <button style={S.iconBtn} onClick={fetchData}>↻</button>
          <a href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo"
            target="_blank" rel="noreferrer"
            style={{...S.iconBtn,textDecoration:"none",display:"flex",alignItems:"center",justifyContent:"center"}}>⊞</a>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {items.length > 0 && (
        <div style={S.statsBar}>
          <StatItem label="VALOR TOTAL" value={fmtUSD(totalValue)} />
          <div style={S.sdiv}/>
          <StatItem label="P&L TOTAL"
            value={`${totalPnL>=0?"+":"-"}${fmtUSD(totalPnL)}`}
            sub={fmtPct(totalPnLPct)} color={pnlCol(totalPnLPct)}/>
          {metric==="1d" && <>
            <div style={S.sdiv}/>
            <StatItem label="HOY"
              value={fmtK(total1dVal)}
              sub={fmtPct(total1dPct)} color={pnlCol(total1dPct)}/>
          </>}
          {lastUpdated && (
            <span style={{marginLeft:"auto",fontSize:9,color:"#334155",alignSelf:"center",flexShrink:0}}>
              {lastUpdated.toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}
            </span>
          )}
        </div>
      )}

      {/* ── Controls ── */}
      {items.length > 0 && (
        <div style={S.ctrlBar}>
          <div style={{display:"flex",gap:2,flex:1,overflowX:"auto"}}>
            {METRICS.map(m => (
              <button key={m.key}
                style={{...S.pill,...(metric===m.key?S.pillOn:{}),...(!m.pctKey?S.pillDim:{})}}
                onClick={()=>setMetric(m.key)}>{m.label}</button>
            ))}
          </div>
          <div style={S.toggle}>
            <button style={{...S.tBtn,...(dispMode==="pct"?S.tOn:{})}} onClick={()=>setDispMode("pct")}>%</button>
            <button style={{...S.tBtn,...(dispMode==="usd"?S.tOn:{})}} onClick={()=>setDispMode("usd")}>$</button>
          </div>
        </div>
      )}

      {error && <div style={S.errBar}>⚠ {error}</div>}

      {/* ── Map ── */}
      <div ref={mapRef} style={S.map}>
        {loading && items.length===0 ? (
          <div style={S.center}>
            <div style={S.spinner}/>
            <div style={{fontSize:10,color:"#334155",marginTop:14,letterSpacing:"0.15em"}}>CARGANDO...</div>
          </div>
        ) : items.length===0 ? (
          <div style={S.center}><span style={{color:"#334155",fontSize:12}}>Sin datos</span></div>
        ) : (
          <svg width="100%" height="100%"
            viewBox={`0 0 ${sz.w} ${sz.h}`}
            preserveAspectRatio="none" style={{display:"block"}}>
            {layout.map(cell => {
              const pct     = getCellPct(cell);
              const bg      = getColor(pct);
              const disp    = getCellDisp(cell);
              const noData  = pct === null;
              const isPos   = (pct??0) >= 0;

              // Font sizes scale with cell size — bigger cell = bigger text
              const area  = cell.w * cell.h;
              const fs    = Math.min(18, Math.max(9,  Math.sqrt(area) / 11));
              const subFs = Math.min(14, Math.max(8,  Math.sqrt(area) / 14));
              const wgtFs = Math.min(10, Math.max(7,  Math.sqrt(area) / 20));

              const showTicker = cell.w > 28 && cell.h > 16;
              const showVal    = cell.h > 30 && cell.w > 32;
              const showWeight = cell.h > 55 && cell.w > 55;

              const midY    = cell.y + cell.h / 2;
              const lineH   = subFs + 4;
              const lines   = showVal ? (showWeight ? 3 : 2) : 1;
              const blockH  = fs + (lines-1) * lineH;
              const startY  = midY - blockH/2 + fs*0.78;

              return (
                <g key={cell.symbol} style={{cursor:"pointer"}}
                  onClick={()=>setTooltip(t=>t?.symbol===cell.symbol?null:cell)}>
                  <rect x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0,cell.w-GAP*2)} height={Math.max(0,cell.h-GAP*2)}
                    fill={bg} rx={1}/>
                  {/* Top gloss */}
                  <rect x={cell.x+GAP} y={cell.y+GAP}
                    width={Math.max(0,cell.w-GAP*2)} height={Math.min(cell.h*0.4,18)}
                    fill="white" opacity={0.07} rx={1}/>
                  {/* Ticker */}
                  {showTicker && (
                    <text x={cell.x+cell.w/2} y={showVal?startY:midY+fs*0.35}
                      textAnchor="middle" dominantBaseline="auto"
                      fill="white" fontSize={fs}
                      fontFamily="Arial,Helvetica,sans-serif" fontWeight="bold"
                      style={{textShadow:"0 1px 3px rgba(0,0,0,0.5)"}}>
                      {cell.symbol}
                    </text>
                  )}
                  {/* Value */}
                  {showVal && (
                    <text x={cell.x+cell.w/2} y={startY+lineH}
                      textAnchor="middle"
                      fill={noData?"rgba(255,255,255,0.3)":isPos?"#bbf7d0":"#fecaca"}
                      fontSize={subFs}
                      fontFamily="Arial,Helvetica,sans-serif" fontWeight="600">
                      {disp}
                    </text>
                  )}
                  {/* Weight */}
                  {showWeight && (
                    <text x={cell.x+cell.w/2} y={startY+lineH*2}
                      textAnchor="middle"
                      fill="rgba(255,255,255,0.45)"
                      fontSize={wgtFs}
                      fontFamily="Arial,Helvetica,sans-serif">
                      {(cell.value/totalValue*100).toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Legend */}
        {layout.length > 0 && (
          <div style={S.legend}>
            {[-10,-5,-2,0,2,5,10].map(v=>(
              <div key={v} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:20,height:10,background:getColor(v),borderRadius:1}}/>
                <span style={{fontSize:7,color:"#475569"}}>{v>0?"+":""}{v}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Detail panel ── */}
      {tooltip && (() => {
        const pnl    = tooltip.pnl ?? (tooltip.value - tooltip.shares*tooltip.avgCost);
        const pnlPct = tooltip.pnlPct ?? (tooltip.avgCost>0?((tooltip.price-tooltip.avgCost)/tooltip.avgCost)*100:0);
        const wt     = (tooltip.value/totalValue*100).toFixed(2);
        return (
          <div style={S.overlay} onClick={()=>setTooltip(null)}>
            <div style={S.sheet} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={S.ttTicker}>{tooltip.symbol}</div>
                  <div style={S.ttSub}>{wt}% del portfolio · {tooltip.shares} acciones</div>
                </div>
                <button style={S.closeBtn} onClick={()=>setTooltip(null)}>✕</button>
              </div>
              <div style={S.ttGrid}>
                {[
                  ["PRECIO ACTUAL",  fmtUSD(tooltip.price),                           null],
                  ["PRECIO MEDIO",   fmtUSD(tooltip.avgCost),                         null],
                  ["VALOR ACTUAL",   fmtUSD(tooltip.value),                           null],
                  ["COSTE TOTAL",    fmtUSD(tooltip.shares*tooltip.avgCost),          null],
                  ["P&L ($)",        `${pnl>=0?"+":"-"}${fmtUSD(pnl)}`,              pnlCol(pnl)],
                  ["P&L (%)",        fmtPct(pnlPct),                                  pnlCol(pnlPct)],
                  ["HOY ($)",        tooltip.chg1dVal!=null?fmtK(tooltip.chg1dVal):"—", tooltip.chg1dVal!=null?pnlCol(tooltip.chg1dVal):null],
                  ["HOY (%)",        tooltip.chg1d!=null?fmtPct(tooltip.chg1d):"—",  tooltip.chg1d!=null?pnlCol(tooltip.chg1d):null],
                  ["MÁX 52S",        tooltip.week52High?fmtUSD(tooltip.week52High):"—", null],
                  ["MÍN 52S",        tooltip.week52Low?fmtUSD(tooltip.week52Low):"—",  null],
                ].map(([l,v,c])=>(
                  <div key={l} style={S.ttRow}>
                    <span style={S.ttLbl}>{l}</span>
                    <span style={{...S.ttVal,...(c?{color:c}:{})}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:16,fontSize:9,color:"#1e3a50",textAlign:"center"}}>
                Precios: Yahoo Finance · Posiciones: Google Sheets
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function StatItem({label,value,sub,color}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,paddingRight:16}}>
      <span style={{fontSize:9,color:"#334155",letterSpacing:"0.1em"}}>{label}</span>
      <span style={{fontSize:12,color:color||"#94a3b8",fontWeight:700}}>
        {value}{sub&&<span style={{fontSize:10,marginLeft:5,color}}>{sub}</span>}
      </span>
    </div>
  );
}

const S = {
  screen:   {height:"100dvh",background:"#0f172a",fontFamily:"Arial,Helvetica,sans-serif",color:"#e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden"},
  header:   {padding:"10px 14px",borderBottom:"1px solid #1e293b",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:"#0f172a"},
  logo:     {fontSize:15,fontWeight:900,color:"#e2e8f0",letterSpacing:"0.05em"},
  iconBtn:  {background:"transparent",border:"1px solid #1e293b",color:"#475569",fontSize:14,cursor:"pointer",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:3},
  spinner2: {width:8,height:8,borderRadius:"50%",background:"#38bdf8",animation:"pulse 1s infinite"},
  statsBar: {padding:"7px 14px",borderBottom:"1px solid #1e293b",display:"flex",alignItems:"center",flexShrink:0,overflowX:"auto",background:"#0f172a"},
  sdiv:     {width:1,background:"#1e293b",margin:"0 16px 0 0",alignSelf:"stretch"},
  ctrlBar:  {padding:"5px 10px",borderBottom:"1px solid #1e293b",display:"flex",gap:6,alignItems:"center",flexShrink:0,background:"#0f172a"},
  pill:     {background:"transparent",border:"1px solid #1e293b",color:"#475569",fontSize:10,cursor:"pointer",padding:"3px 9px",borderRadius:2,whiteSpace:"nowrap",flexShrink:0,fontWeight:600},
  pillOn:   {background:"#1e3a5f",borderColor:"#2563eb",color:"#93c5fd"},
  pillDim:  {opacity:0.45},
  toggle:   {display:"flex",border:"1px solid #1e293b",borderRadius:3,overflow:"hidden",flexShrink:0},
  tBtn:     {background:"transparent",border:"none",color:"#475569",fontSize:11,cursor:"pointer",padding:"3px 11px",fontWeight:700},
  tOn:      {background:"#1e3a5f",color:"#93c5fd"},
  errBar:   {padding:"5px 14px",background:"#1c0a0a",borderBottom:"1px solid #7f1d1d",fontSize:10,color:"#fca5a5",flexShrink:0},
  map:      {flex:1,position:"relative",overflow:"hidden"},
  center:   {position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"},
  spinner:  {width:32,height:32,border:"2px solid #1e293b",borderTop:"2px solid #38bdf8",borderRadius:"50%",animation:"spin 0.8s linear infinite"},
  legend:   {position:"absolute",bottom:8,right:10,display:"flex",gap:6,alignItems:"flex-end",pointerEvents:"none"},
  overlay:  {position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",alignItems:"flex-end",zIndex:100},
  sheet:    {width:"100%",background:"#0f172a",borderTop:"2px solid #1e293b",padding:"20px 18px 36px",borderRadius:"16px 16px 0 0"},
  ttTicker: {fontSize:26,fontWeight:900,color:"#f1f5f9"},
  ttSub:    {fontSize:10,color:"#334155",marginTop:3},
  ttGrid:   {display:"flex",flexDirection:"column",gap:10},
  ttRow:    {display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid #1e293b",paddingBottom:8},
  ttLbl:    {fontSize:10,color:"#475569",letterSpacing:"0.08em"},
  ttVal:    {fontSize:13,color:"#94a3b8",fontWeight:700},
  closeBtn: {background:"transparent",border:"1px solid #1e293b",color:"#475569",width:28,height:28,cursor:"pointer",fontSize:12,borderRadius:3},
};

const CSS = `
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { overscroll-behavior:none; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
  @keyframes spin   { to{transform:rotate(360deg)} }
  button:active { opacity:0.6; }
  ::-webkit-scrollbar { display:none; }
`;
