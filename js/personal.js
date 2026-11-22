(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, showError, hideError, errorMessage } = MB;
  const EXPENSE_CATS = MB.CATEGORIES.slice();

  function toneClass(pct) {
    if (pct >= 100) return "is-over";
    if (pct >= 80) return "is-warn";
    return "";
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Personal", month: true, keepMonth: true });
    if (!ctx) return;
    const nameEl = document.getElementById("room-name");
    if (nameEl) nameEl.textContent = "Personal";

    const { start, end } = MB.monthBounds(ctx.month);
    const rows = await MB.loadPersonalRange(start, end);
    const income = rows.filter((r) => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
    const spent = rows.filter((r) => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
    const byCat = {};
    rows.filter((r) => r.type === "expense").forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + Number(r.amount); });

    $("stat-income").textContent = formatMoney(income);
    $("stat-spent").textContent = formatMoney(spent);
    $("stat-left").textContent = formatMoney(income - spent);
    $("stat-net-card").className = "stat " + (income - spent >= 0 ? "is-good" : "is-bad");

    const { data: profile } = await MB.client().from("profiles").select("personal_budget_limit").eq("id", ctx.uid).maybeSingle();
    const limit = profile && profile.personal_budget_limit != null ? Number(profile.personal_budget_limit) : 0;
    $("per-limit").value = limit > 0 ? String(limit) : "";
    const { data: catLimits } = await MB.client().from("personal_category_budgets").select("category, limit_amount").eq("user_id", ctx.uid);
    const limits = catLimits || [];

    if (limit > 0) {
      const pct = Math.round((spent / limit) * 100);
      $("budget-label").textContent = formatMoney(spent) + " of " + formatMoney(limit) + " (" + pct + "%)";
      $("budget-bar").hidden = false;
      $("budget-fill").style.width = Math.min(100, pct) + "%";
      $("budget-fill").className = toneClass(pct);
      const banner = $("budget-banner");
      if (pct >= 100) {
        banner.hidden = false;
        banner.className = "budget-banner";
        banner.innerHTML = `<p><strong>Your personal budget is exceeded</strong>You've spent ${escapeHtml(formatMoney(spent))} of ${escapeHtml(formatMoney(limit))} this month.</p>`;
        MB.maybeBrowserNotify("Personal budget exceeded", "Spending is " + formatMoney(spent) + " of " + formatMoney(limit), "personal-over-" + ctx.month);
      } else if (pct >= 80) {
        banner.hidden = false;
        banner.className = "budget-banner is-warn";
        banner.innerHTML = `<p><strong>Your personal budget is at ${pct}%</strong>You've spent ${escapeHtml(formatMoney(spent))} of ${escapeHtml(formatMoney(limit))} this month.</p>`;
      }
    } else {
      $("budget-label").textContent = "No monthly limit set yet.";
    }

    $("cat-budget-list").innerHTML = limits.map((b) => {
      const s = byCat[b.category] || 0;
      const p = Math.round((s / Number(b.limit_amount)) * 100);
      return `<div class="cat-budget-row"><div class="item-sub"><span>${escapeHtml(b.category)}</span><span>${escapeHtml(formatMoney(s))} of ${escapeHtml(formatMoney(b.limit_amount))} (${p}%)</span></div><div class="budget-bar"><span class="${toneClass(p)}" style="width:${Math.min(100, p)}%"></span></div></div>`;
    }).join("");

    const host = $("per-cat-rows");
    function catRow(category, amount) {
      const wrap = document.createElement("div");
      wrap.className = "split-row";
      wrap.style.margin = "8px 0";
      wrap.innerHTML = `<select class="select" data-cat>${EXPENSE_CATS.map((c) => `<option value="${escapeHtml(c)}" ${c === category ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
        <input type="number" min="0.01" step="0.01" data-amt placeholder="Limit" value="${amount != null ? escapeHtml(String(amount)) : ""}" />`;
      return wrap;
    }
    host.innerHTML = "";
    limits.forEach((b) => host.appendChild(catRow(b.category, b.limit_amount)));
    $("add-cat-limit").addEventListener("click", () => host.appendChild(catRow(EXPENSE_CATS[0], "")));
    $("budget-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = $("per-limit").value.trim();
      const { error: pErr } = await MB.client().from("profiles").update({
        personal_budget_limit: raw === "" ? null : Number(raw),
      }).eq("id", ctx.uid);
      if (pErr) return MB.showPageError(errorMessage(pErr));
      const next = [...host.querySelectorAll(".split-row")].map((r) => ({
        category: r.querySelector("[data-cat]").value,
        limit_amount: Number(r.querySelector("[data-amt]").value),
      })).filter((b) => b.category && b.limit_amount > 0);
      const { error: dErr } = await MB.client().from("personal_category_budgets").delete().eq("user_id", ctx.uid);
      if (dErr) return MB.showPageError(errorMessage(dErr));
      if (next.length) {
        const { error: iErr } = await MB.client().from("personal_category_budgets").insert(next.map((b) => ({ user_id: ctx.uid, ...b })));
        if (iErr) return MB.showPageError(errorMessage(iErr));
      }
      await MB.client().rpc("evaluate_personal_budgets", { p_user_id: ctx.uid, p_month: ctx.month });
      $("budget-ok").hidden = false;
      $("budget-ok").textContent = "Personal budgets saved.";
      location.reload();
    });

    $("tx-list").innerHTML = rows.length ? rows.map((r) => `
      <a class="list-item" href="add-expense.html?mode=personal&id=${escapeHtml(r.id)}">
        <div class="item-icon">${escapeHtml((r.category || "?").slice(0, 1))}</div>
        <div>
          <div class="item-title">${escapeHtml(r.note || r.category)}</div>
          <div class="item-sub">${MB.categoryChip(r.category)} · ${escapeHtml(MB.friendlyDate(r.date))} · ${escapeHtml(r.type)}</div>
        </div>
        <div class="item-amt ${r.type === "income" ? "pos" : "neg"}">${r.type === "income" ? "+" : "−"}${escapeHtml(formatMoney(r.amount))}</div>
      </a>`).join("") : MB.emptyState({ emoji: "💸", title: "No personal entries yet", text: "Add a private expense or income — roommates will never see these.", href: "add-expense.html?mode=personal", cta: "Add a personal entry" });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
