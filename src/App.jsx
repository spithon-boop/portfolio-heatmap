import { useState, useEffect, useCallback, useRef } from "react";

function buildTreemap(items, W, H) {
  if (!items.length || W<=0 || H<=0) return [];
  const total = items.reduce((s,i)=>s+i.value,0);
  if (!total) return [];
  const nodes = items.map(i=>({...i, area:(i.value/total)*W*H}));
  return layout(nodes, 0, 0, W, H);
}

function layout(nodes, x, y, w, h) {
  if (!nodes.length) return [];
  if (nodes.length===1) return [{...nodes[0],x,y,w,h}];
  const results=[];
  let rem=[...nodes], rx=x, ry=y, rw=w, rh=h;
  while (rem.length>0) {
    if (rem.length===1) { results.push({...rem[0],x:rx,y:ry,w:rw,h:rh}); break; }
    const row=[]; let rowA=0, prev=Infinity;
    const side=Math.min(rw,rh);
    for (let i=0;i<rem.length;i++) {
      row.push(rem[i]); rowA+=rem[i].area;
      const mx=Math.max(...row.map(r=>r.area)), mn=Math.min(...row.map(r=>r.area));
      const ratio=Math.max((side*side*mx)/(rowA*rowA),(rowA*rowA)/(side*side*mn));
      if (ratio>prev && i>0) { row.pop(); rowA-=rem[i].area; break; }
      prev=ratio;
    }
    rem=rem.slice(row.length);
    const rA=row.reduce((s,r)=>s+r.area,0);
    if (rw>=rh) {
      const cw=rA/rh; let cy=ry;
      row.forEach(r=>{ const ch=(r.area/rA)*rh; results.push({...r,x:rx,y:cy,w:cw,h:ch}); cy+=ch; });
      rx+=cw; rw-=cw;
    } else {
      const rh2=rA/rw; let cx=rx;
      row.forEach(r=>{ const cw2=(r.area/rA)*rw; results.push({...r,x:cx,y:ry,w:cw2,h:rh2}); cx+=cw2; });
      ry+=rh2; rh-=rh2;
    }
    if (rw<0.5||rh<0.5) break;
  }
  return results;
}

// Finviz exact color palette
function getColor(pct) {
  if (pct==null) return "#1a1a1a";
  const v=Math.max(-10,Math.min(10,pct));
  if (v>=0) {
    const t=v/10;
    const g=Math.round(60+t*195);
    const r=Math.round(0+t*15);
    return `rgb(${r},${g},0)`;
  } else {
    const t=Math.abs(v)/10;
    const r=Math.round(60+t*195);
    return `rgb(${r},0,0)`;
  }
}

