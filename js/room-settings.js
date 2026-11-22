(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, showError, hideError, errorMessage } = MB;

  function inviteUrl(code) {
    return (window.MB && MB.originUrl ? MB.originUrl("invite.html?code=" + encodeURIComponent(code)) : location.origin + location.pathname.replace(/[^/]+$/, "") + "invite.html?code=" + encodeURIComponent(code));
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Room settings", month: true });
    if (!ctx) return;
    if (!ctx.room || !ctx.isAdmin) {
      $("no-access").hidden = false;
      return;
    }
    const room = ctx.room;
    const members = await MB.loadMembers(room.id);
    $("settings-form").hidden = false;
    $("code-card").hidden = false;
    $("recurring-card").hidden = false;
    $("export-card").hidden = false;
    $("cat-budget-card").hidden = false;
    await setupCategoryBudgets(room);

    $("set-name").value = room.name || "";
    $("set-desc").value = room.description || "";
    $("set-currency").innerHTML = MB.CURRENCIES.map((c) => `<option value="${c.code}">${c.code}</option>`).join("");
    $("set-currency").value = room.currency || "INR";
    $("set-budget").value = room.monthly_budget_limit != null ? String(room.monthly_budget_limit) : "";
    $("set-split").value = room.default_split_method || "equal_all";
    $("set-cats").value = MB.roomCategories(room).join("\n");
    $("set-members-add").checked = room.members_can_add_expenses !== false;
    $("set-approve").checked = room.require_join_approval !== false;
    if ($("set-type")) {
      $("set-type").value = room.type || "home";
      $("set-start").value = room.start_date || "";
      $("set-end").value = room.end_date || "";
      const syncTrip = () => { $("set-trip-dates").hidden = $("set-type").value !== "trip"; };
      $("set-type").addEventListener("change", syncTrip);
      syncTrip();
    }
    $("set-code").textContent = room.code;
    const owner = members.find((m) => m.role === "owner");
    const inviter = (owner && owner.display_name) || (ctx.profile && ctx.profile.display_name) || "a roommate";
    function syncShareLinks(code) {
      const r = { name: room.name, code: code };
      $("share-wa").href = MB.whatsappShareHref(r, inviter);
    }
    syncShareLinks(room.code);
    const native = $("share-native");
    if (native && navigator.share) {
      native.hidden = false;
      native.addEventListener("click", () => MB.shareInvite({ name: room.name, code: room.code }, inviter));
    }
    $("copy-msg").addEventListener("click", async () => {
      const ok = await MB.copyInviteMessage({ name: room.name, code: room.code }, inviter);
      $("copy-msg").textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { $("copy-msg").textContent = "Copy message"; }, 1800);
      if (!ok) MB.showPageError(MB.inviteShareText({ name: room.name, code: room.code }, inviter));
    });

    $("settings-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("set-error");
      $("set-ok").hidden = true;
      const cats = $("set-cats").value.split(/\n+/).map((s) => s.trim()).filter(Boolean);
      const budgetRaw = $("set-budget").value.trim();
      const { data, error } = await MB.client().rpc("update_room_settings", {
        p_room_id: room.id,
        p_settings: {
          name: $("set-name").value.trim(),
          description: $("set-desc").value,
          currency: $("set-currency").value,
          monthly_budget_limit: budgetRaw === "" ? null : Number(budgetRaw),
          default_split_method: $("set-split").value,
          categories: cats,
          members_can_add_expenses: $("set-members-add").checked,
          require_join_approval: $("set-approve").checked,
        },
      });
      if (error) return showError("set-error", errorMessage(error));
      $("set-ok").hidden = false;
      $("set-ok").textContent = "Settings saved.";
      if (data && data.name) document.getElementById("room-name").textContent = data.name;
    });

    if ($("archive-room")) {
      const archived = !!room.archived_at;
      $("archive-room").textContent = archived ? "Unarchive room" : "Archive room";
      $("archive-room").addEventListener("click", async () => {
        const next = !room.archived_at;
        if (next && !confirm("Archive this room? It stays available under archived rooms and keeps its balances.")) return;
        const { error } = await MB.client().rpc("archive_room", { p_room_id: room.id, p_archived: next });
        if (error) return MB.showPageError(errorMessage(error));
        location.href = "dashboard.html";
      });
    }
    $("copy-code").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(room.code); $("copy-code").textContent = "Copied"; setTimeout(() => { $("copy-code").textContent = "Copy"; }, 1500); }
      catch (e) { MB.showPageError(room.code); }
    });
    $("reset-code").addEventListener("click", async () => {
      if (!confirm("Reset the invite code? The old code will stop working.")) return;
      const { data, error } = await MB.client().rpc("reset_room_code", { p_room_id: room.id });
      if (error) return MB.showPageError(errorMessage(error));
      room.code = data;
      $("set-code").textContent = data;
      syncShareLinks(data);
    });

    const cats = MB.roomCategories(room);
    $("rec-category").innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    $("rec-paid-by").innerHTML = members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}${m.id === ctx.uid ? " (you)" : ""}</option>`).join("");

    async function loadRecurring() {
      const { data, error } = await MB.client().from("room_recurring").select("*").eq("room_id", room.id).order("created_at");
      if (error) { $("recurring-list").innerHTML = `<p class="empty">${escapeHtml(errorMessage(error))}</p>`; return; }
      const rows = data || [];
      $("recurring-list").innerHTML = rows.length ? rows.map((r) => {
        const payer = MB.displayName(r.paid_by, members);
        return `<div class="list-item">
          <div><div class="item-title">${escapeHtml(r.description)}</div>
          <div class="item-sub">${escapeHtml(r.category)} · ${escapeHtml(formatMoney(r.amount))} · paid by ${escapeHtml(payer)} · day ${r.day_of_month}${r.active ? "" : " · paused"}</div></div>
          <button type="button" class="text-btn" data-del-rec="${escapeHtml(r.id)}">Remove</button>
        </div>`;
      }).join("") : `<p class="empty">No recurring expenses yet.</p>`;
      $("recurring-list").querySelectorAll("[data-del-rec]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Remove this recurring expense?")) return;
          const { error } = await MB.client().rpc("delete_recurring", { p_id: btn.getAttribute("data-del-rec") });
          if (error) return MB.showPageError(errorMessage(error));
          loadRecurring();
        });
      });
    }
    await loadRecurring();

    $("recurring-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const { error } = await MB.client().rpc("upsert_recurring", {
        p_room_id: room.id,
        p_id: null,
        p_description: $("rec-desc").value.trim(),
        p_amount: Number($("rec-amount").value),
        p_category: $("rec-category").value,
        p_paid_by: $("rec-paid-by").value,
        p_split_user_ids: null,
        p_day_of_month: Number($("rec-day").value) || 1,
        p_active: true,
      });
      if (error) return MB.showPageError(errorMessage(error));
      $("rec-desc").value = "";
      $("rec-amount").value = "";
      loadRecurring();
    });

    $("export-csv").addEventListener("click", async () => {
      const { expenses, splits, settlements } = await MB.loadMonthData(room.id, ctx.month);
      const lines = ["type,date,description,category,person,amount,status"];
      expenses.forEach((e) => {
        lines.push(["expense", e.date, e.description, e.category, MB.displayName(e.paid_by, members), e.amount, "paid"].map(csvEscape).join(","));
        splits.filter((s) => s.expense_id === e.id).forEach((s) => {
          lines.push(["share", e.date, e.description, e.category, MB.displayName(s.user_id, members), s.share_amount, s.status].map(csvEscape).join(","));
        });
      });
      settlements.forEach((s) => {
        lines.push(["settlement", s.date, s.note || "Settlement", "", `${MB.displayName(s.from_user, members)} -> ${MB.displayName(s.to_user, members)}`, s.amount, s.status].map(csvEscape).join(","));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `monthly-budget-${room.name.replace(/\s+/g, "-")}-${ctx.month}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
