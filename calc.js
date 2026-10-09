// Lógica de cálculo (misma que la planilla). Sin dependencias del DOM para poder testearla.
(function (root) {
  // get(month, grp, name) -> número, o undefined si no hay valor cargado
  function servicioAuto(get, month, cfg) {
    let total = 0, otra = 0, hay = false;
    for (const f of cfg.FACTURAS) {
      const v = get(month, "Facturas", f);
      if (v === undefined) continue;
      hay = true;
      total += v;
      otra += v * (cfg.PARTE_OTRA[f] ?? 0.5);
    }
    if (!hay) return undefined;
    return (total - otra) * cfg.MI_PARTE_DE_LA_CASA;
  }

  function monthTotals(get, month, cfg, extra = {}) {
    const names = (grp, base) => [...new Set([...base, ...((extra[grp]) || [])])];
    const n = (x) => x ?? 0;

    const ingresos = names("Ingresos", cfg.INGRESOS).reduce((s, k) => s + n(get(month, "Ingresos", k)), 0);

    const auto = servicioAuto(get, month, cfg);
    let fijos = 0;
    for (const k of names("Fijos", cfg.FIJOS)) {
      let v = get(month, "Fijos", k);
      if (v === undefined && k === "Servicios") v = auto;
      fijos += n(v);
    }

    const tarjetas = {};
    let tarjetasTotal = 0;
    for (const t of cfg.TARJETAS) {
      tarjetas[t] = cfg.TARJETA_FILAS.reduce((s, k) => s + n(get(month, t, k)), 0);
      tarjetasTotal += tarjetas[t];
    }
    const gastos = fijos + tarjetasTotal;
    return { ingresos, fijos, tarjetas, tarjetasTotal, gastos, balance: ingresos - gastos, servicioAuto: auto };
  }

  // Evalúa "42727+290000", "1200*3", "100.5" (solo dígitos y + - * / ( ) .)
  function parseAmount(text) {
    const t = String(text).replace(/[$\s]/g, "").replace(/,/g, ".");
    if (t === "") return { empty: true };
    if (!/^[0-9+\-*/().]+$/.test(t)) return { error: true };
    try {
      const v = Function(`"use strict"; return (${t});`)();
      if (typeof v !== "number" || !isFinite(v)) return { error: true };
      return { amount: Math.round(v * 100) / 100, expr: /^[0-9.]+$/.test(t) ? null : t };
    } catch { return { error: true }; }
  }

  const api = { servicioAuto, monthTotals, parseAmount };
  if (typeof module !== "undefined") module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
