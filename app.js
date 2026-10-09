(function () {
  const cfg = window.CONFIG;
  const $ = (id) => document.getElementById(id);
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const fmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const money = (v) => (v < 0 ? "-$" : "$") + fmt.format(Math.abs(v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const state = { user: null, entries: new Map(), months: [], chart: null };
  const key = (m, g, n) => `${m}|${g}|${n}`;
  const get = (m, g, n) => state.entries.get(key(m, g, n))?.amount;
  const monthLabel = (m) => `${MESES[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;

  function setStatus(t, isErr) {
    const el = $("status");
    el.textContent = t; el.className = isErr ? "neg" : "muted";
    if (t && !isErr) setTimeout(() => { if (el.textContent === t) el.textContent = ""; }, 2000);
  }

  // ---------- datos ----------
  async function load() {
    const { data, error } = await sb.from("entries").select("id,month,grp,name,amount,expr").order("month");
    if (error) { setStatus("Error al cargar: " + error.message, true); return; }
    state.entries.clear();
    const ms = new Set(state.months);
    for (const r of data) {
      state.entries.set(key(r.month, r.grp, r.name), { id: r.id, amount: Number(r.amount), expr: r.expr });
      ms.add(r.month);
    }
    state.months = [...ms].sort();
    render();
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
    let y, m;
    if (last) { y = +last.slice(0, 4); m = +last.slice(5, 7) + 1; if (m > 12) { m = 1; y++; } }
    else { const d = new Date(); y = d.getFullYear(); m = d.getMonth() + 1; }
    const nm = `${y}-${String(m).padStart(2, "0")}-01`;
    if (last && confirm(`¿Copiar ingresos, fijos y cuotas de ${monthLabel(last)} a ${monthLabel(nm)} como punto de partida?`)) {
      const rows = [];
      for (const [k, v] of state.entries) {
        const [mm, grp, name] = k.split("|");
        if (mm !== last || grp === "Facturas" || name === "Gasto unico") continue;
        rows.push({ user_id: state.user.id, month: nm, grp, name, amount: v.amount, expr: v.expr });
      }
      if (rows.length) {
        const { error } = await sb.from("entries").upsert(rows, { onConflict: "user_id,month,grp,name" });
        if (error) { setStatus(error.message, true); return; }
      }
    }
    if (!state.months.includes(nm)) state.months.push(nm);
    await load();
  }

  // ---------- render ----------
  function rowNames(grp, base) {
    const names = [...base];
    for (const k of state.entries.keys()) {
      const [, g, n] = k.split("|");
      if (g === grp && !names.includes(n)) names.push(n);
    }
    return names;
  }

  function render() {
    const ms = state.months;
    const extra = { Ingresos: rowNames("Ingresos", cfg.INGRESOS), Fijos: rowNames("Fijos", cfg.FIJOS) };
    const totals = Object.fromEntries(ms.map((m) => [m, Calc.monthTotals(get, m, cfg, extra)]));

    // tarjetas
    const head = `<tr><th></th>${ms.map((m) => `<th>${monthLabel(m)}</th>`).join("")}</tr>`;
    const section = (t) => `<tr class="section"><td colspan="${ms.length + 1}">${esc(t)}</td></tr>`;
    const cell = (m, grp, name, autoVal) => {
      const v = get(m, grp, name);
      const auto = v === undefined && autoVal !== undefined;
      const shown = v ?? autoVal;
      return `<td class="num cell${auto ? " auto" : ""}" data-m="${m}" data-g="${esc(grp)}" data-n="${esc(name)}"` +
        `${auto ? ' title="Calculado desde Facturas; escribí un valor para reemplazarlo"' : ""}>${shown === undefined ? "" : money(shown)}</td>`;
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
    for (const n of extra.Ingresos) h += line(n, "Ingresos", n, "sub");
    h += totalRow("Total ingresos", (m) => totals[m].ingresos);
    h += section("Gastos fijos");
    for (const n of extra.Fijos) h += line(n, "Fijos", n, "sub", n === "Servicios" ? (m) => totals[m].servicioAuto : null);
    h += totalRow("Total fijos", (m) => totals[m].fijos);
    h += section("Tarjetas");
    for (const t of cfg.TARJETAS) {
      h += `<tr class="card-title"><td>${esc(t)}</td>${ms.map(() => "<td></td>").join("")}</tr>`;
      for (const f of cfg.TARJETA_FILAS) h += line(f, t, f, "sub");
      h += totalRow(`Total ${t}`, (m) => totals[m].tarjetas[t]);
    }
    h += section("Facturas de servicios");
    for (const f of rowNames("Facturas", cfg.FACTURAS)) h += line(f, "Facturas", f, "sub");
    h += totalRow("Total gastos", (m) => totals[m].gastos, "total");
    $("sheet").innerHTML = h;

    // resumen del último mes
    const last = ms[ms.length - 1];
    if (last) {
      const t = totals[last];
      const stat = (l, v, c = "") => `<div class="stat"><div class="label">${l}</div><div class="value ${c}">${money(v)}</div></div>`;
      $("summary").innerHTML = stat(`Ingresos · ${monthLabel(last)}`, t.ingresos) +
        stat(`Gastos · ${monthLabel(last)}`, t.gastos) +
        stat(`Balance · ${monthLabel(last)}`, t.balance, t.balance < 0 ? "neg" : "pos");
    } else $("summary").innerHTML = "";

    drawChart(ms, totals);
  }

  function drawChart(ms, totals) {
    if (!window.Chart) return;
    const css = getComputedStyle(document.documentElement);
    const c = (v) => css.getPropertyValue(v).trim();
    const data = {
      labels: ms.map(monthLabel),
      datasets: [
        { type: "bar", label: "Ingresos", data: ms.map((m) => totals[m].ingresos), backgroundColor: c("--c-ing") },
        { type: "bar", label: "Gastos", data: ms.map((m) => totals[m].gastos), backgroundColor: c("--c-gas") },
        { type: "line", label: "Balance", data: ms.map((m) => totals[m].balance), borderColor: c("--text"), backgroundColor: c("--text"), tension: 0.2 },
      ],
    };
    if (state.chart) { state.chart.data = data; state.chart.update(); return; }
    state.chart = new Chart($("chart"), {
      data,
      options: {
        responsive: true, maintainAspectRatio: false,
        color: c("--text"),
        scales: {
          x: { ticks: { color: c("--muted") }, grid: { display: false } },
          y: { ticks: { color: c("--muted"), callback: (v) => money(v) }, grid: { color: c("--line") } },
        },
        plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } } },
      },
    });
  }

  // ---------- edición inline ----------
  $("sheet").addEventListener("click", (e) => {
    const td = e.target.closest("td.cell");
    if (!td || td.classList.contains("editing")) return;
    const { m, g, n } = td.dataset;
    const ent = state.entries.get(key(m, g, n));
    const input = document.createElement("input");
    input.inputMode = "decimal";
    input.value = ent ? (ent.expr ?? String(ent.amount)) : "";
    td.classList.add("editing"); td.textContent = ""; td.appendChild(input);
    input.focus(); input.select();
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      if (commit && input.value !== (ent ? (ent.expr ?? String(ent.amount)) : "")) await saveCell(m, g, n, input.value);
      render();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  });

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
  $("logout").addEventListener("click", () => sb.auth.signOut());
  $("add-month").addEventListener("click", addMonth);

  // Dispara INITIAL_SESSION al cargar, SIGNED_IN al loguear y SIGNED_OUT al salir
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === "TOKEN_REFRESHED") return;
    setTimeout(() => showApp(session), 0); // evita llamar a supabase dentro del callback
  });
})();
