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

// ─── Color scale ──────────────────────────────────────────────────────────────
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

// ─── Constants ────────────────────────────────────────────────────────────────
const METRICS = [
  { key: "1d", label: "1D" }, { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" }, { key: "6mo", label: "6M" }, { key: "1y", label: "1A" },
];
const GAP = 2;
const PF_COLORS = ["#3a7abf","#bf7a3a","#7abf3a","#bf3a7a","#3abfbf","#7a3abf","#bfbf3a"];

// ─── Storage ──────────────────────────────────────────────────────────────────
const LS_PF     = "pm_portfolios_v3";
const LS_ACTIVE = "pm_active_v3";
const savePFs   = (d) => { try { localStorage.setItem(LS_PF, JSON.stringify(d)); } catch {} };
const loadPFs   = ()  => { try { return JSON.parse(localStorage.getItem(LS_PF) || "null"); } catch { return null; } };
const saveAct   = (d) => { try { localStorage.setItem(LS_ACTIVE, JSON.stringify(d)); } catch {} };
const loadAct   = ()  => { try { return JSON.parse(localStorage.getItem(LS_ACTIVE) || "null"); } catch { return null; } };

// ─── CSV Parser (Yahoo Finance) ───────────────────────────────────────────────
function parseYahooCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error("CSV vacío o inválido");
  const raw = lines[0].split(",").map(h => h.replace(/"/g, "").trim().toLowerCase());
  const idx = (...candidates) => candidates.reduce((f, c) => f !== -1 ? f : raw.findIndex(h => h.includes(c)), -1);
  const symIdx  = idx("symbol");
  const qtyIdx  = idx("quantity", "shares");
  const costIdx = idx("purchase price", "avg cost", "average cost", "cost basis");
  if (symIdx === -1) throw new Error("Columna 'Symbol' no encontrada en el CSV");
  const holdings = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.replace(/"/g, "").trim());
    const symbol = cols[symIdx]?.toUpperCase();
    if (!symbol || symbol === "SYMBOL" || symbol.startsWith("-") || symbol === "") continue;
    const shares  = qtyIdx  !== -1 ? parseFloat(cols[qtyIdx])  || 0 : 1;
    const avgCost = costIdx !== -1 ? parseFloat(cols[costIdx]) || 0 : 0;
    if (shares > 0) holdings.push({ symbol, shares, avgCost });
  }
  if (!holdings.length) throw new Error("No hay posiciones con cantidad > 0 en el CSV");
  return holdings;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtPct = (v) => `${(v||0) >= 0 ? "+" : ""}${(v||0).toFixed(2)}%`;
const fmtUSD = (v) => `$${Math.abs(v||0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const uid    = () => Math.random().toString(36).slice(2, 8);

// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [portfolios, setPortfolios] = useState(null);
  const [activeIds,  setActiveIds]  = useState(null);
  const [quotes,     setQuotes]     = useState({});
  const [metric,     setMetric]     = useState("1d");
  const [loading,    setLoading]    = useState(false);
  const [lastUpdated,setLastUpdated]= useState(null);
  const [tooltip,    setTooltip]    = useState(null);
  const [modal,      setModal]      = useState(null); // "welcome"|"manage"|"add-manual"|"rename"
  const [error,      setError]      = useState(null);
  const [sz, setSz]                 = useState({ w: 390, h: 540 });
  const [manualForm, setManualForm] = useState({ symbol:"", shares:"", avgCost:"", portfolioId:"" });
  const [pendingCSVName, setPendingCSVName] = useState("");
  const containerRef       = useRef(null);
  const fileInputRef       = useRef(null);   // add new portfolio
  const updateFileRef      = useRef(null);   // update existing
  const pendingUpdateId    = useRef(null);
  const refreshTimer       = useRef(null);

  // ── Boot ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const saved = loadPFs();
    if (!saved || saved.length === 0) {
      setPortfolios([]);
      setActiveIds([]);
      setModal("welcome");
    } else {
      setPortfolios(saved);
      const savedActive = loadAct();
      setActiveIds(savedActive || saved.map(p => p.id));
    }
  }, []);

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries)
        setSz({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Fetch quotes ──────────────────────────────────────────────────────────
  const fetchQuotes = useCallback(async (pfs, ids) => {
    if (!pfs || !ids) return;
    const syms = [...new Set(
      pfs.filter(p => ids.includes(p.id)).flatMap(p => p.holdings.map(h => h.symbol))
    )];
    if (!syms.length) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(syms.join(","))}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const map = {};
      (data.quotes || []).forEach(q => { map[q.symbol] = q; });
      setQuotes(map);
      setLastUpdated(new Date());
    } catch {
      setError("No se pudo actualizar precios. Revisa conexión.");
    } finally { setLoading(false); }
  }, []);

  // ── Auto-refresh 60s ──────────────────────────────────────────────────────
  useEffect(() => {
    if (portfolios && activeIds) {
      fetchQuotes(portfolios, activeIds);
      clearInterval(refreshTimer.current);
      refreshTimer.current = setInterval(() => fetchQuotes(portfolios, activeIds), 60000);
    }
    return () => clearInterval(refreshTimer.current);
  }, [portfolios, activeIds, fetchQuotes]);

  // ── Helpers: modify portfolios ────────────────────────────────────────────
  const addPortfolio = useCallback((name, holdings) => {
    const newPf = {
      id: uid(), name,
      color: PF_COLORS[(portfolios?.length || 0) % PF_COLORS.length],
      holdings,
    };
    const updated = [...(portfolios || []), newPf];
    setPortfolios(updated); savePFs(updated);
    const newActive = [...(activeIds || []), newPf.id];
    setActiveIds(newActive); saveAct(newActive);
    return newPf.id;
  }, [portfolios, activeIds]);

  const updatePortfolioHoldings = useCallback((id, holdings) => {
    const updated = (portfolios || []).map(p => p.id === id ? { ...p, holdings } : p);
    setPortfolios(updated); savePFs(updated);
  }, [portfolios]);

  const removePortfolio = useCallback((id) => {
    const updated = (portfolios || []).filter(p => p.id !== id);
    setPortfolios(updated); savePFs(updated);
    const newActive = (activeIds || []).filter(i => i !== id);
    setActiveIds(newActive); saveAct(newActive);
  }, [portfolios, activeIds]);

  const toggleActive = useCallback((id) => {
    const newActive = (activeIds || []).includes(id)
      ? (activeIds || []).filter(i => i !== id)
      : [...(activeIds || []), id];
    setActiveIds(newActive); saveAct(newActive);
  }, [activeIds]);

  // ── CSV handler ───────────────────────────────────────────────────────────
  const handleCSV = useCallback((file, name, existingId) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const holdings = parseYahooCSV(e.target.result);
        if (existingId) {
          updatePortfolioHoldings(existingId, holdings);
        } else {
          const pfName = name || file.name.replace(/\.csv$/i, "").replace(/_/g, " ");
          addPortfolio(pfName, holdings);
        }
        setError(null); setModal(null);
      } catch (err) { setError(`CSV: ${err.message}`); }
    };
    reader.readAsText(file);
  }, [addPortfolio, updatePortfolioHoldings]);

  // ── Build treemap data ────────────────────────────────────────────────────
  const activePfs = (portfolios || []).filter(p => (activeIds || []).includes(p.id));
  const allHoldings = activePfs.flatMap(p => p.holdings.map(h => ({ ...h, portfolioId: p.id })));

  const items = allHoldings.map(h => {
    const q = quotes[h.symbol] || {};
    const price = q.price || h.avgCost || 0;
    const value = h.shares * price;
    return { ...h, ...q, value, pct: q.changePercent || 0, price };
  }).filter(i => i.value > 0).sort((a, b) => b.value - a.value);

  const totalValue  = items.reduce((s, i) => s + i.value, 0);
  const totalCost   = allHoldings.reduce((s, h) => s + h.shares * (h.avgCost || 0), 0);
  const totalPnL    = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const wavgChg     = totalValue > 0 ? items.reduce((s, i) => s + i.pct * i.value, 0) / totalValue : 0;

  const layout = items.length > 0 && sz.w > 10 && sz.h > 10
    ? squarify(items, 0, 0, sz.w, sz.h) : [];

  // ═════════════════════════════════════════════════════════════════════════
  if (portfolios === null) return <div style={{ background: "#070c14", height: "100dvh" }} />;

  return (
    <div style={S.screen}>
      <style>{CSS}</style>

      {/* Hidden file inputs */}
      <input ref={fileInputRef} type="file" accept=".csv" style={{ display:"none" }}
        onChange={e => {
          handleCSV(e.target.files?.[0], pendingCSVName || null, null);
          e.target.value = "";
        }} />
      <input ref={updateFileRef} type="file" accept=".csv" style={{ display:"none" }}
        onChange={e => {
          handleCSV(e.target.files?.[0], null, pendingUpdateId.current);
          e.target.value = "";
        }} />

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
          <span style={S.logo}>PORTFOLIO</span>
          <span style={S.logoAccent}>MAP</span>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {loading && <span style={S.dot} />}
          <button style={S.iconBtn} onClick={() => fetchQuotes(portfolios, activeIds)} title="Refrescar">↻</button>
          <button style={S.iconBtn} onClick={() => setModal("manage")} title="Gestionar carteras">☰</button>
        </div>
      </div>

      {/* ── Portfolio filter pills ── */}
      {(portfolios || []).length > 0 && (
        <div style={S.pillBar}>
          {(portfolios || []).map(p => {
            const isOn = (activeIds || []).includes(p.id);
            return (
              <button key={p.id} style={{
                ...S.pill,
                borderColor: isOn ? p.color : "#0e1e2e",
                color:       isOn ? p.color : "#1e3a50",
                background:  isOn ? `${p.color}18` : "transparent",
              }} onClick={() => toggleActive(p.id)}>{p.name}</button>
            );
          })}
        </div>
      )}

      {/* ── Stats bar ── */}
      {items.length > 0 && (
        <div style={S.statsBar}>
          <Stat label="VALOR"   value={fmtUSD(totalValue)} />
          <div style={S.statDivider} />
          <Stat label="P&L" value={`${totalPnL >= 0 ? "+" : "-"}${fmtUSD(totalPnL)} (${fmtPct(totalPnLPct)})`}
            color={totalPnL >= 0 ? "#4ac878" : "#d05050"} />
          <div style={S.statDivider} />
          <Stat label="HOY" value={fmtPct(wavgChg)} color={wavgChg >= 0 ? "#4ac878" : "#d05050"} />
          {lastUpdated && (
            <span style={{ marginLeft:"auto", fontSize:9, color:"#1a3050", alignSelf:"center" }}>
              {lastUpdated.toLocaleTimeString("es", { hour:"2-digit", minute:"2-digit" })}
            </span>
          )}
        </div>
      )}

      {/* ── Metric selector ── */}
      {items.length > 0 && (
        <div style={S.metricBar}>
          {METRICS.map(m => (
            <button key={m.key}
              style={{ ...S.metricBtn, ...(metric===m.key ? S.metricBtnOn : {}) }}
              onClick={() => setMetric(m.key)}>{m.label}</button>
          ))}
        </div>
      )}

      {error && <div style={S.errorBar}>{error}</div>}

      {/* ── Treemap ── */}
      <div ref={containerRef} style={S.mapContainer}>
        {items.length === 0 ? (
          <div style={S.emptyState}>
            <div style={{ fontSize:44, color:"#0d1e30" }}>◫</div>
            <div style={S.emptyTitle}>
              {!(portfolios||[]).length ? "CARGA TU PRIMERA CARTERA" : "SELECCIONA UNA CARTERA"}
            </div>
            <div style={S.emptyDesc}>
              {!(portfolios||[]).length
                ? "Importa tu CSV de Yahoo Finance para empezar"
                : "Activa al menos una cartera en los filtros de arriba"}
            </div>
            {!(portfolios||[]).length && (
              <button style={S.emptyBtn} onClick={() => setModal("manage")}>IMPORTAR CARTERA</button>
            )}
          </div>
        ) : (
          <svg width="100%" height="100%"
            viewBox={`0 0 ${sz.w} ${sz.h}`} preserveAspectRatio="none"
            style={{ display:"block" }}>
            {layout.map((cell) => {
              const bg  = getColor(cell.pct);
              const fs  = Math.min(15, Math.max(8, Math.min(cell.w, cell.h) / 5));
              const sub = Math.max(7, fs * 0.72);
              const showName = cell.w > 38 && cell.h > 20;
              const showPct  = cell.h > 30 && cell.w > 32;
              const showWt   = cell.h > 55 && cell.w > 55;
              const midY = cell.y + cell.h / 2;
              return (
                <g key={`${cell.symbol}-${cell.portfolioId}`} style={{ cursor:"pointer" }}
                  onClick={() => setTooltip(cell)}>
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
                      fill={cell.pct>=0 ? "#6de89a" : "#e87070"}
                      fontSize={sub} fontFamily="'IBM Plex Mono',monospace"
                    >{fmtPct(cell.pct)}</text>
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

      {/* ══ MODAL: WELCOME ══════════════════════════════════════════════════ */}
      {modal === "welcome" && (
        <div style={S.overlay}>
          <div style={{ ...S.card, maxWidth:380 }}>
            <div style={S.cardTitle}>BIENVENIDO</div>
            <div style={S.cardSub}>Portfolio Map</div>
            <p style={S.cardText}>
              Visualiza tus carteras de Yahoo Finance como un heatmap en tiempo real.
              Importa una o varias carteras en CSV y el mapa se actualiza solo.
            </p>
            <div style={S.infoBox}>
              <div style={S.infoTitle}>¿Cómo exportar de Yahoo Finance?</div>
              {[
                "Abre Yahoo Finance → tu cartera",
                "Pulsa el botón Download (esquina superior derecha)",
                "Selecciona el CSV aquí abajo",
              ].map((s, i) => (
                <div key={i} style={S.infoStep}>
                  <span style={S.infoNum}>{i+1}</span>{s}
                </div>
              ))}
            </div>
            <button style={S.btnPrimary} onClick={() => {
              setPendingCSVName("");
              setModal(null);
              setTimeout(() => fileInputRef.current?.click(), 100);
            }}>IMPORTAR CSV DE YAHOO FINANCE</button>
            <button style={S.btnGhost} onClick={() => setModal("add-manual")}>
              + Añadir valor manualmente
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL: MANAGE ═══════════════════════════════════════════════════ */}
      {modal === "manage" && (
        <div style={S.overlay} onClick={() => setModal(null)}>
          <div style={{ ...S.card, maxWidth:420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={S.cardTitle}>MIS CARTERAS</div>
              <button style={S.closeBtn} onClick={() => setModal(null)}>✕</button>
            </div>

            {(portfolios||[]).length === 0 && (
              <div style={{ fontSize:11, color:"#2a4060", marginBottom:16 }}>
                Aún no tienes carteras. Importa tu primer CSV.
              </div>
            )}

            {(portfolios||[]).map(p => (
              <div key={p.id} style={{ ...S.pfRow, borderLeftColor: p.color }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:"#c0d8f0", fontWeight:600 }}>{p.name}</div>
                  <div style={{ fontSize:10, color:"#2a4560", marginTop:2 }}>
                    {p.holdings.length} posiciones
                  </div>
                </div>
                <button style={S.smallBtn} onClick={() => {
                  pendingUpdateId.current = p.id;
                  setModal(null);
                  setTimeout(() => updateFileRef.current?.click(), 100);
                }}>↻ Actualizar</button>
                <button style={{ ...S.smallBtn, color:"#8a3030", borderColor:"#2a1010" }}
                  onClick={() => removePortfolio(p.id)}>✕</button>
              </div>
            ))}

            <div style={{ height:1, background:"#0a1e30", margin:"16px 0" }} />

            <button style={S.btnPrimary} onClick={() => {
              setPendingCSVName("");
              setModal(null);
              setTimeout(() => fileInputRef.current?.click(), 100);
            }}>+ Importar nueva cartera (CSV)</button>
            <button style={{ ...S.btnGhost, marginTop:8 }} onClick={() => setModal("add-manual")}>
              + Añadir valor manualmente
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL: ADD MANUAL ═══════════════════════════════════════════════ */}
      {modal === "add-manual" && (
        <div style={S.overlay} onClick={() => setModal(null)}>
          <div style={{ ...S.card, maxWidth:360 }} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div style={S.cardTitle}>AÑADIR VALOR</div>
              <button style={S.closeBtn} onClick={() => setModal(null)}>✕</button>
            </div>
            <Field label="TICKER (ej: AAPL, BTC-USD)">
              <input style={S.input} placeholder="AAPL"
                value={manualForm.symbol}
                onChange={e => setManualForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} />
            </Field>
            <Field label="NÚMERO DE ACCIONES / UNIDADES">
              <input style={S.input} type="number" placeholder="10"
                value={manualForm.shares}
                onChange={e => setManualForm(f => ({ ...f, shares: e.target.value }))} />
            </Field>
            <Field label="PRECIO MEDIO DE COMPRA (USD)">
              <input style={S.input} type="number" placeholder="150.00"
                value={manualForm.avgCost}
                onChange={e => setManualForm(f => ({ ...f, avgCost: e.target.value }))} />
            </Field>
            <Field label="AÑADIR A CARTERA">
              <select style={{ ...S.input, appearance:"none" }}
                value={manualForm.portfolioId}
                onChange={e => setManualForm(f => ({ ...f, portfolioId: e.target.value }))}>
                <option value="">— Crear cartera "Manual" —</option>
                {(portfolios||[]).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <button style={{ ...S.btnPrimary, marginTop:20 }} onClick={() => {
              const sym = manualForm.symbol.trim().toUpperCase();
              const shares = parseFloat(manualForm.shares) || 0;
              const avgCost = parseFloat(manualForm.avgCost) || 0;
              if (!sym || shares <= 0) { setError("Ticker y cantidad son obligatorios"); return; }
              const holding = { symbol: sym, shares, avgCost };
              if (manualForm.portfolioId) {
                const pf = (portfolios||[]).find(p => p.id === manualForm.portfolioId);
                if (pf) {
                  const newH = [...pf.holdings.filter(h => h.symbol !== sym), holding];
                  updatePortfolioHoldings(pf.id, newH);
                }
              } else {
                const manualPf = (portfolios||[]).find(p => p.name === "Manual");
                if (manualPf) {
                  updatePortfolioHoldings(manualPf.id, [...manualPf.holdings.filter(h => h.symbol !== sym), holding]);
                } else {
                  addPortfolio("Manual", [holding]);
                }
              }
              setManualForm({ symbol:"", shares:"", avgCost:"", portfolioId:"" });
              setModal(null); setError(null);
            }}>AÑADIR</button>
          </div>
        </div>
      )}

      {/* ══ DETAIL PANEL ════════════════════════════════════════════════════ */}
      {tooltip && (
        <div style={S.sheetOverlay} onClick={() => setTooltip(null)}>
          <div style={S.sheet} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
              <div>
                <div style={S.ttSymbol}>{tooltip.symbol}</div>
                <div style={S.ttMeta}>
                  {tooltip.shortName || ""}
                  {tooltip.portfolioId && (() => {
                    const pf = (portfolios||[]).find(p => p.id === tooltip.portfolioId);
                    return pf ? <span style={{ marginLeft:8, color:pf.color }}>· {pf.name}</span> : null;
                  })()}
                </div>
              </div>
              <button style={S.closeBtn} onClick={() => setTooltip(null)}>✕</button>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {(() => {
                const cost = (tooltip.shares||0) * (tooltip.avgCost||0);
                const pnl  = (tooltip.value||0) - cost;
                const pct  = cost > 0 ? (pnl / cost) * 100 : 0;
                return [
                  ["PRECIO",     fmtUSD(tooltip.price),       null],
                  ["CAMBIO HOY", fmtPct(tooltip.pct),         tooltip.pct >= 0 ? "#4ac878" : "#d05050"],
                  ["ACCIONES",   (tooltip.shares||0).toLocaleString("es"), null],
                  ["VALOR",      fmtUSD(tooltip.value),       null],
                  ["PESO",       `${(tooltip.value/totalValue*100).toFixed(2)}%`, null],
                  ["P&L",        `${pnl>=0?"+":"-"}${fmtUSD(pnl)} (${fmtPct(pct)})`, pnl>=0?"#4ac878":"#d05050"],
                  ["MÁX 52S",    tooltip.week52High ? fmtUSD(tooltip.week52High) : "—", null],
                  ["MÍN 52S",    tooltip.week52Low  ? fmtUSD(tooltip.week52Low)  : "—", null],
                ].map(([lbl, val, col]) => (
                  <div key={lbl} style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={S.ttLabel}>{lbl}</span>
                    <span style={{ ...S.ttValue, color: col||"#8ab8d8" }}>{val}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small helper components ──────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:2, padding:"0 12px 0 0" }}>
      <span style={{ fontSize:9, color:"#1e3a50", letterSpacing:"0.12em" }}>{label}</span>
      <span style={{ fontSize:11, color: color||"#7aacc8", fontWeight:500 }}>{value}</span>
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:9, color:"#1e3a50", letterSpacing:"0.12em", marginBottom:4 }}>{label}</div>
      {children}
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  screen:    { height:"100dvh", background:"#070c14", fontFamily:"'IBM Plex Mono',monospace", color:"#c0d0e0", display:"flex", flexDirection:"column", overflow:"hidden" },
  header:    { padding:"12px 16px 10px", borderBottom:"1px solid #0d1e30", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 },
  logo:      { fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:800, color:"#d0e8ff", letterSpacing:"-0.02em" },
  logoAccent:{ fontFamily:"'Syne',sans-serif", fontSize:17, fontWeight:700, color:"#3a7abf", letterSpacing:"-0.02em" },
  iconBtn:   { background:"transparent", border:"1px solid #0e2030", color:"#3a6080", fontSize:15, cursor:"pointer", width:30, height:30, display:"flex", alignItems:"center", justifyContent:"center" },
  dot:       { width:6, height:6, borderRadius:"50%", background:"#3a7abf", animation:"pulse 1s infinite", display:"inline-block" },
  pillBar:   { padding:"7px 12px", borderBottom:"1px solid #0a1820", display:"flex", gap:6, flexWrap:"wrap", flexShrink:0 },
  pill:      { background:"transparent", border:"1px solid", fontSize:10, cursor:"pointer", padding:"4px 10px", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em", transition:"all 0.15s" },
  statsBar:  { padding:"7px 16px", borderBottom:"1px solid #0a1820", display:"flex", gap:0, flexShrink:0, overflowX:"auto", alignItems:"center" },
  statDivider:{ width:1, background:"#0a1a2a", margin:"0 12px 0 0", alignSelf:"stretch" },
  metricBar: { padding:"5px 16px", borderBottom:"1px solid #0a1820", display:"flex", gap:2, alignItems:"center", flexShrink:0 },
  metricBtn: { background:"transparent", border:"1px solid #0e2030", color:"#2a4a60", fontSize:10, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", padding:"3px 10px", letterSpacing:"0.08em" },
  metricBtnOn:{ background:"#0e2540", borderColor:"#2a5a8a", color:"#6ab0e0" },
  errorBar:  { padding:"5px 16px", background:"#1a0e0e", borderBottom:"1px solid #3a1010", fontSize:10, color:"#8a4040", flexShrink:0 },
  mapContainer:{ flex:1, position:"relative", overflow:"hidden" },
  legend:    { position:"absolute", bottom:8, right:8, display:"flex", alignItems:"center", gap:2, pointerEvents:"none" },
  legendLbl: { fontSize:8, color:"#1e3050" },
  emptyState:{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14, padding:32 },
  emptyTitle:{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, color:"#1a3050", letterSpacing:"0.08em" },
  emptyDesc: { fontSize:11, color:"#1a2a3a", textAlign:"center", lineHeight:1.6 },
  emptyBtn:  { marginTop:8, background:"#0e2540", border:"1px solid #2a5070", color:"#5a90b8", padding:"10px 24px", fontSize:11, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.1em" },
  // Modals
  overlay:   { position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:20 },
  card:      { width:"100%", background:"#0a1525", border:"1px solid #1a3050", padding:"24px 20px", borderRadius:4 },
  cardTitle: { fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:800, color:"#d0e8ff", letterSpacing:"0.05em" },
  cardSub:   { fontSize:11, color:"#2a4560", marginBottom:14, letterSpacing:"0.1em" },
  cardText:  { fontSize:12, color:"#4a6a80", lineHeight:1.7, marginBottom:18 },
  infoBox:   { background:"#060e1a", border:"1px solid #0e2030", padding:"14px 16px", marginBottom:18, borderRadius:2 },
  infoTitle: { fontSize:10, color:"#2a4560", letterSpacing:"0.1em", marginBottom:10 },
  infoStep:  { fontSize:11, color:"#4a7090", marginBottom:6, display:"flex", alignItems:"flex-start", gap:10 },
  infoNum:   { background:"#0e2540", color:"#3a7abf", width:18, height:18, borderRadius:"50%", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:10, flexShrink:0, marginTop:1 },
  btnPrimary:{ width:"100%", background:"#0e2540", border:"1px solid #2a5a8a", color:"#6ab0e0", padding:12, fontSize:11, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.12em" },
  btnGhost:  { width:"100%", background:"transparent", border:"1px solid #0e1e2e", color:"#2a4a60", padding:10, fontSize:11, cursor:"pointer", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.1em", marginTop:8 },
  closeBtn:  { background:"transparent", border:"1px solid #1a2a3a", color:"#2a4a60", width:28, height:28, cursor:"pointer", fontSize:12 },
  pfRow:     { display:"flex", alignItems:"center", gap:10, padding:"12px", borderLeft:"3px solid", marginBottom:8, background:"#060e1a" },
  smallBtn:  { background:"transparent", border:"1px solid #0e2030", color:"#3a6080", fontSize:10, cursor:"pointer", padding:"5px 8px", fontFamily:"'IBM Plex Mono',monospace", whiteSpace:"nowrap" },
  input:     { width:"100%", background:"#060e1a", border:"1px solid #0e2030", color:"#a0c0d8", padding:"9px 10px", fontFamily:"'IBM Plex Mono',monospace", fontSize:12, outline:"none" },
  // Detail sheet
  sheetOverlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"flex-end", zIndex:100 },
  sheet:     { width:"100%", background:"#0a1525", borderTop:"1px solid #1a3050", padding:"20px 20px 36px", borderRadius:"12px 12px 0 0" },
  ttSymbol:  { fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:"#d0e8ff" },
  ttMeta:    { fontSize:10, color:"#2a4560", marginTop:2 },
  ttLabel:   { fontSize:10, color:"#1e3a50", letterSpacing:"0.1em" },
  ttValue:   { fontSize:12, color:"#8ab8d8", fontWeight:500 },
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Syne:wght@700;800&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent; }
  body { overscroll-behavior:none; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  input:focus, select:focus { border-color:#2a5a8a !important; outline:none; }
  button:active { opacity:0.7; }
  ::-webkit-scrollbar { display:none; }
  select option { background:#0a1525; }
`;
