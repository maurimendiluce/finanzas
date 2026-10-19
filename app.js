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
  const state = { user: null, entries: new Map(), months: [], sel: null, tab: "panel", charts: {}, incOff: new Set(), payments: [], payErr: null, cal: null, feed: null, feedErr: null, feedBefore: 0 };
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
    await loadPayments();
    await loadFeed();
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
    renderCalendar();
    renderFeed();
    renderUpcoming($("upcoming-panel"), 6);
    applyTab();
  }

  function renderMonthbar() {
    const sel = $("m-sel");
    sel.innerHTML = [...state.months].reverse().map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
    sel.value = state.sel || "";
    const i = state.months.indexOf(state.sel);
    $("m-prev").disabled = i <= 0;
    $("m-next").disabled = i < 0 || i >= state.months.length - 1;
    $("m-del").disabled = !state.sel;
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
    const section = (t, g) => `<tr class="section"><td colspan="${ms.length + 1}">${esc(t)}${g ? ` <button class="mini" data-add="${g}">+ agregar</button>` : ""}</td></tr>`;
    const cell = (m, grp, name, autoVal) => {
      const v = get(m, grp, name);
      const auto = v === undefined && autoVal !== undefined;
      const shown = v ?? autoVal;
      return `<td class="num cell${auto ? " auto" : ""}" data-m="${m}" data-g="${esc(grp)}" data-n="${esc(name)}"` +
        `${auto ? ' title="Calculado desde Facturas (pestaña Servicios); escribí un valor para reemplazarlo"' : ""}>${shown === undefined ? "" : money(shown)}</td>`;
    };
    const line = (label, grp, name, cls, autoFn) =>
      `<tr class="${cls || ""}"><td>${esc(label)}${isCustom(grp, name) ? ` <button class="mini del" data-del data-g="${esc(grp)}" data-n="${esc(name)}" title="Quitar esta fila de todos los meses" aria-label="Quitar ${esc(name)}">×</button>` : ""}</td>${ms.map((m) => cell(m, grp, name, autoFn ? autoFn(m) : undefined)).join("")}</tr>`;
    const totalRow = (label, fn, cls = "total") =>
      `<tr class="${cls}"><td>${esc(label)}</td>${ms.map((m) => {
        const v = fn(m); const c = cls === "balance" ? (v < 0 ? "neg" : "pos") : "";
        return `<td class="num ${c}">${money(v)}</td>`; }).join("")}</tr>`;

    let h = head;
    h += totalRow("Balance", (m) => totals[m].balance, "balance");
    h += section("Ingresos", "Ingresos");
    for (const n of nm.Ingresos) h += line(n, "Ingresos", n, "sub");
    h += totalRow("Total ingresos", (m) => totals[m].ingresos);
    h += section("Gastos fijos", "Fijos");
    for (const n of nm.Fijos) h += line(n, "Fijos", n, "sub", n === "Servicios" ? (m) => totals[m].servicioAuto : null);
    h += totalRow("Total fijos", (m) => totals[m].fijos);
    h += section("Tarjetas");
    for (const t of cfg.TARJETAS) {
      h += `<tr class="card-title"><td>${esc(t)}</td>${ms.map(() => "<td></td>").join("")}</tr>`;
      for (const f of cfg.TARJETA_FILAS) h += line(f, t, f, "sub");
      h += totalRow(`Total ${t}`, (m) => totals[m].tarjetas[t]);
    }
    h += section("Facturas de servicios", "Facturas");
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

  async function deleteMonth() {
    const m = state.sel;
    if (!m) return;
    const keys = [...state.entries.keys()].filter((k) => k.startsWith(m + "|"));
    const hasPct = keys.some((k) => k.split("|")[1] === "Porcentajes");
    const later = state.months.some((x) => x > m);
    const msg = `¿Eliminar ${monthLabel(m)}?\n\n` +
      (keys.length ? `Se borran sus ${keys.length} valores cargados (ingresos, gastos, tarjetas, facturas e inflación). No se puede deshacer.` : "Este mes no tiene valores cargados.") +
      (hasPct && later ? "\n\nAtención: este mes define porcentajes de servicios que heredan los meses siguientes; esos meses volverían a usar el porcentaje anterior." : "") +
      "\n\nLos vencimientos del calendario no se tocan.";
    if (!confirm(msg)) return;
    if (keys.length) {
      const { error } = await sb.from("entries").delete().eq("month", m);
      if (error) { setStatus(error.message, true); return; }
      for (const k of keys) state.entries.delete(k);
    }
    const i = state.months.indexOf(m);
    state.months = state.months.filter((x) => x !== m);
    state.sel = state.months[i - 1] || state.months[i] || null;
    setStatus(`${monthLabel(m)} eliminado`);
    renderAll();
  }
  $("m-del").addEventListener("click", deleteMonth);

  function applyTab() {
    for (const s of document.querySelectorAll("[data-view]")) s.hidden = s.dataset.view !== state.tab;
    for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === state.tab);
    $("monthbar").hidden = !(state.tab === "panel" || state.tab === "planilla" || state.tab === "servicios");
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab; history.replaceState(null, "", "#" + state.tab);
    renderAll(); // los gráficos ocultos no miden bien: se redibujan al mostrarse
  });
  const h0 = location.hash.slice(1);
  if (["panel", "planilla", "servicios", "calendario", "inflacion"].includes(h0)) state.tab = h0;

  $("ipc-fetch").addEventListener("click", fetchIPC);
  $("add-month").addEventListener("click", addMonth);
  $("logout").addEventListener("click", () => sb.auth.signOut());

  // ---------- agregar / quitar filas de la planilla ----------
  const CFG_ROWS = { Ingresos: cfg.INGRESOS, Fijos: cfg.FIJOS, Facturas: cfg.FACTURAS };
  const isCustom = (grp, name) => !!CFG_ROWS[grp] && !CFG_ROWS[grp].includes(name);

  async function addRow(grp) {
    const label = { Ingresos: "ingreso", Fijos: "gasto fijo", Facturas: "servicio" }[grp];
    const name = (prompt(`Nombre del nuevo ${label}:`) || "").trim().slice(0, 40);
    if (!name) return;
    if (name.includes("|")) { setStatus("El nombre no puede incluir “|”", true); return; }
    if (names()[grp].some((n) => n.toLowerCase() === name.toLowerCase())) { setStatus(`Ya existe “${name}”`, true); return; }
    const month = state.sel || state.months[state.months.length - 1];
    if (!month) { setStatus("Primero creá un mes con “+ Mes”", true); return; }
    // la fila existe mientras tenga algún valor cargado: se crea con 0 en el mes seleccionado
    const { data, error } = await sb.from("entries")
      .upsert({ user_id: state.user.id, month, grp, name, amount: 0, expr: null }, { onConflict: "user_id,month,grp,name" })
      .select("id").single();
    if (error) { setStatus(error.message, true); return; }
    state.entries.set(key(month, grp, name), { id: data.id, amount: 0, expr: null });
    setStatus(`“${name}” agregado. Cargá los montos de cada mes en la planilla.`);
    renderAll();
  }

  async function removeRow(grp, name) {
    if (!confirm(`¿Quitar “${name}” de todos los meses? Se borran los montos cargados.`)) return;
    const grps = grp === "Facturas" ? ["Facturas", "Porcentajes"] : [grp];
    for (const g of grps) {
      const { error } = await sb.from("entries").delete().eq("grp", g).eq("name", name);
      if (error) { setStatus(error.message, true); return; }
      for (const k of [...state.entries.keys()]) { const [, kg, kn] = k.split("|"); if (kg === g && kn === name) state.entries.delete(k); }
    }
    setStatus(`“${name}” quitado`);
    renderAll();
  }

  // ---------- calendario de pagos ----------
  const MESES_L = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const DOW = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoDay = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const todayISO = () => { const d = new Date(); return isoDay(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const utc = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const fmtDate = (iso) => `${DOW[(new Date(utc(iso)).getUTCDay() + 6) % 7]} ${+iso.slice(8, 10)} ${MESES[+iso.slice(5, 7) - 1]}`;
  const daysFrom = (iso) => Math.round((utc(iso) - utc(todayISO())) / 864e5); // >0 futuro

  async function loadPayments() {
    const { data, error } = await sb.from("payments").select("id,title,due_date,recurrence,amount,notes,paid_dates").order("due_date");
    if (error) {
      state.payments = [];
      state.payErr = /payments|relation|schema cache/i.test(error.message)
        ? "Falta crear la tabla del calendario: ejecutá supabase/002_payments.sql en Supabase (SQL Editor)."
        : "Calendario: " + error.message;
      return;
    }
    state.payErr = null; state.payments = data;
  }

  function renderCalendar() {
    if (!state.cal) state.cal = todayISO().slice(0, 8) + "01";
    const y = +state.cal.slice(0, 4), m = +state.cal.slice(5, 7);
    $("cal-title").textContent = `${MESES_L[m - 1]} ${y}`;
    $("cal-error").textContent = state.payErr || "";
    $("cal-add").disabled = !!state.payErr;
    $("cal-head").innerHTML = DOW.map((d) => `<div class="dow">${d}</div>`).join("");

    const dim = Calc.daysIn(y, m), first = isoDay(y, m, 1), last = isoDay(y, m, dim), today = todayISO();
    const occ = state.payErr ? [] : Calc.occurrences(state.payments, first, last);
    const byDate = {};
    for (const o of occ) (byDate[o.date] ||= []).push(o);

    const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
    const total = Math.ceil((offset + dim) / 7) * 7;
    let h = "";
    for (let i = 0; i < total; i++) {
      const d = i - offset + 1;
      if (d < 1 || d > dim) { h += '<div class="day empty"></div>'; continue; }
      const date = isoDay(y, m, d);
      const chips = (byDate[date] || []).map((o) =>
        `<button type="button" class="pchip ${o.paid ? "paid" : date < today ? "over" : ""}" data-id="${o.id}" data-date="${date}" ` +
        `title="${esc(o.title)}${o.amount !== null ? " · " + money(o.amount) : ""}${o.paid ? " · pagado" : ""}">` +
        `<span class="pt">${o.paid ? "✓ " : ""}${esc(o.title)}</span>${o.amount !== null ? `<b>${money(o.amount)}</b>` : ""}</button>`).join("");
      h += `<div class="day${date === today ? " today" : ""}" data-date="${date}"><span class="dn">${d}</span>${chips}</div>`;
    }
    $("cal-grid").innerHTML = h;

    const pend = occ.filter((o) => !o.paid), done = occ.filter((o) => o.paid);
    const sum = (a) => a.reduce((s, o) => s + (o.amount || 0), 0);
    $("cal-summary").textContent = occ.length
      ? `Este mes: ${pend.length} pendiente${pend.length === 1 ? "" : "s"}${sum(pend) ? ` (${money(sum(pend))})` : ""} · ${done.length} pagado${done.length === 1 ? "" : "s"}${sum(done) ? ` (${money(sum(done))})` : ""}`
      : "";
    renderUpcoming($("upcoming-cal"), 50);
  }

  function renderUpcoming(el, limit) {
    if (state.payErr) { el.innerHTML = `<p class="muted hint">${esc(state.payErr)}</p>`; return; }
    const t = todayISO();
    const list = Calc.occurrences(state.payments, Calc.addDays(t, -60), Calc.addDays(t, 30)).filter((o) => !o.paid).slice(0, limit);
    if (!list.length) { el.innerHTML = '<p class="muted hint">Sin vencimientos pendientes en los próximos 30 días.</p>'; return; }
    el.innerHTML = list.map((o) => {
      const n = daysFrom(o.date);
      const when = n < 0 ? `vencido hace ${-n} día${n === -1 ? "" : "s"}` : n === 0 ? "hoy" : n === 1 ? "mañana" : `en ${n} días`;
      return `<div class="up-row${n < 0 ? " over" : n <= 3 ? " soon" : ""}">` +
        `<button type="button" class="tick" data-tick data-id="${o.id}" data-date="${o.date}" title="Marcar como pagado" aria-label="Marcar ${esc(o.title)} como pagado">✓</button>` +
        `<span class="up-date">${fmtDate(o.date)}</span><span class="up-title">${esc(o.title)}${o.recurrence === "monthly" ? ' <small class="muted">· mensual</small>' : ""}</span>` +
        `<span class="up-amt">${o.amount !== null ? money(o.amount) : ""}</span><span class="up-when">${when}</span></div>`;
    }).join("");
  }

  let payCtx = null; // { id|null, date } del vencimiento que se está editando
  function openPay({ id = null, date }) {
    const p = id ? state.payments.find((x) => x.id === id) : null;
    if (id && !p) return;
    payCtx = { id, date };
    const monthly = !!p && p.recurrence === "monthly";
    $("pay-heading").textContent = p ? "Editar vencimiento" : "Nuevo vencimiento";
    $("pay-title").value = p ? p.title : "";
    $("pay-date").value = p ? p.due_date : date;
    $("pay-amount").value = p && p.amount !== null && p.amount !== undefined ? String(p.amount) : "";
    $("pay-monthly").checked = monthly;
    $("pay-notes").value = p?.notes || "";
    $("pay-paid").checked = !!p && (p.paid_dates || []).includes(date);
    $("pay-paid-label").textContent = monthly ? `Pagado este mes (${fmtDate(date)})` : "Pagado";
    $("pay-delete").hidden = !p;
    $("pay-hint").textContent = monthly ? "Título, monto y repetición valen para toda la serie. Si cambiás la fecha, la serie empieza ese día." : "";
    $("pay-error").textContent = "";
    $("pay-dialog").showModal();
    $("pay-title").focus();
  }

  async function savePay(e) {
    e.preventDefault();
    const err = (t) => { $("pay-error").textContent = t; };
    const title = $("pay-title").value.trim(), due = $("pay-date").value;
    if (!title || !due) { err("Completá título y fecha."); return; }
    let amount = null;
    const at = $("pay-amount").value.trim();
    if (at) { const a = Calc.parseAmount(at); if (a.error || a.empty) { err("Monto inválido."); return; } amount = a.amount; }
    const monthly = $("pay-monthly").checked, checked = $("pay-paid").checked;
    const old = payCtx.id ? state.payments.find((x) => x.id === payCtx.id) : null;
    let paid = new Set(old ? old.paid_dates || [] : []);
    if (!monthly) { paid = new Set(); if (checked) paid.add(due); }
    else { const occ = old ? payCtx.date : due; if (checked) paid.add(occ); else paid.delete(occ); }
    const row = { title, due_date: due, recurrence: monthly ? "monthly" : "none", amount, notes: $("pay-notes").value.trim() || null, paid_dates: [...paid].sort() };
    const q = payCtx.id
      ? sb.from("payments").update(row).eq("id", payCtx.id)
      : sb.from("payments").insert({ ...row, user_id: state.user.id });
    const { error } = await q;
    if (error) { err(error.message); return; }
    $("pay-dialog").close();
    state.cal = due.slice(0, 8) + "01";
    await loadPayments(); renderAll(); setStatus("Guardado");
  }

  async function deletePay() {
    const p = state.payments.find((x) => x.id === payCtx.id);
    if (!p || !confirm(`¿Eliminar “${p.title}”?${p.recurrence === "monthly" ? " Se borra toda la serie mensual." : ""}`)) return;
    const { error } = await sb.from("payments").delete().eq("id", p.id);
    if (error) { $("pay-error").textContent = error.message; return; }
    $("pay-dialog").close();
    await loadPayments(); renderAll(); setStatus("Eliminado");
  }

  async function togglePaid(id, date) {
    const p = state.payments.find((x) => x.id === id);
    if (!p) return;
    const set = new Set(p.paid_dates || []);
    if (set.has(date)) set.delete(date); else set.add(date);
    const { error } = await sb.from("payments").update({ paid_dates: [...set].sort() }).eq("id", id);
    if (error) { setStatus(error.message, true); return; }
    await loadPayments(); renderAll();
  }

  const shiftCal = (n) => { const y = +state.cal.slice(0, 4), m = +state.cal.slice(5, 7) - 1 + n; const d = new Date(Date.UTC(y, m, 1)); state.cal = isoDay(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); renderCalendar(); };
  $("cal-prev").addEventListener("click", () => shiftCal(-1));
  $("cal-next").addEventListener("click", () => shiftCal(1));
  $("cal-today").addEventListener("click", () => { state.cal = todayISO().slice(0, 8) + "01"; renderCalendar(); });
  $("cal-add").addEventListener("click", () => { const t = todayISO(); openPay({ date: t.slice(0, 7) === state.cal.slice(0, 7) ? t : state.cal }); });
  $("pay-form").addEventListener("submit", savePay);
  $("pay-cancel").addEventListener("click", () => $("pay-dialog").close());
  $("pay-delete").addEventListener("click", deletePay);

  document.addEventListener("click", (e) => {
    const t = e.target;
    const add = t.closest("[data-add]"); if (add) { addRow(add.dataset.add); return; }
    const del = t.closest("[data-del]"); if (del) { removeRow(del.dataset.g, del.dataset.n); return; }
    const tick = t.closest("[data-tick]"); if (tick) { togglePaid(tick.dataset.id, tick.dataset.date); return; }
    const chip = t.closest(".pchip"); if (chip) { openPay({ id: chip.dataset.id, date: chip.dataset.date }); return; }
    const day = t.closest(".day[data-date]"); if (day) openPay({ date: day.dataset.date });
  });

  // ---------- enlace para suscribir el calendario del celular ----------
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

  async function loadFeed() {
    const { data, error } = await sb.from("calendar_feed").select("token").maybeSingle();
    if (error) {
      state.feed = null;
      state.feedErr = /calendar_feed|relation|schema cache/i.test(error.message) ? "setup" : error.message;
      return;
    }
    state.feedErr = null; state.feed = data ? data.token : null;
  }

  async function newFeedToken() {
    const { error } = await sb.from("calendar_feed").upsert({ user_id: state.user.id, token: hex(24) }, { onConflict: "user_id" });
    if (error) { setStatus(error.message, true); return; }
    await loadFeed(); renderFeed(); setStatus("Enlace generado");
  }

  function feedUrl(proto) {
    const host = new URL(cfg.SUPABASE_URL).host;
    return `${proto}//${host}/functions/v1/calendar?token=${state.feed}` + (state.feedBefore ? `&before=${state.feedBefore}` : "");
  }

  function renderFeed() {
    const card = $("feed-card"), el = $("feed");
    card.hidden = !!state.payErr;
    if (state.payErr) return;
    if (state.feedErr === "setup") { el.innerHTML = '<p class="muted hint">Falta ejecutar <code>supabase/003_calendar_feed.sql</code> en Supabase (SQL Editor) y publicar la función <code>calendar</code>. Los pasos están en el README.</p>'; return; }
    if (state.feedErr) { el.innerHTML = `<p class="error">${esc(state.feedErr)}</p>`; return; }
    if (!state.feed) {
      el.innerHTML = '<p class="muted hint">Generá un enlace privado y suscribilo en el calendario del celular: cada vencimiento pendiente aparece como evento con alerta a las 9:00 del día.</p><button id="feed-gen" class="primary">Generar enlace</button>';
      $("feed-gen").addEventListener("click", newFeedToken);
      return;
    }
    el.innerHTML =
      '<p class="muted hint">Suscribí este enlace en el calendario del celular. Cada vencimiento pendiente aparece como evento de todo el día con alerta a las 9:00. Es privado: no lo compartas.</p>' +
      `<div class="feed-row"><input id="feed-url" readonly value="${esc(feedUrl("https:"))}" aria-label="Enlace del calendario"><button id="feed-copy">Copiar</button></div>` +
      `<label class="check feed-opt">Además, avisar <select id="feed-before">${[0, 1, 2, 3].map((n) => `<option value="${n}"${n === state.feedBefore ? " selected" : ""}>${n === 0 ? "solo el día del vencimiento" : n === 1 ? "1 día antes" : n + " días antes"}</option>`).join("")}</select></label>` +
      `<p class="hint"><a id="feed-webcal" href="${esc(feedUrl("webcal:"))}">Abrir en Calendario (iPhone / Mac)</a> · <button id="feed-rotate" class="mini">Generar enlace nuevo</button></p>` +
      '<details class="hint"><summary>Cómo suscribirse</summary>' +
      '<p><b>iPhone:</b> tocá “Abrir en Calendario”, o andá a Ajustes → Calendario → Cuentas → Añadir cuenta → Otra → Añadir calendario suscrito y pegá el enlace. Las alertas ya vienen en cada evento.</p>' +
      '<p><b>Android / Google Calendar:</b> desde calendar.google.com en una computadora: Otros calendarios (+) → Desde URL → pegá el enlace. Después, en la configuración del calendario “Pagos”, agregá una notificación de eventos de todo el día (por ejemplo “el mismo día a las 9:00”), porque Google ignora las alertas del enlace y usa las suyas. Aparece solo en el celular tras sincronizar.</p>' +
      '<p>Los calendarios refrescan los enlaces cada cierto tiempo (en Google puede tardar hasta un día): si marcás un pago como pagado, la alerta puede llegar una vez más hasta que se actualice. “Generar enlace nuevo” invalida el anterior.</p></details>';
    $("feed-copy").addEventListener("click", async () => {
      const i = $("feed-url");
      try { await navigator.clipboard.writeText(i.value); setStatus("Enlace copiado"); } catch { i.select(); setStatus("Copiá con Ctrl+C"); }
    });
    $("feed-before").addEventListener("change", (e) => { state.feedBefore = +e.target.value; renderFeed(); });
    $("feed-rotate").addEventListener("click", () => { if (confirm("El enlace actual dejará de funcionar y tendrás que volver a suscribir el calendario. ¿Continuar?")) newFeedToken(); });
  }

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