const GAP=2;
const fmtPct=v=>`${(v||0)>=0?"+":""}${(v||0).toFixed(2)}%`;
const fmtUSD=v=>`$${Math.abs(v||0).toLocaleString("en",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmtK=v=>{ const a=Math.abs(v||0),s=(v||0)>=0?"+":"-"; return a>=1e6?`${s}$${(a/1e6).toFixed(1)}M`:a>=1e3?`${s}$${(a/1e3).toFixed(1)}K`:`${s}$${a.toFixed(0)}`; };
const pnlCol=v=>(v||0)>=0?"#00dd44":"#ff3322";

const METRICS=[
  {key:"total",label:"P&L Total", pctKey:"pnlPct"},
  {key:"1d",   label:"1 Día",     pctKey:"chg1d"},
  {key:"1w",   label:"1 Semana",  pctKey:"chg1w"},
  {key:"1m",   label:"1 Mes",     pctKey:"chg1m"},
  {key:"ytd",  label:"YTD",       pctKey:"chgYtd"},
];

export default function App() {
  const [holdings,setHoldings]=useState([]);
  const [loading,setLoading]=useState(true);
  const [lastUpdated,setLastUpdated]=useState(null);
  const [error,setError]=useState(null);
  const [tooltip,setTooltip]=useState(null);
  const [metric,setMetric]=useState("total");
  const [dispMode,setDispMode]=useState("pct");
  const [sz,setSz]=useState({w:800,h:600});
  const mapRef=useRef(null);
  const timerRef=useRef(null);

  useEffect(()=>{
    const obs=new ResizeObserver(entries=>{
      for (const e of entries) setSz({w:Math.floor(e.contentRect.width),h:Math.floor(e.contentRect.height)});
    });
    if (mapRef.current) obs.observe(mapRef.current);
    return ()=>obs.disconnect();
  },[]);

  const fetchData=useCallback(async()=>{
    setLoading(true); setError(null);
    try {
      const res=await fetch("/api/quotes");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data=await res.json();
      if (data.error) throw new Error(data.error);
      setHoldings(data.holdings||[]);
      setLastUpdated(new Date());
    } catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{
    fetchData();
    timerRef.current=setInterval(fetchData,120000);
    return ()=>clearInterval(timerRef.current);
  },[fetchData]);

  const items=holdings.filter(h=>h.value>0).map(h=>{
    const cost=h.shares*h.avgCost;
    const pnl=h.value-cost;
    const pnlPct=cost>0?((h.price-h.avgCost)/h.avgCost)*100:0;
    return {...h,cost,pnl,pnlPct};
  }).sort((a,b)=>b.value-a.value);

  const totalValue=items.reduce((s,i)=>s+i.value,0);
  const totalCost=items.reduce((s,i)=>s+i.cost,0);
  const totalPnL=totalValue-totalCost;
  const totalPnLPct=totalCost>0?(totalPnL/totalCost)*100:0;

  const cur=METRICS.find(m=>m.key===metric);
  const getCellPct=c=>c[cur.pctKey]??null;
  const getCellDisp=c=>{
    const pct=getCellPct(c);
    if (pct===null) return "—";
    return dispMode==="pct"?fmtPct(pct):fmtK((pct/100)*c.value);
  };

  const layout=buildTreemap(items,sz.w,sz.h);

  // Finviz UI palette
  const BG="#0d0d0d", HDR="#161616", BRD="#2a2a2a", TXT="#ffffff", DIM="#888888";

  return (
    <div style={{height:"100dvh",background:BG,fontFamily:"Arial,Helvetica,sans-serif",color:TXT,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
        body{overscroll-behavior:none}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.2}}
        .btn{background:#222;border:1px solid #444;color:#ccc;font-size:11px;font-weight:700;cursor:pointer;padding:4px 10px;border-radius:3px;font-family:Arial,sans-serif;white-space:nowrap}
        .btn:hover{background:#333;color:#fff}
        .pill{background:#1a1a1a;border:1px solid #333;color:#aaa;font-size:11px;font-weight:700;cursor:pointer;padding:4px 11px;border-radius:3px;font-family:Arial,sans-serif;white-space:nowrap;flex-shrink:0}
        .pill:hover{background:#2a2a2a;color:#fff}
        .pill.on{background:#1a3a6a;border-color:#4a8aff;color:#ffffff}
        .tog{background:#1a1a1a;border:none;color:#888;font-size:12px;font-weight:700;cursor:pointer;padding:4px 13px;font-family:Arial,sans-serif}
        .tog:hover{color:#fff}
        .tog.on{background:#1a3a6a;color:#ffffff}
        button:active{opacity:0.7}
        ::-webkit-scrollbar{display:none}
      `}</style>

      {/* Header */}
      <div style={{padding:"8px 12px",borderBottom:`1px solid ${BRD}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,background:HDR}}>
        <span style={{fontSize:15,fontWeight:900,color:TXT,letterSpacing:"0.06em"}}>
          PORTFOLIO <span style={{color:"#4a8aff"}}>MAP</span>
        </span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {loading && <div style={{width:7,height:7,borderRadius:"50%",background:"#4a8aff",animation:"pulse 1s infinite"}}/>}
          <button className="btn" onClick={fetchData}>↻ Refrescar</button>
          <a href="https://docs.google.com/spreadsheets/d/1k1wbKI5hTN88ibWJ_wm0sWnG-wWvvkiAxs6jHlYuJgo" target="_blank" rel="noreferrer" style={{textDecoration:"none"}}>
            <button className="btn">⊞ Sheets</button>
          </a>
        </div>
      </div>

      {/* Stats bar */}
      {items.length>0 && (
        <div style={{padding:"6px 12px",borderBottom:`1px solid ${BRD}`,display:"flex",alignItems:"center",flexShrink:0,background:HDR,overflowX:"auto",gap:0}}>
          <SB label="VALOR TOTAL" value={fmtUSD(totalValue)}/>
          <div style={{width:1,background:BRD,margin:"0 14px",alignSelf:"stretch"}}/>
          <SB label="P&L TOTAL" value={`${totalPnL>=0?"+":"-"}${fmtUSD(totalPnL)}`} sub={fmtPct(totalPnLPct)} color={pnlCol(totalPnLPct)}/>
          <div style={{width:1,background:BRD,margin:"0 14px",alignSelf:"stretch"}}/>
          <SB label="POSICIONES" value={String(items.length)}/>
          {lastUpdated && <span style={{marginLeft:"auto",fontSize:9,color:DIM,flexShrink:0}}>{lastUpdated.toLocaleTimeString("es",{hour:"2-digit",minute:"2-digit"})}</span>}
        </div>
      )}

      {/* Controls */}
      {items.length>0 && (
        <div style={{padding:"5px 10px",borderBottom:`1px solid ${BRD}`,display:"flex",gap:4,alignItems:"center",flexShrink:0,background:HDR}}>
          <div style={{display:"flex",gap:3,flex:1,overflowX:"auto"}}>
            {METRICS.map(m=>(
              <button key={m.key} className={`pill${metric===m.key?" on":""}`} onClick={()=>setMetric(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
          <div style={{display:"flex",border:`1px solid ${BRD}`,borderRadius:3,overflow:"hidden",flexShrink:0,marginLeft:8}}>
            <button className={`tog${dispMode==="pct"?" on":""}`} onClick={()=>setDispMode("pct")}>%</button>
            <button className={`tog${dispMode==="usd"?" on":""}`} onClick={()=>setDispMode("usd")}>$</button>
          </div>
        </div>
      )}

      {error && <div style={{padding:"5px 12px",background:"#2a0000",borderBottom:"1px solid #550000",fontSize:10,color:"#ff6666",flexShrink:0}}>⚠ {error}</div>}

      {/* Treemap */}
      <div ref={mapRef} style={{flex:1,position:"relative",overflow:"hidden",background:BG}}>
        {loading && items.length===0 ? (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div style={{width:36,height:36,border:"2px solid #333",borderTop:"2px solid #4a8aff",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
            <div style={{fontSize:11,color:DIM,marginTop:14,letterSpacing:"0.15em"}}>CARGANDO...</div>
          </div>
        ):(
          <svg style={{position:"absolute",inset:0,display:"block"}} width={sz.w} height={sz.h}>
            {layout.map(cell=>{
              const pct=getCellPct(cell);
              const bg=getColor(pct);
              const disp=getCellDisp(cell);
              const noData=pct===null;
              const cw=Math.max(0,cell.w-GAP*2), ch=Math.max(0,cell.h-GAP*2);
              const cx=cell.x+GAP, cy=cell.y+GAP;

              // Font size proportional to cell area — bigger weight = bigger text
              const area=cw*ch;
              const fs   =Math.min(30,Math.max(11,Math.sqrt(area)/8.5));
              const subFs=Math.min(20,Math.max(9, Math.sqrt(area)/11));
              const wgtFs=Math.min(12,Math.max(7, Math.sqrt(area)/17));

              const showTicker=cw>24&&ch>14;
              const showVal   =ch>30&&cw>28;
              const showWgt   =ch>58&&cw>58;

              const lineH=subFs+6;
              const nLines=showVal?(showWgt?3:2):1;
              const blockH=fs+(nLines-1)*lineH;
              const midX=cx+cw/2, midY=cy+ch/2;
              const topY=midY-blockH/2+fs*0.75;

              return (
                <g key={cell.symbol} style={{cursor:"pointer"}} onClick={()=>setTooltip(t=>t?.symbol===cell.symbol?null:cell)}>
                  <rect x={cx} y={cy} width={cw} height={ch} fill={bg} rx={1}/>
                  {/* Subtle top gloss like Finviz */}
                  <rect x={cx} y={cy} width={cw} height={Math.min(ch*0.35,16)} fill="white" opacity={0.06} rx={1}/>
                  {showTicker&&(
                    <text x={midX} y={showVal?topY:midY+fs*0.35}
                      textAnchor="middle" fill="#ffffff"
                      fontSize={fs} fontFamily="Arial,sans-serif" fontWeight="900"
                      style={{userSelect:"none",textShadow:"0 1px 4px rgba(0,0,0,0.8)"}}>
                      {cell.symbol}
                    </text>
                  )}
                  {showVal&&(
                    <text x={midX} y={topY+lineH}
                      textAnchor="middle"
                      fill={noData?"#555":"#ffffff"}
                      fontSize={subFs} fontFamily="Arial,sans-serif" fontWeight="700"
                      style={{userSelect:"none"}}>
                      {disp}
                    </text>
                  )}
                  {showWgt&&(
                    <text x={midX} y={topY+lineH*2}
                      textAnchor="middle" fill="rgba(255,255,255,0.5)"
                      fontSize={wgtFs} fontFamily="Arial,sans-serif"
                      style={{userSelect:"none"}}>
                      {(cell.value/totalValue*100).toFixed(1)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Finviz-style legend */}
        {layout.length>0&&(
          <div style={{position:"absolute",bottom:8,right:10,display:"flex",gap:4,alignItems:"center",background:"rgba(0,0,0,0.75)",padding:"5px 8px",borderRadius:3}}>
            {[-10,-5,-2,0,2,5,10].map(v=>(
              <div key={v} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <div style={{width:22,height:10,background:getColor(v),borderRadius:1}}/>
                <span style={{fontSize:8,color:"#666"}}>{v>0?"+":""}{v}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {tooltip&&(()=>{
        const pnl=tooltip.pnl??(tooltip.value-tooltip.shares*tooltip.avgCost);
        const pnlPct=tooltip.pnlPct??(tooltip.avgCost>0?((tooltip.price-tooltip.avgCost)/tooltip.avgCost)*100:0);
        const wt=totalValue>0?(tooltip.value/totalValue*100).toFixed(2):"0";
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",display:"flex",alignItems:"flex-end",zIndex:100}} onClick={()=>setTooltip(null)}>
            <div style={{width:"100%",background:"#111",borderTop:"1px solid #333",padding:"20px 18px 38px",borderRadius:"16px 16px 0 0"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                <div>
                  <div style={{fontSize:28,fontWeight:900,color:"#fff"}}>{tooltip.symbol}</div>
                  <div style={{fontSize:11,color:"#666",marginTop:3}}>{wt}% del portfolio · {tooltip.shares} acciones</div>
                </div>
                <button style={{background:"transparent",border:"1px solid #333",color:"#666",width:30,height:30,cursor:"pointer",fontSize:14,borderRadius:3}} onClick={()=>setTooltip(null)}>✕</button>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:0}}>
                {[
                  ["PRECIO ACTUAL", fmtUSD(tooltip.price),                           null],
                  ["PRECIO MEDIO",  fmtUSD(tooltip.avgCost),                         null],
                  ["VALOR ACTUAL",  fmtUSD(tooltip.value),                           null],
                  ["COSTE TOTAL",   fmtUSD(tooltip.shares*tooltip.avgCost),          null],
                  ["P&L ($)",       `${pnl>=0?"+":"-"}${fmtUSD(pnl)}`,             pnlCol(pnl)],
                  ["P&L (%)",       fmtPct(pnlPct),                                 pnlCol(pnlPct)],
                ].map(([l,v,c])=>(
                  <div key={l} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 0",borderBottom:"1px solid #222"}}>
                    <span style={{fontSize:10,color:"#666",letterSpacing:"0.1em"}}>{l}</span>
                    <span style={{fontSize:15,color:c||"#fff",fontWeight:700}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:14,fontSize:9,color:"#333",textAlign:"center"}}>Google Sheets · GOOGLEFINANCE() · {lastUpdated?.toLocaleTimeString("es")}</div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SB({label,value,sub,color}) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,paddingRight:14,flexShrink:0}}>
      <span style={{fontSize:9,color:"#666",letterSpacing:"0.1em"}}>{label}</span>
      <span style={{fontSize:13,color:color||"#fff",fontWeight:700}}>
        {value}{sub&&<span style={{fontSize:11,marginLeft:5,color}}>{sub}</span>}
      </span>
    </div>
  );
}
