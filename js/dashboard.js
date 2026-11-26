(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, netLabel, colorForCategory } = MB;


  function renderReceiptPromo() {
    const host = $("dash-promo");
    if (!host) return;
    try {
      if (localStorage.getItem("mb-promo-receipts-dismissed") === "1") {
        host.hidden = true;
        host.innerHTML = "";
        return;
      }
    } catch (e) { /* ignore */ }
    host.hidden = false;
    host.innerHTML = `
      <button type="button" class="promo-close" id="promo-close" aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M3 3l8 8M11 3 3 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
      <img class="promo-art" src="${MB.withBase("images/illu-receipts.webp")}" width="180" height="180" alt="" />
      <h2 class="display-title">Scan receipts in a tap</h2>
      <p class="card-sub">Photograph a bill and we fill in the amount, date, and description for you.</p>
      <div class="btn-row">
        <a class="primary-btn" href="add-expense.html">Get started</a>
        <a class="secondary-btn" href="add-expense.html">Learn more</a>
      </div>`;
    const close = $("promo-close");
    if (close) close.addEventListener("click", () => {
      try { localStorage.setItem("mb-promo-receipts-dismissed", "1"); } catch (e) { /* ignore */ }
      host.hidden = true;
      host.innerHTML = "";
    });
  }

  function renderNoRoom() {
    $("dash-content").innerHTML = `
      <section class="card">
        <h2>Set up your room</h2>
        <p class="card-sub">Create a room for your flat, or enter a 6-character invite code from a roommate.</p>
        <form id="create-form" style="margin-top:16px">
          <label class="field"><span>Name</span><input type="text" id="new-room-name" maxlength="80" placeholder="e.g. 3rd Floor Boys" required /></label>
          <label class="field"><span>Type</span>
            <select id="new-room-type" class="select">
              <option value="home">Home / roommate room</option>
              <option value="trip">Trip or event</option>
            </select>
          </label>
          <div id="trip-dates" hidden class="filters">
            <label class="field"><span>Start</span><input type="date" id="new-room-start" /></label>
            <label class="field"><span>End</span><input type="date" id="new-room-end" /></label>
          </div>
          <button type="submit" class="primary-btn">Create room</button>
        </form>
        <form id="join-form" style="margin-top:18px">
          <label class="field"><span>Invite code</span><input type="text" id="join-code" maxlength="6" placeholder="ABC123" autocapitalize="characters" /></label>
          <button type="submit" class="secondary-btn">Join room</button>
        </form>
        <p class="form-error" id="room-error" hidden></p>
      </section>`;
    const typeSel = $("new-room-type");
    if (typeSel) typeSel.addEventListener("change", () => { $("trip-dates").hidden = typeSel.value !== "trip"; });
    $("create-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("new-room-name").value.trim();
      const typ = ($("new-room-type") && $("new-room-type").value) || "home";
      const { data, error } = await MB.client().rpc("create_room", {
        p_name: name,
        p_type: typ,
        p_start_date: typ === "trip" ? ($("new-room-start").value || null) : null,
        p_end_date: typ === "trip" ? ($("new-room-end").value || null) : null,
      });
      if (error) return MB.showError("room-error", MB.errorMessage(error));
      MB.setActiveRoomId(data.id);
      location.reload();
    });
    $("join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { data, error } = await MB.client().rpc("join_room", { p_code: $("join-code").value });
      if (error) return MB.showError("room-error", MB.errorMessage(error));
      if (data.status === "pending") {
        return MB.showError("room-error", "Your request to join " + (data.name || "this room") + " is waiting for approval.");
      }
      MB.setActiveRoomId(data.id);
      location.reload();
    });
    renderMyInvites().catch((e) => console.warn(e));
    const pendingJoin = (() => { try { return JSON.parse(sessionStorage.getItem("monthly-budget-join-pending") || "null"); } catch (e) { return null; } })();
    if (pendingJoin && pendingJoin.status === "pending") {
      const err = document.getElementById("room-error");
      if (err) { err.hidden = false; err.textContent = "Your request to join " + (pendingJoin.name || "the room") + " is waiting for approval."; }
    }
  }

  async function renderMyInvites(hostId) {
    const host = document.getElementById(hostId || "dash-content");
    try {
      const { data, error } = await MB.client().rpc("list_my_invites");
      if (error) throw error;
      const rows = Array.isArray(data) ? data : (data ? [data] : []);
      if (!rows.length) return;
      const box = document.getElementById("onboard-invites") || (() => {
        const s = document.createElement("section");
        s.className = "card";
        s.id = "onboard-invites";
        host.insertBefore(s, host.firstChild);
        return s;
      })();
      box.hidden = false;
      box.innerHTML = `<header class="card-head"><h2>Invites for you</h2></header>` + rows.map((i) => `
        <div class="pending-card" data-invite="${escapeHtml(i.id)}">
          <div><div class="item-title">${escapeHtml(i.room_name)}</div><div class="item-sub">Invited to your email ${escapeHtml(i.email)}</div></div>
          <div class="btn-row compact">
            <button type="button" class="primary-btn" data-accept-inv="${escapeHtml(i.id)}">Accept</button>
            <button type="button" class="danger-btn ghost" data-decline-inv="${escapeHtml(i.id)}">Decline</button>
          </div>
        </div>`).join("");
      box.querySelectorAll("[data-accept-inv], [data-decline-inv]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const accept = btn.hasAttribute("data-accept-inv");
          const id = btn.getAttribute("data-accept-inv") || btn.getAttribute("data-decline-inv");
          const { data, error } = await MB.client().rpc("respond_to_invite", { p_invite_id: id, p_accept: accept });
          if (error) return MB.showPageError(MB.errorMessage(error));
          if (accept && data && data.id) MB.setActiveRoomId(data.id);
          location.reload();
        });
      });
    } catch (e) { console.warn(e); }
  }

  async function renderJoinRequests(roomId, preloaded) {
    const box = document.getElementById("admin-joins");
    const list = document.getElementById("join-request-list");
    if (!box || !list) return;
    let data = preloaded;
    if (!data) {
      const res = await MB.client().from("join_requests").select("id, user_id, status, created_at").eq("room_id", roomId).eq("status", "pending").order("created_at");
      if (res.error || !res.data || !res.data.length) return;
      data = res.data;
    }
    if (!data.length) return;
    const ids = data.map((r) => r.user_id);
    const needNames = data.some((r) => !r.display_name);
    let profiles = [];
    if (needNames && ids.length) {
      const res = await MB.client().from("profiles").select("id, display_name, avatar_url").in("id", ids);
      profiles = res.data || [];
    }
    box.hidden = false;
    list.innerHTML = data.map((r) => {
      const p = profiles.find((x) => x.id === r.user_id) || {};
      const person = { id: r.user_id, display_name: r.display_name || p.display_name || "Someone", avatar_url: r.avatar_url || p.avatar_url };
      return `<div class="pending-card">
        <div><div class="item-title">${MB.personChip(person, null, "md")}</div><div class="item-sub">Asked to join with the room code</div></div>
        <div class="btn-row compact">
          <button type="button" class="primary-btn" data-approve="${escapeHtml(r.id)}">Approve</button>
          <button type="button" class="danger-btn ghost" data-reject="${escapeHtml(r.id)}">Reject</button>
        </div>
      </div>`;
    }).join("");
    list.querySelectorAll("[data-approve], [data-reject]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const approve = btn.hasAttribute("data-approve");
        const id = btn.getAttribute("data-approve") || btn.getAttribute("data-reject");
        const { error } = await MB.client().rpc(approve ? "approve_join_request" : "reject_join_request", { p_request_id: id });
        if (error) return MB.showPageError(MB.errorMessage(error));
        location.reload();
      });
    });
  }


  function renderChart(spent) {
    const empty = $("category-empty");
    const canvas = $("category-chart");
    const legend = $("category-legend");
    if (!canvas) return;
    if (!window.Chart) {
      if (empty) { empty.hidden = false; empty.textContent = "The chart could not be loaded."; }
      return;
    }
    const rows = Object.entries(spent).map(([name, amount]) => ({ name, amount, color: (colorForCategory || MB.colorForCategory)(name) })).filter((r) => r.amount > 0).sort((a,b) => b.amount - a.amount);
    if (empty) {
      empty.hidden = rows.length > 0;
      empty.textContent = rows.length ? "" : "No spending to chart this month yet.";
    }
    canvas.style.opacity = rows.length ? "1" : "0";
    if (legend) legend.innerHTML = rows.map((r) => `<li>${MB.categoryChip(r.name)}<span class="amt">${escapeHtml(formatMoney(r.amount))}</span></li>`).join("");
    if (!rows.length) {
      if (window._dashChart) { window._dashChart.destroy(); window._dashChart = null; }
      window._dashChartReady = true;
      return;
    }
    const paint = () => {
      const wrap = canvas.parentElement;
      if (wrap && (wrap.clientWidth < 40 || wrap.clientHeight < 40)) {
        requestAnimationFrame(paint);
        return;
      }
      if (window._dashChart) window._dashChart.destroy();
      window._dashChartReady = false;
      window._dashSpent = spent;
      window._dashChart = new Chart(canvas, {
        type: "doughnut",
        data: { labels: rows.map((r) => r.name), datasets: [{ data: rows.map((r) => r.amount), backgroundColor: rows.map((r) => r.color), borderWidth: 0 }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          rotation: -90,
          circumference: 360,
          cutout: "64%",
          animation: {
            duration: 500,
            onComplete: () => { window._dashChartReady = true; },
          },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => " " + formatMoney(c.parsed) } } },
        },
      });
    };
    paint();
  }
  window.addEventListener("mb-theme-change", () => {
    if (window._dashSpent) renderChart(window._dashSpent);
  });


  function bindDashInvite(ctx, members) {
    const btn = $("dash-invite");
    if (!btn || !ctx.room) return;
    const owner = (members || []).find((m) => m.role === "owner");
    const inviter = (owner && owner.display_name) || (ctx.profile && ctx.profile.display_name) || "a roommate";
    btn.addEventListener("click", async () => {
      const result = await MB.shareInvite(ctx.room, inviter);
      if (result === "aborted") return;
    });
  }

  function setupPushBanner() {
    const banner = $("push-banner");
    if (!banner) return;
    const dismissed = (() => { try { return localStorage.getItem("mb-push-banner-dismissed") === "1"; } catch (e) { return false; } })();
    const enabled = (() => { try { return localStorage.getItem("mb-push-enabled") === "1"; } catch (e) { return false; } })();
    if (dismissed || enabled) return;
    if (MB.isIosDevice()) {
      const hint = $("dash-ios-hint");
      if (hint) hint.hidden = false;
    }
    banner.hidden = false;
    $("push-banner-dismiss").addEventListener("click", () => {
      try { localStorage.setItem("mb-push-banner-dismissed", "1"); } catch (e) { /* ignore */ }
      banner.hidden = true;
    });
    $("push-banner-enable").addEventListener("click", async () => {
      const err = $("push-banner-error");
      if (err) { err.hidden = true; err.textContent = ""; }
      try {
        await MB.subscribePush();
        banner.hidden = true;
      } catch (e) {
        if (err) { err.hidden = false; err.textContent = MB.errorMessage(e); }
      }
    });
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "This month", month: true });
    if (!ctx) return;
    setupPushBanner();
    if (!ctx.room) { renderReceiptPromo(); return renderNoRoom(); }
    const members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    bindDashInvite(ctx, members);
    const packed = (ctx.expenses && ctx.splits) ? ctx : await MB.loadMonthData(ctx.room.id, ctx.month);
    const { expenses, splits, settlements } = packed;
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const mine = balances.find((b) => b.id === ctx.uid) || { paidAmt: 0, shareAmt: 0, netAmt: 0 };
    const roomTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const net = netLabel(mine.netAmt);
    const hero = (MB.balanceHeadline || function (id, bals) { const n = (bals || []).find((b) => b.id === id) || { netAmt: 0 }; return { text: MB.netLabel(n.netAmt).text, cls: (n.netAmt > 0.005 ? "is-owed" : (n.netAmt < -0.005 ? "is-owe" : "is-settled")), direction: n.netAmt > 0.005 ? "owed" : (n.netAmt < -0.005 ? "owe" : "settled"), counterpart: null, amount: Math.abs(n.netAmt || 0) }; })(ctx.uid, balances);
    const heroEl = $("hero-status");
    const heroLine = $("hero-line");
    if (heroEl && heroLine) {
      heroEl.className = "card hero-status " + hero.cls;
      if (hero.counterpart) {
        const chip = MB.personChip(MB.memberRecord(hero.counterpart.id, members), members, "lg");
        if (hero.direction === "owed") heroLine.innerHTML = chip + ' <span class="hero-rest">owes you ' + MB.escapeHtml(MB.formatMoney(hero.amount)) + "</span>";
        else if (hero.direction === "owe") heroLine.innerHTML = 'You owe ' + chip + ' <span class="hero-rest">' + MB.escapeHtml(MB.formatMoney(hero.amount)) + "</span>";
        else heroLine.textContent = hero.text;
      } else {
        heroLine.textContent = hero.text;
      }
      const sub = $("hero-sub");
      if (sub) {
        sub.innerHTML = hero.direction === "settled"
          ? "No one in this room owes anyone for this month."
          : 'Based on accepted shares this month. ' + MB.infoTip("Settling up means paying what you owe, or collecting what you are owed, so everyone's balance goes back to zero.");
      }
      const heroNote = $("hero-note");
      if (heroNote) {
        const note = MB.balanceFootnote(mine);
        heroNote.hidden = !note;
        heroNote.textContent = note || "";
      }
      const remind = $("hero-remind");
      if (remind) {
        const href = MB.remindWhatsAppHref(hero, ctx.room);
        if (href && hero.counterpart) {
          remind.hidden = false;
          remind.href = href;
          remind.innerHTML = (MB.ICONS && MB.ICONS.wa ? MB.ICONS.wa : "") + "<span>Remind</span>";
        } else {
          remind.hidden = true;
        }
      }
    }
    renderReceiptPromo();
    MB.renderOnboardingTip($("onboard-tip"));
    const limit = Number(ctx.room.monthly_budget_limit) || 0;
    const sentence = $("month-sentence");
    if (sentence) sentence.textContent = (MB.monthSpendSentence || function (spent, lim) { return (MB.formatMoney(spent) + (lim > 0 ? " of " + MB.formatMoney(lim) + " used" : " spent this month")); })(roomTotal, limit, ctx.month);
    const shareEl = $("month-share");
    if (shareEl) shareEl.textContent = "Your share " + formatMoney(mine.shareAmt);
    const bar = $("month-progress");
    if (bar && limit > 0) {
      bar.hidden = false;
      const fill = $("budget-fill");
      const pct = Math.round((roomTotal / limit) * 100);
      if (fill) { fill.style.width = Math.min(100, pct) + "%"; fill.className = toneClass(pct); }
    }
    if ($("stat-room")) $("stat-room").textContent = formatMoney(roomTotal);
    $("stat-paid").textContent = formatMoney(mine.paidAmt);
    $("stat-share").textContent = formatMoney(mine.shareAmt);
    const cap = MB.shareStatCaption ? MB.shareStatCaption(mine.netAmt) : { label: net.text, value: formatMoney(Math.abs(mine.netAmt)), cls: net.cls };
    const netLabelEl = $("stat-net-label");
    if (netLabelEl) netLabelEl.textContent = cap.label;
    $("stat-net").textContent = cap.value;
    $("stat-net-card").className = "stat " + cap.cls;
    // Hero already shows this footnote; keep the My share tiles uncluttered.
    const dashNote = $("stat-net-note");
    if (dashNote) { dashNote.hidden = true; dashNote.textContent = ""; }

    const pendingItems = typeof MB.pendingWithExpense === "function"
      ? MB.pendingWithExpense(ctx.pending, expenses)
      : (ctx.pending || []).filter((r) => r && r.expense);
    if (pendingItems.length) {
      $("pending-section").hidden = false;
      MB.renderPendingItems($("pending-list"), pendingItems, members, expenses);
    }

    const myAccepted = (splits || []).filter((s) => s.user_id === ctx.uid && s.status === "accepted");
    $("my-accepted-list").innerHTML = myAccepted.length ? myAccepted.map((s) => {
      const e = expenses.find((x) => x.id === s.expense_id);
      if (!e) return "";
      return MB.expenseRowHtml(e, { members, splits: [s] });
    }).join("") : MB.emptyState({ art: "images/illu-handshake.webp", title: "No accepted shares yet", text: "When you accept your part of a bill, it will show up here.", href: "add-expense.html", cta: "Add an expense" });

    const recent = (expenses || []).filter((e) => e && e.id).slice(0, 6);
    $("recent-list").innerHTML = recent.length
      ? recent.map((e) => MB.expenseRowHtml(e, { members, splits })).join("")
      : MB.emptyState({ art: "images/illu-receipts.webp", title: "No expenses this month", text: "Add rent, groceries, or a dinner to start tracking together.", href: "add-expense.html", cta: "Add an expense" });

    const spent = {};
    (expenses || []).forEach((e) => { if (!e) return; spent[e.category] = (spent[e.category] || 0) + Number(e.amount); });
    const afterCharts = async () => {
      try {
        await MB.loadChartJs();
      } catch (err) { console.warn(err); }
      renderChart(spent);
      try {
        await renderBudgets(ctx, expenses, roomTotal, spent);
      } catch (err) { console.warn(err); }
    };
    const chartHost = document.querySelector(".charts-grid") || $("category-chart") || $("category-empty");
    MB.whenVisible(chartHost, afterCharts);
    if (ctx.isAdmin) await renderJoinRequests(ctx.room.id, ctx.joinRequests);
    await renderMyInvites("dash-content");
  }

  function toneClass(pct) {
    if (pct >= 100) return "is-over";
    if (pct >= 80) return "is-warn";
    return "";
  }

  function drawGauge(canvas, pct) {
    if (!canvas || typeof Chart === "undefined") return;
    const used = Math.max(0, Math.min(100, pct));
    const color = used >= 100 ? MB.cssToken("--owe", "#FB7185") : used >= 80 ? MB.cssToken("--warn", "#F59E0B") : MB.cssToken("--accent", "#9FE870");
    if (canvas._chart) canvas._chart.destroy();
    canvas._chart = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: { datasets: [{ data: [used, Math.max(0, 100 - used)], backgroundColor: [color, "rgba(128,128,128,.18)"], borderWidth: 0 }] },
      options: {
        cutout: "72%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        animation: { duration: 400 },
        maintainAspectRatio: false,
      },
    });
  }

  async function renderBudgets(ctx, expenses, roomTotal, spentMap) {
    const card = $("budget-card");
    const banner = $("budget-banner");
    const limit = Number(ctx.room.monthly_budget_limit);
    let catBudgets = [];
    try { catBudgets = await MB.loadRoomCategoryBudgets(ctx.room.id) || []; }
    catch (err) { console.warn(err); }
    if (card) card.hidden = !(limit > 0 || catBudgets.length);
    const pct = limit > 0 ? Math.round((roomTotal / limit) * 100) : 0;
    if (limit > 0 && $("budget-label")) {
      $("budget-label").textContent = formatMoney(roomTotal) + " of " + formatMoney(limit) + " (" + pct + "%)";
      const fill = $("budget-fill");
      if (fill) { fill.style.width = Math.min(100, pct) + "%"; fill.className = toneClass(pct); }
      drawGauge($("budget-gauge"), pct);
    }
    const overCats = catBudgets.filter((b) => (spentMap[b.category] || 0) >= Number(b.limit_amount));
    const warnCats = catBudgets.filter((b) => {
      const s = spentMap[b.category] || 0;
      return s >= Number(b.limit_amount) * 0.8 && s < Number(b.limit_amount);
    });
    if (banner) {
      if (limit > 0 && pct >= 100) {
        banner.hidden = false;
        banner.className = "budget-banner";
        banner.innerHTML = `<p><strong>This month's room budget is exceeded</strong>You've spent ${escapeHtml(formatMoney(roomTotal))} of ${escapeHtml(formatMoney(limit))}.</p><button type="button" class="text-btn" id="enable-push">Enable alerts</button>`;
        MB.maybeBrowserNotify("Room budget exceeded", "Spending is " + formatMoney(roomTotal) + " of " + formatMoney(limit), "room-over-" + ctx.month);
      } else if (limit > 0 && pct >= 80) {
        banner.hidden = false;
        banner.className = "budget-banner is-warn";
        banner.innerHTML = `<p><strong>This month's room budget is at ${pct}%</strong>You've spent ${escapeHtml(formatMoney(roomTotal))} of ${escapeHtml(formatMoney(limit))}.</p><button type="button" class="text-btn" id="enable-push">Enable alerts</button>`;
      } else if (overCats.length) {
        banner.hidden = false;
        banner.className = "budget-banner";
        banner.innerHTML = `<p><strong>A category budget is exceeded</strong>${escapeHtml(overCats.map((c) => c.category).join(", "))} went over the limit set for this room.</p><button type="button" class="text-btn" id="enable-push">Enable alerts</button>`;
      } else {
        banner.hidden = true;
        banner.innerHTML = "";
      }
      const pushBtn = document.getElementById("enable-push");
      if (pushBtn) pushBtn.addEventListener("click", async () => {
        const res = await MB.requestBrowserNotify();
        pushBtn.textContent = res === "granted" ? "Alerts on" : "Alerts blocked in the browser";
      });
    }
    const host = $("cat-budget-list");
    if (host) {
      host.innerHTML = catBudgets.map((b) => {
        const s = spentMap[b.category] || 0;
        const p = Math.round((s / Number(b.limit_amount)) * 100);
        return `<div class="cat-budget-row"><div class="item-sub"><span>${escapeHtml(b.category)}</span><span>${escapeHtml(formatMoney(s))} of ${escapeHtml(formatMoney(b.limit_amount))} (${p}%)</span></div><div class="budget-bar"><span class="${toneClass(p)}" style="width:${Math.min(100, p)}%"></span></div></div>`;
      }).join("");
    }
    const spark = $("spend-spark");
    if (spark && typeof Chart !== "undefined") {
      const keys = MB.monthKeysBack(ctx.month, 6);
      const start = keys[0] + "-01";
      const end = MB.monthBounds(keys[keys.length - 1]).end;
      try {
        const rows = await MB.loadRoomExpensesRange(ctx.room.id, start, end);
        const totals = Object.fromEntries(keys.map((k) => [k, 0]));
        rows.forEach((e) => { const k = String(e.date).slice(0, 7); if (totals[k] != null) totals[k] += Number(e.amount); });
        const values = keys.map((k) => totals[k]);
        if (spark._chart) spark._chart.destroy();
        spark._chart = new Chart(spark.getContext("2d"), {
          type: "line",
          data: {
            labels: keys.map((k) => MB.monthLabel(k).slice(0, 3)),
            datasets: [{ data: values, borderColor: MB.cssToken("--accent", "#9FE870"), backgroundColor: MB.cssToken("--accent-soft", "rgba(159,232,112,.16)"), fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 }],
          },
          options: {
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: false } },
            maintainAspectRatio: false,
          },
        });
      } catch (err) { console.warn(err); }
    }
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
