(function () {
  const cfg = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const fmt2 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });
  const money = (v) => (v < 0 ? "-$" : "$") + fmt.format(Math.abs(v));
  const pct = (v) => `${fmt2.format(v)}%`;                 // v ya en %
  const pctF = (f) => (f >= 0 ? "+" : "") + fmt2.format(f * 100) + "%"; // f fracción
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const HIDDEN = new Set(["IPC", "Porcentajes"]); // grupos internos: no son meses ni filas de la planilla

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const state = { user: null, entries: new Map(), months: [], sel: null, tab: "panel", charts: {}, incOff: new Set() };
  const key = (m, g, n) => `${m}|${g}|${n}`;
  const get = (m, g, n) => state.entries.get(key(m, g, n))?.amount;
  const monthLabel = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
  const nextMonth = (m) => { let y = +m.slice(0, 4), k = +m.slice(5, 7) + 1; if (k > 12) { k = 1; y++; } return `${y}-${String(k).padStart(2, "0")}-01`; };

  try { state.incOff = new Set(JSON.parse(localStorage.getItem("incOff") || "[]")); } catch { /* sin storage */ }

  function setStatus(t, isErr) {
    const el = $("status");
    el.textContent = t; el.className = isErr ? "neg" : "muted";
    if (t && !isErr) setTimeout(() => { if (el.textContent === t) el.textContent = ""; }, 2500);
  }

  // ---------- datos ----------
  async function load() {
    const { data, error } = await sb.from("entries").select("id,month,grp,name,amount,expr").order("month");
    if (error) { setStatus("Error al cargar: " + error.message, true); return; }
    state.entries.clear();
    const ms = new Set(state.months);
    for (const r of data) {
      state.entries.set(key(r.month, r.grp, r.name), { id: r.id, amount: Number(r.amount), expr: r.expr });
      if (!HIDDEN.has(r.grp)) ms.add(r.month);
    }
    state.months = [...ms].sort();
    if (!state.sel || !state.months.includes(state.sel)) state.sel = defaultMonth();
    renderAll();
  }

  function defaultMonth() {
    const d = new Date();
    const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    if (state.months.includes(cur)) return cur;
    return [...state.months].reverse().find((m) => m <= cur) || state.months[state.months.length - 1] || null;
  }

  async function saveCell(month, grp, name, text) {
    const p = Calc.parseAmount(text);
    if (p.error) { setStatus("Valor inválido", true); return false; }
    const k = key(month, grp, name);
    const prev = state.entries.get(k);
    if (p.empty) {
      if (prev) {
        const { error } = await sb.from("entries").delete().eq("id", prev.id);
        if (error) { setStatus(error.message, true); return false; }
        state.entries.delete(k);
      }
    } else {
      const { data, error } = await sb.from("entries")
        .upsert({ user_id: state.user.id, month, grp, name, amount: p.amount, expr: p.expr },
                { onConflict: "user_id,month,grp,name" })
        .select("id").single();
      if (error) { setStatus(error.message, true); return false; }
      state.entries.set(k, { id: data.id, amount: p.amount, expr: p.expr });
    }
    setStatus("Guardado");
    return true;
  }

  async function addMonth() {
    const last = state.months[state.months.length - 1];
    let nm;
    if (last) nm = nextMonth(last);
    else { const d = new Date(); nm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
    if (last && confirm(`¿Copiar ingresos, fijos, cuotas y porcentajes de ${monthLabel(last)} a ${monthLabel(nm)} como punto de partida?`)) {
      const rows = [];
      for (const [k, v] of state.entries) {
        const [mm, grp, name] = k.split("|");
        if (mm !== last || grp === "Facturas" || grp === "IPC" || name === "Gasto unico") continue;
        rows.push({ user_id: state.user.id, month: nm, grp, name, amount: v.amount, expr: v.expr });
      }
      if (rows.length) {
        const { error } = await sb.from("entries").upsert(rows, { onConflict: "user_id,month,grp,name" });
        if (error) { setStatus(error.message, true); return; }
      }
    }
    if (!state.months.includes(nm)) state.months.push(nm);
    state.sel = nm;
    await load();
  }

  // ---------- helpers de cálculo ----------
  function names() {
    const rn = (grp, base) => {
      const out = [...base];
      for (const k of state.entries.keys()) {
        const [, g, n] = k.split("|");
        if (g === grp && !out.includes(n)) out.push(n);
      }
      return out;
    };
    return { Ingresos: rn("Ingresos", cfg.INGRESOS), Fijos: rn("Fijos", cfg.FIJOS), Facturas: rn("Facturas", cfg.FACTURAS) };
  }
  const totalsFor = (m, nm) => Calc.monthTotals(get, m, cfg, nm, state.months);

  // ---------- render ----------
  function renderAll() {
    const nm = names();
    renderMonthbar();
    renderPanel(nm);
    renderPlanilla(nm);
    renderServicios(nm);
    renderInflacion(nm);
    applyTab();
  }

  function renderMonthbar() {
    const sel = $("m-sel");
    sel.innerHTML = [...state.months].reverse().map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    sel.value = state.sel || "";
    const i = state.months.indexOf(state.sel);
    $("m-prev").disabled = i <= 0;
    $("m-next").disabled = i < 0 || i >= state.months.length - 1;
  }

  function delta(cur, prev, goodUp) {
    if (prev === undefined || prev === null) return "";
    const d = cur - prev;
    if (Math.abs(d) < 0.5) return `<span class="muted">=</span>`;
    const p = prev ? ` (${pctF(d / Math.abs(prev))})` : "";
    const good = goodUp ? d > 0 : d < 0;
    return `<span class="${good ? "pos" : "neg"}">${d > 0 ? "+" : "-"}${money(Math.abs(d))}${p}</span>`;
  }

  function renderPanel(nm) {
    const m = state.sel;
    if (!m) { $("summary").innerHTML = '<p class="muted">Todavía no hay meses cargados. Usá “+ Mes”.</p>'; return; }
    const i = state.months.indexOf(m);
    const pm = i > 0 ? state.months[i - 1] : null;
    const t = totalsFor(m, nm), p = pm ? totalsFor(pm, nm) : null;

    const stat = (l, v, c, sub) => `<div class="stat"><div class="label">${l}</div><div class="value ${c || ""}">${money(v)}</div><div class="sub">${sub || "&nbsp;"}</div></div>`;
    const ahorro = t.ingresos ? t.balance / t.ingresos : 0;
    $("summary").innerHTML =
      stat(`Ingresos · ${monthLabel(m)}`, t.ingresos, "", p ? delta(t.ingresos, p.ingresos, true) + " vs " + monthLabel(pm) : "") +
      stat("Gastos", t.gastos, "", p ? delta(t.gastos, p.gastos, false) : "") +
      stat("Balance", t.balance, t.balance < 0 ? "neg" : "pos", t.ingresos ? `Ahorro: ${pctF(ahorro).replace("+", "")} de los ingresos` : "") +
      stat("En tarjetas", t.tarjetasTotal, "", t.gastos ? `${fmt2.format(t.tarjetasTotal / t.gastos * 100)}% de los gastos` : "");

    // barras de gastos
    const items = [{ label: "Fijos", v: t.fijos }, ...cfg.TARJETAS.map((c) => ({ label: c, v: t.tarjetas[c] }))]
      .filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    const max = items[0]?.v || 1;
    $("bars").innerHTML = items.map((x) =>
      `<div class="bar-row"><span class="bar-label">${esc(x.label)}</span>` +
      `<span class="bar"><i style="width:${(x.v / max * 100).toFixed(1)}%"></i></span>` +
      `<span class="bar-val">${money(x.v)} <small class="muted">${fmt.format(x.v / t.gastos * 100)}%</small></span></div>`).join("") || '<p class="muted">Sin gastos cargados.</p>';

    // detalle vs mes anterior
    const sec = (title) => `<tr class="section"><td colspan="4">${title}</td></tr>`;
    const row = (label, cur, prev, goodUp, cls = "") =>
      `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(cur)}</td><td class="num muted">${prev === undefined ? "" : money(prev)}</td><td class="num">${prev === undefined ? "" : delta(cur, prev, goodUp)}</td></tr>`;
    const v = (mm, g, n) => (mm ? (get(mm, g, n) ?? 0) : undefined);
    let h = `<tr><th></th><th>${monthLabel(m)}</th><th>${pm ? monthLabel(pm) : ""}</th><th>Variación</th></tr>`;
    h += sec("Ingresos");
    for (const n of nm.Ingresos) { const c = v(m, "Ingresos", n), q = v(pm, "Ingresos", n); if (c || q) h += row(n, c, q, true, "sub"); }
    h += row("Total ingresos", t.ingresos, p?.ingresos, true, "total");
    h += sec("Gastos fijos");
    for (const n of nm.Fijos) {
      const c = get(m, "Fijos", n) ?? (n === "Servicios" ? t.servicioAuto : undefined) ?? 0;
      const q = pm ? (get(pm, "Fijos", n) ?? (n === "Servicios" ? p.servicioAuto : undefined) ?? 0) : undefined;
      if (c || q) h += row(n, c, q, false, "sub");
    }
    h += row("Total fijos", t.fijos, p?.fijos, false, "total");
    h += sec("Tarjetas");
    for (const c of cfg.TARJETAS) if (t.tarjetas[c] || p?.tarjetas[c]) h += row(c, t.tarjetas[c], p?.tarjetas[c], false, "sub");
    h += row("Total tarjetas", t.tarjetasTotal, p?.tarjetasTotal, false, "total");
    h += row("Total gastos", t.gastos, p?.gastos, false, "total");
    h += `<tr class="balance"><td>Balance</td><td class="num ${t.balance < 0 ? "neg" : "pos"}">${money(t.balance)}</td><td class="num muted">${p ? money(p.balance) : ""}</td><td></td></tr>`;
    $("detail").innerHTML = h;

    // tendencia: 6 meses hasta el seleccionado
    const win = state.months.slice(Math.max(0, i - 5), i + 1);
    const tt = win.map((mm) => totalsFor(mm, nm));
    mkChart("chart-trend", {
      data: {
        labels: win.map(monthLabel),
        datasets: [
          { type: "bar", label: "Ingresos", data: tt.map((x) => x.ingresos), backgroundColor: cssv("--c-ing") },
          { type: "bar", label: "Gastos", data: tt.map((x) => x.gastos), backgroundColor: cssv("--c-gas") },
          { type: "line", label: "Balance", data: tt.map((x) => x.balance), borderColor: cssv("--text"), backgroundColor: cssv("--text"), tension: 0.2 },
        ],
      },
      yMoney: true,
    });
  }

  function renderPlanilla(nm) {
    const ms = state.months;
    const totals = Object.fromEntries(ms.map((m) => [m, totalsFor(m, nm)]));
    const head = `<tr><th></th>${ms.map((m) => `<th class="${m === state.sel ? "cur" : ""}">${monthLabel(m)}</th>`).join("")}</tr>`;
    const section = (t) => `<tr class="section"><td colspan="${ms.length + 1}">${esc(t)}</td></tr>`;
    const cell = (m, grp, name, autoVal) => {
      const v = get(m, grp, name);
      const auto = v === undefined && autoVal !== undefined;
      const shown = v ?? autoVal;
      return `<td class="num cell${auto ? " auto" : ""}" data-m="${m}" data-g="${esc(grp)}" data-n="${esc(name)}"` +
        `${auto ? ' title="Calculado desde Facturas (pestaña Servicios); escribí un valor para reemplazarlo"' : ""}>${shown === undefined ? "" : money(shown)}</td>`;
    };
    const line = (label, grp, name, cls, autoFn) =>
      `<tr class="${cls || ""}"><td>${esc(label)}</td>${ms.map((m) => cell(m, grp, name, autoFn ? autoFn(m) : undefined)).join("")}</tr>`;
    const totalRow = (label, fn, cls = "total") =>
      `<tr class="${cls}"><td>${esc(label)}</td>${ms.map((m) => {
        const v = fn(m); const c = cls === "balance" ? (v < 0 ? "neg" : "pos") : "";
        return `<td class="num ${c}">${money(v)}</td>`; }).join("")}</tr>`;

    let h = head;
    h += totalRow("Balance", (m) => totals[m].balance, "balance");
    h += section("Ingresos");
    for (const n of nm.Ingresos) h += line(n, "Ingresos", n, "sub");
    h += totalRow("Total ingresos", (m) => totals[m].ingresos);
    h += section("Gastos fijos");
    for (const n of nm.Fijos) h += line(n, "Fijos", n, "sub", n === "Servicios" ? (m) => totals[m].servicioAuto : null);
    h += totalRow("Total fijos", (m) => totals[m].fijos);
    h += section("Tarjetas");
    for (const t of cfg.TARJETAS) {
      h += `<tr class="card-title"><td>${esc(t)}</td>${ms.map(() => "<td></td>").join("")}</tr>`;
      for (const f of cfg.TARJETA_FILAS) h += line(f, t, f, "sub");
      h += totalRow(`Total ${t}`, (m) => totals[m].tarjetas[t]);
    }
    h += section("Facturas de servicios");
    for (const f of nm.Facturas) h += line(f, "Facturas", f, "sub");
    h += totalRow("Total gastos", (m) => totals[m].gastos, "total");
    $("sheet").innerHTML = h;
  }

  function renderServicios(nm) {
    const m = state.sel;
    if (!m) { $("serv").innerHTML = ""; return; }
    const b = Calc.servicioBreakdown(get, state.months, m, cfg, nm.Facturas);
    const pcell = (grp, name, val, own) =>
      `<td class="num cell${own ? "" : " auto"}" data-fmt="pct" data-eff="${val}" data-m="${m}" data-g="${grp}" data-n="${esc(name)}"` +
      `${own ? "" : ' title="Heredado de un mes anterior (o valor por defecto). Escribí para fijarlo desde este mes."'}>${pct(val)}</td>`;
    let h = `<tr><th>${monthLabel(m)}</th><th>Monto</th><th>% Sabri</th><th>Sabri</th><th>Casa</th></tr>`;
    for (const r of b.rows) {
      h += `<tr class="sub"><td>${esc(r.name)}</td>` +
        `<td class="num cell" data-m="${m}" data-g="Facturas" data-n="${esc(r.name)}">${r.monto === undefined ? "" : money(r.monto)}</td>` +
        pcell("Porcentajes", r.name, r.pctOtra, r.propio) +
        `<td class="num">${money(r.otra)}</td><td class="num">${money(r.casa)}</td></tr>`;
    }
    h += `<tr class="total"><td>Total</td><td class="num">${money(b.total)}</td><td class="num">${b.total ? pct(b.otra / b.total * 100) : ""}</td><td class="num">${money(b.otra)}</td><td class="num">${money(b.casa)}</td></tr>`;
    h += `<tr class="total"><td>Mi parte de la casa</td><td></td>${pcell("Porcentajes", "Mi parte casa", b.pctMia, b.pctMiaPropio)}<td></td><td class="num">${money(b.mia)}</td></tr>`;
    $("serv").innerHTML = h;

    const manual = get(m, "Fijos", "Servicios");
    $("serv-note").innerHTML = manual !== undefined
      ? `<p class="hint">En la planilla, la fila fija <b>Servicios</b> de ${monthLabel(m)} tiene un valor manual (${money(manual)}); el calculado acá es ${money(b.mia)}. <button id="use-calc">Usar el calculado</button></p>`
      : `<p class="hint muted">La fila fija <b>Servicios</b> de la planilla toma automáticamente “Mi parte de la casa”: ${money(b.mia)}.</p>`;
    const btn = $("use-calc");
    if (btn) btn.onclick = async () => { if (await saveCell(m, "Fijos", "Servicios", "")) renderAll(); };
  }

  function renderInflacion(nm) {
    // conceptos de ingreso a considerar
    const concepts = nm.Ingresos;
    $("inc-filter").innerHTML = '<span class="muted">Ingresos considerados:</span>' + concepts.map((c) =>
      `<label class="chip"><input type="checkbox" data-inc="${esc(c)}" ${state.incOff.has(c) ? "" : "checked"}> ${esc(c)}</label>`).join("");
    const incFn = (m) => concepts.reduce((s, c) => s + (state.incOff.has(c) ? 0 : (get(m, "Ingresos", c) ?? 0)), 0);
    const months = state.months.filter((m) => incFn(m) > 0);
    if (months.length < 2) { $("ipc-table").innerHTML = '<tr><td class="muted">Hacen falta al menos 2 meses con ingresos.</td></tr>'; mkChart("chart-ipc", null); return; }
    const rows = Calc.inflationSeries(months, incFn, (m) => get(m, "IPC", "Mensual"));

    let h = `<tr><th></th><th>Ingresos</th><th>Δ ingresos</th><th>IPC mensual</th><th>IPC acum.</th><th>Ingresos acum.</th><th>Poder adquisitivo</th><th>Ingresos a precios de ${monthLabel(months[0])}</th></tr>`;
    for (const r of rows) {
      const base = r.month === months[0];
      const cls = (v) => (v === null ? "" : v >= 0 ? "pos" : "neg");
      h += `<tr><td>${monthLabel(r.month)}</td><td class="num">${money(r.ing)}</td>` +
        `<td class="num">${r.ingVar === null ? "" : pctF(r.ingVar)}</td>` +
        (base ? `<td class="num muted">base</td>` :
          `<td class="num cell" data-fmt="pct" data-m="${r.month}" data-g="IPC" data-n="Mensual">${r.ipc === undefined ? '<span class="muted">—</span>' : pct(r.ipc)}</td>`) +
        `<td class="num">${r.ipcAcum === null ? "—" : pctF(r.ipcAcum)}</td>` +
        `<td class="num">${r.ingAcum === null ? "—" : pctF(r.ingAcum)}</td>` +
        `<td class="num ${cls(r.poder)}">${r.poder === null ? "—" : pctF(r.poder)}</td>` +
        `<td class="num">${r.real === null ? "—" : money(r.real)}</td></tr>`;
    }
    $("ipc-table").innerHTML = h;

    mkChart("chart-ipc", {
      data: {
        labels: rows.map((r) => monthLabel(r.month)),
        datasets: [
          { type: "line", label: "Ingresos (base 100)", data: rows.map((r) => r.idxIng), borderColor: cssv("--c-ing"), backgroundColor: cssv("--c-ing"), tension: 0.2 },
          { type: "line", label: "Inflación acumulada (base 100)", data: rows.map((r) => r.idxIpc), borderColor: cssv("--c-gas"), backgroundColor: cssv("--c-gas"), borderDash: [6, 4], tension: 0.2 },
        ],
      },
      yFmt: (v) => fmt2.format(v),
      tipFmt: (v) => fmt2.format(v),
    });
    const miss = rows.filter((r, i) => i > 0 && r.ipc === undefined).map((r) => monthLabel(r.month));
    $("ipc-msg").textContent = miss.length ? `Sin dato de inflación para: ${miss.join(", ")}. Usá “Actualizar IPC desde INDEC” o cargalo a mano en la tabla.` : "";
  }

  // ---------- gráficos ----------
  const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  function mkChart(id, o) {
    if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
    if (!o || !window.Chart) return;
    const tip = o.yMoney ? money : (o.tipFmt || ((v) => v));
    state.charts[id] = new Chart($(id), {
      data: o.data,
      options: {
        responsive: true, maintainAspectRatio: false, color: cssv("--text"),
        scales: {
          x: { ticks: { color: cssv("--muted") }, grid: { display: false } },
          y: { ticks: { color: cssv("--muted"), callback: o.yMoney ? (v) => money(v) : o.yFmt }, grid: { color: cssv("--line") } },
        },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${tip(c.parsed.y)}` } } },
      },
    });
  }

  // ---------- INDEC ----------
  async function fetchIPC() {
    if (state.months.length < 2) return;
    const first = state.months[0], last = state.months[state.months.length - 1];
    const btn = $("ipc-fetch"); btn.disabled = true; setStatus("Consultando INDEC…");
    try {
      const url = "https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&representation_mode=percent_change&start_date=" + first.slice(0, 7);
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      const rows = (j.data || []).filter(([d, v]) => d >= first && d <= last && v !== null)
        .map(([d, v]) => ({ user_id: state.user.id, month: d, grp: "IPC", name: "Mensual", amount: Math.round(v * 10000) / 100, expr: null }));
      if (!rows.length) { setStatus("INDEC todavía no publicó datos para esos meses", true); return; }
      const { error } = await sb.from("entries").upsert(rows, { onConflict: "user_id,month,grp,name" });
      if (error) throw error;
      setStatus(`IPC actualizado hasta ${monthLabel(rows[rows.length - 1].month)}`);
      await load();
    } catch (e) {
      setStatus("No se pudo consultar INDEC (" + (e.message || e) + "). Podés cargar el IPC a mano.", true);
    } finally { btn.disabled = false; }
  }

  // ---------- eventos ----------
  function startEdit(td) {
    const { m, g, n, fmt: f, eff } = td.dataset;
    const ent = state.entries.get(key(m, g, n));
    const initial = ent ? (ent.expr ?? String(ent.amount)) : (eff ?? "");
    const input = document.createElement("input");
    input.inputMode = "decimal"; input.value = initial;
    td.classList.add("editing"); td.textContent = ""; td.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      if (commit && input.value !== initial) await saveCell(m, g, n, input.value);
      renderAll();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }
  document.addEventListener("click", (e) => {
    const td = e.target.closest("td.cell");
    if (td && !td.classList.contains("editing")) startEdit(td);
  });

  document.addEventListener("change", (e) => {
    const c = e.target.closest("input[data-inc]");
    if (!c) return;
    if (c.checked) state.incOff.delete(c.dataset.inc); else state.incOff.add(c.dataset.inc);
    try { localStorage.setItem("incOff", JSON.stringify([...state.incOff])); } catch { /* sin storage */ }
    renderInflacion(names());
  });

  const go = (m) => { if (m) { state.sel = m; renderAll(); } };
  $("m-sel").addEventListener("change", (e) => go(e.target.value));
  $("m-prev").addEventListener("click", () => go(state.months[state.months.indexOf(state.sel) - 1]));
  $("m-next").addEventListener("click", () => go(state.months[state.months.indexOf(state.sel) + 1]));
  $("m-today").addEventListener("click", () => go(defaultMonth()));

  function applyTab() {
    for (const s of document.querySelectorAll("[data-view]")) s.hidden = s.dataset.view !== state.tab;
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === state.tab);
    $("monthbar").hidden = !(state.tab === "panel" || state.tab === "servicios");
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab; history.replaceState(null, "", "#" + state.tab);
    renderAll(); // los gráficos ocultos no miden bien: se redibujan al mostrarse
  });
  const h0 = location.hash.slice(1);
  if (["panel", "planilla", "servicios", "inflacion"].includes(h0)) state.tab = h0;

  $("ipc-fetch").addEventListener("click", fetchIPC);
  $("add-month").addEventListener("click", addMonth);
  $("logout").addEventListener("click", () => sb.auth.signOut());

  // ---------- sesión ----------
  async function showApp(session) {
    state.user = session?.user ?? null;
    $("login").hidden = !!state.user;
    $("app").hidden = !state.user;
    if (state.user) await load();
  }
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("email").value, password: $("password").value });
    if (error) $("login-error").textContent = "No se pudo ingresar: " + error.message;
  });
  // Dispara INITIAL_SESSION al cargar, SIGNED_IN al loguear y SIGNED_OUT al salir
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "TOKEN_REFRESHED") return;
    setTimeout(() => showApp(session), 0); // evita llamar a supabase dentro del callback
  });
})();
