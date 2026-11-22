(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney } = MB;
  const charts = {};

  function destroy(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  }

  function makeChart(id, config) {
    destroy(id);
    const el = document.getElementById(id);
    if (!el || typeof Chart === "undefined") return;
    charts[id] = new Chart(el.getContext("2d"), config);
  }

  const axis = {
    ticks: { color: "#8b949e", maxRotation: 0, autoSkip: true },
    grid: { color: "rgba(139,148,158,.16)" },
  };
  const legend = { labels: { color: "#e6edf3", boxWidth: 12 } };

  function highlightBars(values) {
    const accent = MB.cssToken("--accent", "#9FE870");
    const owe = MB.cssToken("--owe", "#FB7185");
    const getback = MB.cssToken("--getback", "#3DDC97");
    if (!values.length) return values.map(() => accent);
    const max = Math.max(...values);
    const min = Math.min(...values);
    return values.map((v) => {
      if (v === max && (max !== min || values.length === 1)) return owe;
      if (v === min && max !== min) return getback;
      return accent;
    });
  }

  async function loadState(ctx, mode, range) {
    const keys = MB.monthKeysBack(ctx.month, range);
    const start = keys[0] + "-01";
    const end = MB.monthBounds(keys[keys.length - 1]).end;
    const selected = ctx.month;
    const { start: mStart, end: mEnd } = MB.monthBounds(selected);

    if (mode === "personal") {
      const rows = await MB.loadPersonalRange(start, end);
      const expenses = rows.filter((r) => r.type === "expense");
      const { data: profile } = await MB.client().from("profiles").select("personal_budget_limit").eq("id", ctx.uid).maybeSingle();
      const budget = profile && profile.personal_budget_limit != null ? Number(profile.personal_budget_limit) : 0;
      return { keys, selected, expenses, budget, members: null, mStart, mEnd };
    }

    if (!ctx.room) return { keys, selected, expenses: [], budget: 0, members: [], mStart, mEnd, noRoom: true };
    const expenses = await MB.loadRoomExpensesRange(ctx.room.id, start, end);
    const members = await MB.loadMembers(ctx.room.id);
    const budget = Number(ctx.room.monthly_budget_limit) || 0;
    return { keys, selected, expenses, budget, members, mStart, mEnd };
  }

  function totalsByMonth(keys, expenses) {
    const map = Object.fromEntries(keys.map((k) => [k, 0]));
    expenses.forEach((e) => {
      const k = String(e.date).slice(0, 7);
      if (map[k] != null) map[k] += Number(e.amount);
    });
    return keys.map((k) => map[k]);
  }

  function categoryTotals(expenses, month) {
    const map = {};
    expenses.filter((e) => String(e.date).slice(0, 7) === month).forEach((e) => {
      map[e.category] = (map[e.category] || 0) + Number(e.amount);
    });
    return map;
  }

  function renderKpis(keys, values, expenses, selected) {
    const idx = keys.indexOf(selected);
    const current = values[idx] || 0;
    const prev = idx > 0 ? values[idx - 1] : 0;
    const change = prev === 0 ? (current === 0 ? 0 : 100) : ((current - prev) / prev) * 100;
    const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const max = Math.max(0, ...values);
    const maxMonth = keys[values.indexOf(max)] || selected;
    const cats = categoryTotals(expenses, selected);
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    const tiles = [
      { label: "This month", value: formatMoney(current) },
      { label: "Last month", value: formatMoney(prev) },
      { label: "Change", value: (change >= 0 ? "+" : "") + change.toFixed(1) + "%", delta: -change },
      { label: "Average / month", value: formatMoney(avg) },
      { label: "Highest month", value: MB.monthLabel(maxMonth), sub: formatMoney(max) },
      { label: "Top category", value: top ? top[0] : "—", sub: top ? formatMoney(top[1]) : "" },
    ];
    $("kpi-grid").innerHTML = tiles.map((t) => {
      const deltaCls = t.delta == null ? "" : (t.delta > 0.05 ? "up" : t.delta < -0.05 ? "down" : "");
      const extra = t.sub ? `<p class="delta">${escapeHtml(t.sub)}</p>` : (t.delta != null ? `<p class="delta ${deltaCls}">vs last month</p>` : "");
      return `<article class="kpi-tile"><p class="label">${escapeHtml(t.label)}</p><p class="value">${escapeHtml(t.value)}</p>${extra}</article>`;
    }).join("");
  }

  function renderMom(keys, values) {
    const colors = highlightBars(values);
    makeChart("chart-mom", {
      type: "bar",
      data: {
        labels: keys.map((k) => MB.monthLabel(k).replace(" 20", " '")),
        datasets: [{ label: "Spending", data: values, backgroundColor: colors, borderRadius: 6, maxBarThickness: 36 }],
      },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { footer: (items) => {
          if (!items.length) return "";
          const v = items[0].parsed.y;
          const max = Math.max(...values);
          const min = Math.min(...values);
          if (v === max && max !== min) return "Highest month";
          if (v === min && max !== min) return "Lowest month";
          return "";
        } } } },
        scales: { x: axis, y: { ...axis, beginAtZero: true } },
        maintainAspectRatio: false,
      },
    });
  }

  function renderVsBudget(keys, values, budget) {
    makeChart("chart-vs-budget", {
      type: "bar",
      data: {
        labels: keys.map((k) => MB.monthLabel(k).replace(" 20", " '")),
        datasets: [
          { type: "bar", label: "Spending", data: values, backgroundColor: "#388bfd", borderRadius: 6, maxBarThickness: 32 },
          { type: "line", label: "Budget", data: keys.map(() => budget || null), borderColor: "#e3b341", borderDash: [6, 4], pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: { plugins: { legend }, scales: { x: axis, y: { ...axis, beginAtZero: true } }, maintainAspectRatio: false },
    });
  }

  function renderDonut(expenses, month) {
    const map = categoryTotals(expenses, month);
    const labels = Object.keys(map);
    const data = labels.map((l) => map[l]);
    makeChart("chart-donut", {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: labels.map((l) => MB.colorForCategory(l)), borderWidth: 0 }] },
      options: { plugins: { legend }, cutout: "58%", maintainAspectRatio: false },
    });
  }

  function renderStack(keys, expenses) {
    const cats = [];
    expenses.forEach((e) => { if (!cats.includes(e.category)) cats.push(e.category); });
    const datasets = cats.map((cat) => ({
      label: cat,
      data: keys.map((k) => expenses.filter((e) => e.category === cat && String(e.date).slice(0, 7) === k).reduce((s, e) => s + Number(e.amount), 0)),
      backgroundColor: MB.colorForCategory(cat),
      stack: "s",
    }));
    makeChart("chart-stack", {
      type: "bar",
      data: { labels: keys.map((k) => MB.monthLabel(k).replace(" 20", " '")), datasets },
      options: { plugins: { legend }, scales: { x: { ...axis, stacked: true }, y: { ...axis, stacked: true, beginAtZero: true } }, maintainAspectRatio: false },
    });
  }

  function renderMembers(keys, expenses, members, selected) {
    const panel = document.getElementById("member-panel");
    if (!members) { if (panel) panel.hidden = true; return; }
    if (panel) panel.hidden = false;
    const monthRows = expenses.filter((e) => String(e.date).slice(0, 7) === selected);
    const labels = members.map((m) => m.display_name);
    const data = members.map((m) => monthRows.filter((e) => e.paid_by === m.id).reduce((s, e) => s + Number(e.amount), 0));
    makeChart("chart-members", {
      type: "bar",
      data: { labels, datasets: [{ label: "Paid", data, backgroundColor: "#a371f7", borderRadius: 6, maxBarThickness: 40 }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { ...axis, beginAtZero: true }, y: axis }, maintainAspectRatio: false },
    });
  }

  function renderDaily(expenses, month, budget) {
    const { start, end } = MB.monthBounds(month);
    const days = [];
    for (let d = new Date(start + "T00:00:00"); d <= new Date(end + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    const perDay = Object.fromEntries(days.map((d) => [d, 0]));
    expenses.filter((e) => String(e.date).slice(0, 7) === month).forEach((e) => { perDay[e.date] = (perDay[e.date] || 0) + Number(e.amount); });
    const daily = days.map((d) => perDay[d] || 0);
    let run = 0;
    const cum = daily.map((v) => { run += v; return run; });
    makeChart("chart-daily", {
      type: "line",
      data: {
        labels: days.map((d) => d.slice(8)),
        datasets: [
          { label: "Daily", data: daily, borderColor: "#58a6ff", backgroundColor: "rgba(88,166,255,.15)", fill: true, tension: 0.25, pointRadius: 0, yAxisID: "y" },
          { label: "Cumulative", data: cum, borderColor: MB.cssToken("--accent", "#9FE870"), tension: 0.2, pointRadius: 0, yAxisID: "y1" },
          { label: "Budget", data: days.map(() => budget || null), borderColor: "#e3b341", borderDash: [5, 4], pointRadius: 0, yAxisID: "y1" },
        ],
      },
      options: {
        plugins: { legend },
        scales: {
          x: axis,
          y: { ...axis, beginAtZero: true, position: "left", title: { display: true, text: "Daily", color: "#8b949e" } },
          y1: { ...axis, beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Cumulative", color: "#8b949e" } },
        },
        maintainAspectRatio: false,
      },
    });
  }

  async function render(ctx, mode, range) {
    const state = await loadState(ctx, mode, range);
    if (state.noRoom && mode === "room") {
      $("kpi-grid").innerHTML = `<article class="kpi-tile"><p class="label">Room</p><p class="value">Join a room to see shared analytics, or switch to Personal.</p></article>`;
      ["chart-mom","chart-vs-budget","chart-donut","chart-stack","chart-members","chart-daily"].forEach(destroy);
      return;
    }
    const values = totalsByMonth(state.keys, state.expenses);
    renderKpis(state.keys, values, state.expenses, state.selected);
    await MB.loadChartJs();
    renderMom(state.keys, values);
    renderVsBudget(state.keys, values, state.budget);
    renderDonut(state.expenses, state.selected);
    renderStack(state.keys, state.expenses);
    renderMembers(state.keys, state.expenses, state.members, state.selected);
    renderDaily(state.expenses, state.selected, state.budget);
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    let mode = params.get("mode") === "personal" ? "personal" : "room";
    let range = 6;
    const ctx = await MB.bootApp({ title: "Analytics", month: true, keepMonth: true });
    if (!ctx) return;
    if (mode === "personal") {
      const nameEl = document.getElementById("room-name");
      if (nameEl && !ctx.room) nameEl.textContent = "Personal";
    }
    const syncToggles = () => {
      document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-mode") === mode));
      document.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("is-active", Number(b.getAttribute("data-range")) === range));
    };
    syncToggles();
    document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", async () => {
      mode = b.getAttribute("data-mode");
      syncToggles();
      const url = new URL(location.href);
      url.searchParams.set("mode", mode);
      history.replaceState({}, "", url);
      await render(ctx, mode, range);
    }));
    document.querySelectorAll("[data-range]").forEach((b) => b.addEventListener("click", async () => {
      range = Number(b.getAttribute("data-range"));
      syncToggles();
      await render(ctx, mode, range);
    }));
    await render(ctx, mode, range);
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
