(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney } = MB;

  function activityDetailHref(type, id) {
    if (!type || !id) return "activity.html";
    const hash = "#/activity/" + encodeURIComponent(type) + "/" + encodeURIComponent(id);
    const path = String(location.pathname || "");
    if (/activity\.html$/i.test(path) || /\/activity\/?$/i.test(path)) return hash;
    return "activity.html" + hash;
  }

  function activityFilterHref(opts) {
    const o = opts || {};
    const q = new URLSearchParams();
    if (o.kind && o.kind !== "all") q.set("kind", o.kind);
    if (o.person) q.set("person", o.person);
    if (o.room) q.set("room", o.room);
    const s = q.toString();
    return "activity.html" + (s ? "?" + s : "");
  }

  function parseActivityHash(raw) {
    const h = String(raw != null ? raw : (location.hash || "")).replace(/^#/, "");
    const m = h.match(/^\/?activity\/(settlement|expense|personal|event)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return m ? { type: m[1].toLowerCase(), id: m[2].toLowerCase() } : null;
  }

  function nameOf(id, members, fallback) {
    if (!id) return fallback || "Someone";
    if (id === MB.uid()) return "You";
    const list = members || [];
    const m = list.find((p) => p && p.id === id);
    return (m && (m.display_name || m.name)) || fallback || "Someone";
  }

  function personOf(id, members) {
    const list = members || [];
    return list.find((p) => p && p.id === id) || { id: id || "", display_name: "Someone" };
  }

  function timeOf(iso) {
    return (MB.formatEventTime || MB.relativeTime || function () { return ""; })(iso);
  }

  function settlementStatus(s) {
    const st = String((s && s.status) || "").toLowerCase();
    if (st === "voided" || st === "void" || (s && s.voided_at)) return { key: "undone", label: "Undone" };
    if (st === "rejected" || st === "declined" || (s && s.rejected_at && !s.confirmed_at)) return { key: "declined", label: "Declined" };
    if (st === "confirmed" || st === "received" || st === "completed" || (s && s.confirmed_at)) return { key: "confirmed", label: "Confirmed" };
    return { key: "pending", label: "Waiting for confirmation" };
  }

  function shareStatus(split, expense) {
    if (!split) return { key: "waiting", label: "Waiting" };
    if (expense && split.user_id === expense.paid_by) return { key: "paid", label: "Paid" };
    const st = String(split.status || "").toLowerCase();
    if (st === "accepted" || split.forced_at || split.forced_by) return { key: "accepted", label: "Accepted" };
    if (st === "declined" || st === "rejected") return { key: "declined", label: "Declined" };
    return { key: "waiting", label: "Waiting" };
  }

  function splitTypeLabel(expense, splits, items) {
    if (items && items.length) return "Itemized";
    const amounts = (splits || []).map((s) => Math.round(Number(s.share_amount || 0) * 100));
    if (amounts.length < 2) return "Custom split";
    const min = Math.min.apply(null, amounts);
    const max = Math.max.apply(null, amounts);
    if (max - min <= 1) return "Split equally";
    return "Custom split";
  }

  function statusChip(key, label) {
    return `<span class="status-pill is-${escapeHtml(key)}">${escapeHtml(label)}</span>`;
  }

  function kvRow(label, value) {
    if (!value) return "";
    return `<div class="detail-kv"><span class="k">${escapeHtml(label)}</span><span class="v">${value}</span></div>`;
  }

  function historyItem(row, members) {
    const actor = row.actor_name || nameOf(row.actor_id, members, "Someone");
    const you = row.actor_id && row.actor_id === MB.uid();
    const who = you ? "You" : actor;
    const d = row.detail && typeof row.detail === "object" ? row.detail : {};
    let text = who + " " + String(row.action || "updated this").replace(/_/g, " ");
    switch (row.action) {
      case "settlement_recorded":
        text = "Recorded by " + who;
        break;
      case "settlement_confirmed":
        text = "Confirmed by " + who;
        break;
      case "settlement_rejected":
        text = "Didn't get it · " + who;
        break;
      case "settlement_voided":
        text = "Undone by " + who;
        break;
      case "expense_added":
        text = "Added by " + who;
        break;
      case "expense_edited":
        text = "Edited by " + who;
        break;
      case "expense_deleted":
        text = "Deleted by " + who;
        break;
      case "share_accepted":
      case "share_forced": {
        const subject = d.user_id;
        if (subject && subject !== row.actor_id) {
          text = who + " accepted " + (subject === MB.uid() ? "your share" : (nameOf(subject, members, "a roommate") + "'s share"));
        } else {
          text = you ? "You accepted your share" : (who + " accepted their share");
        }
        break;
      }
      case "share_declined":
        text = you ? "You declined your share" : (who + " declined their share");
        break;
      case "member_joined":
        text = who + " joined the room";
        break;
      case "member_left":
        text = who + " left the room";
        break;
      case "member_removed":
        text = who + " removed " + nameOf(row.target_id, members, "a roommate");
        break;
      case "room_created":
        text = who + " created the room";
        break;
      case "personal_added":
        text = "Added by you";
        break;
      case "personal_edited":
        text = "Edited by you";
        break;
      case "personal_deleted":
        text = "Deleted by you";
        break;
      default:
        break;
    }
    const cls = /voided|rejected|deleted|declined/.test(row.action || "") ? "is-declined" : "is-done";
    return `<li class="${cls}">
      <span class="tl-icon" aria-hidden="true"></span>
      <div class="tl-body">
        <div class="tl-title">${escapeHtml(text)}</div>
        <div class="tl-time">${escapeHtml(timeOf(row.created_at))}</div>
      </div>
    </li>`;
  }

  function historyBlock(rows, members, title) {
    if (!rows || !rows.length) return "";
    return `<section class="detail-history">
      <h3>${escapeHtml(title || "History")}</h3>
      <ol class="timeline">${rows.map((r) => historyItem(r, members)).join("")}</ol>
    </section>`;
  }

  function mergeSettlementHistory(sett, rows, members) {
    const out = [];
    const seen = new Set();
    function add(action, at, actorId, actorName, detail) {
      if (!at) return;
      const key = action + ":" + String(at).slice(0, 16);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ action, created_at: at, actor_id: actorId, actor_name: actorName || nameOf(actorId, members), detail: detail || {} });
    }
    (rows || []).forEach((r) => add(r.action, r.created_at, r.actor_id, r.actor_name, r.detail));
    add("settlement_recorded", sett.created_at, sett.created_by, nameOf(sett.created_by, members));
    if (sett.confirmed_at) add("settlement_confirmed", sett.confirmed_at, sett.confirmed_by, nameOf(sett.confirmed_by, members));
    if (sett.rejected_at) add("settlement_rejected", sett.rejected_at, sett.rejected_by, nameOf(sett.rejected_by, members));
    if (sett.voided_at) add("settlement_voided", sett.voided_at, sett.voided_by, nameOf(sett.voided_by, members));
    out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return out;
  }

  function mergeExpenseHistory(expense, splits, rows, members) {
    const out = [];
    const seen = new Set();
    function add(action, at, actorId, actorName, detail) {
      if (!at) return;
      const key = action + ":" + String(actorId || "") + ":" + String(at).slice(0, 16);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ action, created_at: at, actor_id: actorId, actor_name: actorName || nameOf(actorId, members), detail: detail || {} });
    }
    (rows || []).forEach((r) => add(r.action, r.created_at, r.actor_id, r.actor_name, r.detail));
    if (expense && expense.created_at) add("expense_added", expense.created_at, expense.created_by || expense.paid_by, nameOf(expense.created_by || expense.paid_by, members));
    (splits || []).forEach((s) => {
      if (!s.responded_at) return;
      const act = (s.status === "declined" || s.status === "rejected") ? "share_declined" : (s.forced_at || s.forced_by ? "share_forced" : "share_accepted");
      add(act, s.responded_at, s.forced_by || s.user_id, nameOf(s.forced_by || s.user_id, members), { user_id: s.user_id });
    });
    out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return out;
  }

  function actionsRow(html) {
    return html ? `<div class="detail-actions btn-row">${html}</div>` : "";
  }

  function renderSettlement(data) {
    const s = data.settlement || {};
    const members = data.members || [];
    const st = settlementStatus(s);
    const from = personOf(s.from_user, members);
    const to = personOf(s.to_user, members);
    const room = data.room || {};
    const uid = MB.uid();
    const note = s.note ? escapeHtml(s.note) : "";
    const recorded = s.created_at || s.date;
    const method = note && /upi/i.test(s.note) ? "UPI" : note;
    const proof = s.proof_path && MB.proofThumbHtml ? MB.proofThumbHtml(s._proofUrl || "", s.proof_path) : "";
    let actions = "";
    if (st.key === "pending" && s.to_user === uid) {
      actions = `<button type="button" class="primary-btn" data-detail-act="confirm">Confirm received</button>
        <button type="button" class="secondary-btn" data-detail-act="reject">Didn't get it</button>`;
    }
    const roomOrAdmin = { role: data.viewer_role };
    if (st.key === "confirmed" && MB.canUndoSettlement && MB.canUndoSettlement(s, uid, data.is_manager || roomOrAdmin)) {
      actions += `<button type="button" class="text-btn is-danger" data-detail-act="undo">Undo payment</button>`;
    }
    const hist = mergeSettlementHistory(s, data.history || [], members);
    $("detail-heading").textContent = "Payment";
    return `
      <div class="detail-hero">
        <p class="detail-amount">${escapeHtml(formatMoney(s.amount))}</p>
        ${statusChip(st.key, st.label)}
      </div>
      <div class="detail-parties">
        <div class="detail-party">${MB.avatarHtml(from, "md")}<span>${escapeHtml(nameOf(s.from_user, members))}</span></div>
        <span class="detail-arrow" aria-hidden="true">→</span>
        <div class="detail-party">${MB.avatarHtml(to, "md")}<span>${escapeHtml(nameOf(s.to_user, members))}</span></div>
      </div>
      <div class="detail-meta">
        ${kvRow("Room", escapeHtml(room.name || ""))}
        ${kvRow("Note", method)}
        ${kvRow("Recorded", escapeHtml(timeOf(recorded)))}
        ${s.date ? kvRow("Date", escapeHtml(MB.friendlyDate(s.date))) : ""}
      </div>
      ${proof}
      ${historyBlock(hist, members)}
      ${actionsRow(actions)}`;
  }

  function renderExpense(data) {
    const e = data.expense || {};
    const members = data.members || [];
    const splits = data.splits || [];
    const items = data.items || [];
    const room = data.room || {};
    const uid = MB.uid();
    const deleted = !!data.deleted;
    const payer = personOf(e.paid_by, members);
    const cat = e.category ? escapeHtml(e.category) : "";
    const title = e.description || e.title || "Expense";
    const mine = splits.find((s) => s.user_id === uid);
    const myStatus = shareStatus(mine, e);
    const canManage = !!(data.is_manager || (e.created_by && e.created_by === uid));
    let actions = "";
    if (!deleted && mine && myStatus.key === "waiting") {
      actions += `<button type="button" class="primary-btn" data-detail-act="accept">Accept</button>
        <button type="button" class="danger-btn ghost" data-detail-act="decline">Decline</button>`;
    }
    if (!deleted && canManage) {
      actions += `<a class="secondary-btn" href="add-expense.html?id=${encodeURIComponent(e.id)}">Edit</a>
        <button type="button" class="text-btn is-danger" data-detail-act="delete">Delete</button>`;
    }
    const shareRows = splits.map((s) => {
      const st = shareStatus(s, e);
      const person = personOf(s.user_id, members);
      return `<div class="detail-share-row">
        ${MB.avatarHtml(person, "sm")}
        <div class="expense-copy">
          <div class="item-title">${escapeHtml(nameOf(s.user_id, members))}</div>
          <div class="item-sub">${statusChip(st.key, st.label)}</div>
        </div>
        <div class="item-amt">${escapeHtml(formatMoney(s.share_amount))}</div>
      </div>`;
    }).join("");
    const itemRows = items.length ? `<div class="detail-items">
      ${items.map((it) => {
        const names = (it.member_ids || []).map((id) => nameOf(id, members)).join(", ");
        return `<div class="detail-kv"><span class="k">${escapeHtml(it.description || "Item")}${names ? `<span class="muted"> · ${escapeHtml(names)}</span>` : ""}</span><span class="v">${escapeHtml(formatMoney(it.amount))}</span></div>`;
      }).join("")}
      ${Number(e.tax_amount) > 0 ? kvRow("Tax", escapeHtml(formatMoney(e.tax_amount))) : ""}
      ${Number(e.tip_amount) > 0 ? kvRow("Tip", escapeHtml(formatMoney(e.tip_amount))) : ""}
    </div>` : "";
    const hist = mergeExpenseHistory(e, splits, data.history || [], members);
    $("detail-heading").textContent = deleted ? "Deleted expense" : "Expense";
    return `
      <div class="detail-hero">
        <h2 class="detail-title">${escapeHtml(title)}</h2>
        <p class="detail-amount">${escapeHtml(formatMoney(e.amount))}</p>
        ${deleted ? statusChip("undone", "Deleted") : ""}
      </div>
      <div class="detail-meta">
        ${kvRow("Category", cat)}
        ${kvRow("Paid by", MB.avatarHtml(payer, "sm") + " " + escapeHtml(nameOf(e.paid_by, members)))}
        ${kvRow("Date", escapeHtml(MB.friendlyDate(e.date)))}
        ${kvRow("Split", escapeHtml(splitTypeLabel(e, splits, items)))}
        ${kvRow("Room", escapeHtml(room.name || ""))}
      </div>
      ${itemRows}
      ${shareRows ? `<section class="detail-shares"><h3>Shares</h3>${shareRows}</section>` : ""}
      ${historyBlock(hist, members)}
      ${actionsRow(actions)}`;
  }

  function renderPersonal(data) {
    const t = data.transaction || {};
    const hist = data.history || [];
    const title = t.note || t.category || "Personal entry";
    const income = t.type === "income";
    $("detail-heading").textContent = income ? "Income" : "Personal expense";
    const actions = t.id ? `<a class="secondary-btn" href="add-expense.html?mode=personal&id=${encodeURIComponent(t.id)}">Edit</a>` : "";
    return `
      <div class="detail-hero">
        <h2 class="detail-title">${escapeHtml(title)}</h2>
        <p class="detail-amount ${income ? "pos" : ""}">${income ? "+" : "−"}${escapeHtml(formatMoney(t.amount))}</p>
      </div>
      <div class="detail-meta">
        ${kvRow("Category", escapeHtml(t.category || ""))}
        ${kvRow("Date", escapeHtml(MB.friendlyDate(t.date)))}
      </div>
      ${historyBlock(hist, [])}
      ${actionsRow(actions)}`;
  }

  function renderEvent(data) {
    const ev = data.event || {};
    const members = data.members || [];
    const hist = (data.history && data.history.length) ? data.history : [ev];
    const room = data.room || {};
    $("detail-heading").textContent = "Activity";
    return `
      <div class="detail-hero">
        <h2 class="detail-title">${escapeHtml(room.name || "Update")}</h2>
      </div>
      <div class="detail-meta">
        ${kvRow("Room", escapeHtml(room.name || ""))}
        ${kvRow("When", escapeHtml(timeOf(ev.created_at)))}
      </div>
      ${historyBlock(hist, members, "What happened")}`;
  }

  function renderDetail(data) {
    const body = $("detail-body");
    if (!body) return;
    let html = "";
    if (data && data.type === "settlement") html = renderSettlement(data);
    else if (data && data.type === "expense") html = renderExpense(data);
    else if (data && data.type === "personal") html = renderPersonal(data);
    else html = renderEvent(data || {});
    body.innerHTML = html;
    if (MB.bindProofLightbox) MB.bindProofLightbox(body);
    bindDetailActions(data);
  }

  function bindDetailActions(data) {
    const body = $("detail-body");
    if (!body) return;
    body.querySelectorAll("[data-detail-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.getAttribute("data-detail-act");
        btn.disabled = true;
        try {
          if (act === "confirm" || act === "reject") {
            const id = data.settlement && data.settlement.id;
            const { error } = await MB.client().rpc(act === "confirm" ? "confirm_settlement" : "reject_settlement",
              act === "confirm" ? { p_settlement_id: id, p_force: false } : { p_settlement_id: id });
            if (error) throw error;
            if (MB.showToast) MB.showToast(act === "confirm" ? "Payment confirmed" : "Marked as not received", "ok");
            await showActivityDetail("settlement", id);
          } else if (act === "undo") {
            const ok = await MB.promptUndoSettlement(data.settlement, data.members || []);
            if (ok) await showActivityDetail("settlement", data.settlement.id);
            else btn.disabled = false;
          } else if (act === "accept" || act === "decline") {
            await MB.respondToShare(data.expense.id, act === "accept");
            if (MB.showToast) MB.showToast(act === "accept" ? "Share accepted" : "Share declined", "ok");
            await showActivityDetail("expense", data.expense.id);
          } else if (act === "delete") {
            const ok = await (MB.confirmAction ? MB.confirmAction({
              title: "Delete this expense?",
              message: "This removes the bill and its shares from the room.",
              confirmLabel: "Delete expense",
              cancelLabel: "Keep it",
              danger: true,
            }) : Promise.resolve(confirm("Delete this expense?")));
            if (!ok) { btn.disabled = false; return; }
            const { error } = await MB.client().rpc("delete_expense", { p_expense_id: data.expense.id });
            if (error) throw error;
            if (MB.showToast) MB.showToast("Expense deleted", "ok");
            closeDetail();
          }
        } catch (err) {
          btn.disabled = false;
          if (MB.showToast) MB.showToast(MB.errorMessage(err), "error");
          else if (MB.showPageError) MB.showPageError(MB.errorMessage(err));
        }
      });
    });
  }

  async function showActivityDetail(type, id) {
    const home = $("activity-home");
    const panel = $("activity-detail");
    if (home) home.hidden = true;
    if (panel) panel.hidden = false;
    document.body.classList.add("is-activity-detail");
    const heading = $("detail-heading");
    if (heading) heading.textContent = "Details";
    const body = $("detail-body");
    if (body) body.innerHTML = `<p class="card-sub">Loading…</p>`;
    window.scrollTo(0, 0);
    try {
      const { data, error } = await MB.client().rpc("get_activity_detail", { p_type: type, p_id: id });
      if (error) throw error;
      const payload = data && data.type ? data : (data && data[0]) || data;
      if (payload && payload.type === "settlement" && payload.settlement && payload.settlement.proof_path && MB.signedReceiptUrl) {
        try { payload.settlement._proofUrl = await MB.signedReceiptUrl(payload.settlement.proof_path); } catch (e) {}
      }
      renderDetail(payload);
    } catch (err) {
      if (body) body.innerHTML = `<p class="empty">${escapeHtml(MB.errorMessage(err))}</p>`;
    }
  }

  function hideActivityDetail() {
    const home = $("activity-home");
    const panel = $("activity-detail");
    if (home) home.hidden = false;
    if (panel) panel.hidden = true;
    document.body.classList.remove("is-activity-detail");
    const body = $("detail-body");
    if (body) body.innerHTML = "";
  }

  function closeDetail() {
    const parsed = parseActivityHash();
    if (parsed && window.history.length > 1) {
      history.back();
      setTimeout(() => {
        if (parseActivityHash()) {
          history.replaceState(null, "", location.pathname + location.search);
          hideActivityDetail();
        }
      }, 50);
      return;
    }
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    hideActivityDetail();
  }

  function routeActivityDetail() {
    const parsed = parseActivityHash();
    if (parsed) showActivityDetail(parsed.type, parsed.id);
    else hideActivityDetail();
  }

  function bindActivityDetail() {
    if (bindActivityDetail._bound) return;
    bindActivityDetail._bound = true;
    window.addEventListener("hashchange", routeActivityDetail);
    const back = $("detail-back");
    if (back) {
      back.innerHTML = (MB.ICONS && MB.ICONS.back) ? MB.ICONS.back : "←";
      back.addEventListener("click", (ev) => { ev.preventDefault(); closeDetail(); });
    }
  }

  MB.activityDetailHref = activityDetailHref;
  MB.activityFilterHref = activityFilterHref;
  MB.parseActivityHash = parseActivityHash;
  MB.showActivityDetail = showActivityDetail;
  MB.hideActivityDetail = hideActivityDetail;
  MB.routeActivityDetail = routeActivityDetail;
  MB.bindActivityDetail = bindActivityDetail;
})();
