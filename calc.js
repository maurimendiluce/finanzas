// Lógica de cálculo (misma que la planilla). Sin dependencias del DOM para poder testearla.
(function (root) {
  // get(month, grp, name) -> número, o undefined si no hay valor cargado
  const n0 = (x) => x ?? 0;

  // Valor vigente de un parámetro: el del mes, o el último anterior que lo tenga, o el default.
  function resolve(get, months, month, grp, name, fallback) {
    for (let i = months.length - 1; i >= 0; i--) {
      if (months[i] > month) continue;
      const v = get(months[i], grp, name);
      if (v !== undefined) return v;
    }
    return fallback;
  }

  // Reparto de facturas (luz, agua, gas, ABL) entre la otra persona y la casa, y mi parte de la casa.
  // Porcentajes se guardan como grp "Porcentajes" (0-100), por mes, heredando del mes anterior.
  function servicioBreakdown(get, months, month, cfg, names) {
    const list = names || cfg.FACTURAS;
    const rows = list.map((name) => {
      const monto = get(month, "Facturas", name);
      const pctOtra = resolve(get, months, month, "Porcentajes", name, (cfg.PARTE_OTRA[name] ?? 0.5) * 100);
      const otra = n0(monto) * pctOtra / 100;
      return { name, monto, pctOtra, propio: get(month, "Porcentajes", name) !== undefined,
               otra, casa: n0(monto) - otra };
    });
    const pctMia = resolve(get, months, month, "Porcentajes", "Mi parte casa", cfg.MI_PARTE_DE_LA_CASA * 100);
    const total = rows.reduce((s, r) => s + n0(r.monto), 0);
    const otra = rows.reduce((s, r) => s + r.otra, 0);
    const casa = total - otra;
    return { rows, total, otra, casa, pctMia, pctMiaPropio: get(month, "Porcentajes", "Mi parte casa") !== undefined,
             mia: casa * pctMia / 100, hay: rows.some((r) => r.monto !== undefined) };
  }

  function servicioAuto(get, months, month, cfg, names) {
    const b = servicioBreakdown(get, months, month, cfg, names);
    return b.hay ? b.mia : undefined;
  }

  function monthTotals(get, month, cfg, extra = {}, months = [month]) {
    const names = (grp, base) => [...new Set([...base, ...((extra[grp]) || [])])];
    const ingresos = names("Ingresos", cfg.INGRESOS).reduce((s, k) => s + n0(get(month, "Ingresos", k)), 0);

    const auto = servicioAuto(get, months, month, cfg, names("Facturas", cfg.FACTURAS));
    let fijos = 0;
    for (const k of names("Fijos", cfg.FIJOS)) {
      let v = get(month, "Fijos", k);
      if (v === undefined && k === "Servicios") v = auto;
      fijos += n0(v);
    }

    const tarjetas = {};
    let tarjetasTotal = 0;
    for (const t of cfg.TARJETAS) {
      tarjetas[t] = cfg.TARJETA_FILAS.reduce((s, k) => s + n0(get(month, t, k)), 0);
      tarjetasTotal += tarjetas[t];
    }
    const gastos = fijos + tarjetasTotal;
    return { ingresos, fijos, tarjetas, tarjetasTotal, gastos, balance: ingresos - gastos, servicioAuto: auto };
  }

  // Ingresos vs inflación. months ordenados; ingFn(m) ingresos; ipcFn(m) inflación mensual en % o undefined.
  // El primer mes es la base (100). Si falta el IPC de un mes, los acumulados quedan en null desde ahí.
  function inflationSeries(months, ingFn, ipcFn) {
    const rows = [];
    let idx = 1, ok = true, base = null, prev = null;
    months.forEach((m, i) => {
      const ing = ingFn(m);
      let ipc;
      if (i === 0) base = ing;
      else { ipc = ipcFn(m); if (ok && ipc !== undefined) idx *= 1 + ipc / 100; else ok = false; }
      const ingAcum = base ? ing / base - 1 : null;
      const ipcAcum = ok ? idx - 1 : null;
      rows.push({
        month: m, ing,
        ingVar: prev ? ing / prev - 1 : null,
        ipc, ipcAcum, ingAcum,
        real: ok ? ing / idx : null,                         // ingresos a precios del mes base
        poder: ok && ingAcum !== null ? (1 + ingAcum) / idx - 1 : null, // variación del poder adquisitivo
        idxIng: ingAcum === null ? null : (1 + ingAcum) * 100,
        idxIpc: ok ? idx * 100 : null,
      });
      prev = ing;
    });
    return rows;
  }

  // Evalúa "42727+290000", "1200*3", "100.5" (solo dígitos y + - * / ( ) .)
  function parseAmount(text) {
    const t = String(text).replace(/[$%\s]/g, "").replace(/,/g, ".");
    if (t === "") return { empty: true };
    if (!/^[0-9+\-*/().]+$/.test(t)) return { error: true };
    try {
      const v = Function(`"use strict"; return (${t});`)();
      if (typeof v !== "number" || !isFinite(v)) return { error: true };
      return { amount: Math.round(v * 100) / 100, expr: /^[0-9.]+$/.test(t) ? null : t };
    } catch { return { error: true }; }
  }

  const api = { resolve, servicioBreakdown, servicioAuto, monthTotals, inflationSeries, parseAmount };
  if (typeof module !== "undefined") module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
