(() => {
  const MB = window.MB;
  const { $, escapeHtml } = MB;

  function firstName(name) {
    return MB.firstName ? MB.firstName(name) : String(name || "Someone").trim().split(/\s+/)[0] || "Someone";
  }
  function money(amount) {
    return MB.formatMoney(amount);
  }
  function clockLabel(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    let h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return h + ":" + m + " " + ampm;
  }
  function timeLabel(iso) {
    if (!iso) return "";
    const key = dayKey(iso);
    const now = new Date();
    const today = MB.localDayKey ? MB.localDayKey(now) : "";
    if (key && today && key === today) return "Today " + clockLabel(iso);
    const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const yKey = MB.localDayKey ? MB.localDayKey(yest) : "";
    if (key && yKey && key === yKey) return "Yesterday " + clockLabel(iso);
    if (MB.friendlyDate && key) return MB.friendlyDate(key);
    return clockLabel(iso);
  }
  function dayKey(iso) {
    return MB.localDayKey ? MB.localDayKey(iso) : String(iso || "").slice(0, 10);
  }
  function dayHeading(iso) {
    return MB.friendlyDate(dayKey(iso));
  }
  function payloadOf(n) {
    const p = n && n.payload;
    if (p && typeof p === "object") return p;
    if (typeof p === "string") {
      try { return JSON.parse(p) || {}; } catch (e) { return {}; }
    }
    return {};
  }
  function parseAmount(text) {
    const m = String(text || "").match(/(\d[\d,]*(?:\.\d{1,2})?)/);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  }
  function parseExpenseName(n) {
    const payload = payloadOf(n);
    if (payload.description) return String(payload.description);
    const title = String(n.title || "");
    const body = String(n.body || "");
    let m = title.match(/New share to accept:\s*(.+)$/i);
    if (m) return m[1].trim();
    m = title.match(/added (.+?) ₹/i) || title.match(/added (.+?) \d/i);
    if (m) return m[1].trim().replace(/,$/, "");
    m = title.match(/accepted your (.+?) share/i) || body.match(/share of (.+?)\.?$/i);
    if (m) return m[1].trim();
    m = title.match(/updated (.+)$/i) || title.match(/declined a share of (.+)$/i);
    if (m) return m[1].trim();
    return "";
  }
  function memberById(members, id) {
    if (!id) return null;
    return (members || []).find((m) => m.id === id) || null;
  }
  function memberByName(members, name) {
    const raw = String(name || "").trim().toLowerCase();
    if (!raw) return null;
    const exact = (members || []).find((m) => String(m.display_name || "").trim().toLowerCase() === raw);
    if (exact) return exact;
    const first = raw.split(/\s+/)[0];
    return (members || []).find((m) => firstName(m.display_name).toLowerCase() === first) || null;
  }
  function inferActor(n, members, settlements) {
    const payload = payloadOf(n);
    const id = n.actor_id || payload.actor_id || payload.from || null;
    let person = memberById(members, id);
    if (person) return person;
    const body = String(n.body || "");
    const title = String(n.title || "");
    const m = body.match(/^([A-Z][A-Za-z.\-]*(?:\s+[A-Z][A-Za-z.\-]*)*)\s+(added|accepted|force-accepted|declined|says|confirmed|updated|approved|invited|removed)/)
      || title.match(/^([A-Z][A-Za-z.\-]*(?:\s+[A-Z][A-Za-z.\-]*)*)\s+(added|accepted|says|confirmed|declined|updated|asked)/);
    if (m) person = memberByName(members, m[1]);
    if (person) return person;
    const sett = matchSettlement(n, settlements);
    if (sett) {
      const sid = n.type === "settlement_recorded" ? sett.from_user
        : (n.type === "settlement_voided" ? (sett.voided_by || n.actor_id) : (sett.to_user || sett.confirmed_by));
      person = memberById(members, sid);
    }
    return person || { id: id || "", display_name: "Roommate" };
  }
  function matchSettlement(n, settlements) {
    const payload = payloadOf(n);
    const ref = n.ref_id || payload.settlement_id;
    if (ref) {
      const hit = (settlements || []).find((s) => s.id === ref);
      if (hit) return hit;
    }
    const amount = payload.amount != null ? Number(payload.amount) : (parseAmount(n.title) || parseAmount(n.body));
    const t = n.created_at ? new Date(n.created_at).getTime() : 0;
    const list = (settlements || []).filter((s) => {
      if (amount != null && Math.abs(Number(s.amount) - amount) > 0.02) return false;
      if (n.type === "settlement_recorded" && s.to_user && MB.uid && s.to_user !== MB.uid()) return false;
      if ((n.type === "settlement_confirmed" || n.type === "settlement_rejected" || n.type === "settlement_voided") && s.from_user && MB.uid && s.from_user !== MB.uid() && s.to_user !== MB.uid()) return false;
      if (!t || !s.created_at) return true;
      const st = new Date(s.created_at).getTime();
      const ct = s.confirmed_at ? new Date(s.confirmed_at).getTime() : st;
      const rt = s.rejected_at ? new Date(s.rejected_at).getTime() : st;
      return Math.min(Math.abs(st - t), Math.abs(ct - t), Math.abs(rt - t)) < 5 * 60 * 1000;
    });
    if (list.length === 1) return list[0];
    if (list.length > 1 && t) {
      list.sort((a, b) => Math.abs(new Date(a.created_at) - t) - Math.abs(new Date(b.created_at) - t));
    }
    return list[0] || null;
  }
  function matchExpense(n, expenses, splits) {
    const payload = payloadOf(n);
    const ref = n.ref_id || payload.expense_id;
    if (ref) {
      const hit = (expenses || []).find((e) => e.id === ref);
      if (hit) return hit;
    }
    const name = parseExpenseName(n);
    if (!name) return null;
    const want = name.toLowerCase();
    const t = n.created_at ? new Date(n.created_at).getTime() : 0;
    const list = (expenses || []).filter((e) => String(e.description || "").trim().toLowerCase() === want);
    if (t && list.length > 1) list.sort((a, b) => Math.abs(new Date(a.created_at) - t) - Math.abs(new Date(b.created_at) - t));
    return list[0] || null;
  }
  function myShare(expense, splits) {
    if (!expense) return null;
    const uid = MB.uid();
    const row = (splits || []).find((s) => s.expense_id === expense.id && s.user_id === uid);
    return row || null;
  }
  function typeKind(type) {
    if (/settlement|payment|budget/.test(type || "")) return "payment";
    if (/share|expense/.test(type || "")) return "expense";
    if (/join|invite|role|member|removed/.test(type || "")) return "member";
    return "alert";
  }
  function badgeSvg(kind) {
    if (kind === "payment") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16v12H4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M15 13.5h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    if (kind === "member") return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M5 19c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    if (kind === "alert") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 21 20H3L12 4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18H7z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
  }

  function copyFor(n, ctx) {
    const uid = ctx.uid;
    const members = ctx.members || [];
    const actor = inferActor(n, members, ctx.settlements);
    const actorName = firstName(actor.display_name || actor.name);
    const payload = payloadOf(n);
    const type = n.type || "";
    const sett = /settlement/.test(type) ? matchSettlement(n, ctx.settlements) : null;
    const expense = /share|expense/.test(type) ? matchExpense(n, ctx.expenses, ctx.splits) : null;
    const share = expense ? myShare(expense, ctx.splits) : null;
    const amount = (sett && sett.amount) != null ? Number(sett.amount)
      : (payload.amount != null ? Number(payload.amount) : (payload.share_amount != null ? Number(payload.share_amount) : (parseAmount(n.title) || parseAmount(n.body))));
    const expName = (expense && expense.description) || parseExpenseName(n) || "an expense";
    const shareAmt = share ? Number(share.share_amount) : (payload.share_amount != null ? Number(payload.share_amount) : amount);
    const fromName = sett ? firstName((memberById(members, sett.from_user) || {}).display_name || actorName) : actorName;

    let title = "";
    let sub = "";
    let actions = [];
    let href = n.link || "dashboard.html";
    let state = "";

    if (type === "settlement_recorded") {
      const status = sett ? sett.status : "pending";
      if (status === "voided") {
        title = "You confirmed " + money(amount) + " from " + fromName;
        sub = "This payment was later undone.";
        state = "voided";
      } else if (status === "confirmed") {
        title = "You confirmed " + money(amount) + " from " + fromName;
        sub = "It counts toward balances.";
        state = "confirmed";
      } else if (status === "rejected") {
        title = "You marked " + money(amount) + " from " + fromName + " as not received";
        sub = fromName + " can mark it paid again if it was sent.";
        state = "rejected";
      } else {
        title = fromName + " says the payment of " + money(amount) + " is sent";
        sub = "Tap Confirm once you've got it";
        if (sett && sett.id) {
          actions = [
            { label: "Confirm", kind: "primary", act: "confirm", id: sett.id },
            { label: "Didn't get it", kind: "ghost", act: "reject", id: sett.id },
          ];
        }
      }
      href = sett ? ("settle.html?sid=" + encodeURIComponent(sett.id)) : (n.link || "settle.html");
    } else if (type === "settlement_confirmed") {
      if (sett && sett.status === "voided") {
        title = actorName + " confirmed " + money(amount);
        sub = "This payment was later undone.";
        state = "voided";
      } else {
        title = actorName + " confirmed " + money(amount);
        sub = "It now counts toward balances.";
      }
      href = n.link || "settle.html";
    } else if (type === "settlement_rejected") {
      title = actorName + " says the payment of " + money(amount) + " was not received";
      sub = "You can mark it paid again if you still sent it.";
      href = n.link || "settle.html";
    } else if (type === "settlement_voided") {
      if (sett && sett.to_user === uid && sett.from_user === actor.id) {
        title = actorName + " undid the " + money(amount) + " payment to you";
      } else {
        title = actorName + " undid the " + money(amount) + " payment from " + fromName;
      }
      sub = "It no longer counts toward balances.";
      state = "voided";
      href = n.link || "settle.html";
    } else if (type === "share_request") {
      const total = expense ? Number(expense.amount) : (payload.amount != null ? Number(payload.amount) : null);
      const totalBit = total != null ? " " + money(total) : "";
      const shareBit = shareAmt != null ? ", your share " + money(shareAmt) : "";
      if (share && share.status === "accepted") {
        title = "You accepted " + expName + (shareAmt != null ? " " + money(shareAmt) : "");
        sub = actorName + " added this expense.";
        state = "accepted";
      } else if (share && share.status === "declined") {
        title = "You declined " + expName + (shareAmt != null ? " " + money(shareAmt) : "");
        sub = "The person who added it can edit the split.";
        state = "declined";
      } else {
        title = actorName + " added " + expName + totalBit + shareBit;
        sub = "Tap Accept if this looks right.";
        if (expense) actions = [{ label: "Accept", kind: "primary", act: "accept", id: expense.id }];
      }
      href = expense ? ("requests.html?eid=" + encodeURIComponent(expense.id)) : (n.link || "requests.html");
    } else if (type === "share_force_accepted") {
      if (actor.id && actor.id === uid) title = "You accepted your " + expName + " share";
      else title = actorName + " accepted your " + expName + " share for you";
      sub = shareAmt != null ? "Your share is " + money(shareAmt) + "." : "";
      href = n.link || "my-share.html";
    } else if (type === "share_declined") {
      title = actorName + " declined a share of " + expName;
      sub = "You can edit the split.";
      href = n.link || "expenses.html";
    } else if (type === "expense_edited") {
      title = actorName + " updated " + expName;
      sub = "An expense that includes you was changed.";
    } else if (type === "expense_deleted") {
      title = actorName + " deleted " + expName;
      sub = "An expense that included you was removed.";
    } else if (type === "join_request") {
      title = actorName + " asked to join";
      sub = "Approve or decline this in Members.";
      href = n.link || "members.html";
    } else if (type === "join_approved") {
      title = "You were added to " + (ctx.room && ctx.room.name ? ctx.room.name : "the room");
      sub = actorName && actorName !== "Roommate" ? actorName + " approved your request." : "Your request was approved.";
    } else if (type === "join_rejected") {
      title = "Your request to join was declined";
      sub = actorName && actorName !== "Roommate" ? actorName + " declined the request." : "";
    } else if (type === "invite_received") {
      title = actorName + " invited you to join";
      sub = n.body ? String(n.body) : "";
    } else {
      const rawTitle = MB.withoutAdminLabel ? MB.withoutAdminLabel(n.title || n.body || "Update") : (n.title || "Update");
      const rawBody = MB.withoutAdminLabel ? MB.withoutAdminLabel(n.body || "") : (n.body || "");
      title = String(rawTitle || "Update");
      sub = title === rawBody ? "" : String(rawBody || "");
    }
    return { title, sub, actions, href, state, actor, kind: typeKind(type) };
  }

  function groupByDay(rows) {
    const groups = [];
    (rows || []).forEach((row) => {
      const key = dayKey(row.created_at);
      const heading = dayHeading(row.created_at);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else groups.push({ key, heading, rows: [row] });
    });
    return groups;
  }

  function rowHtml(n, ctx) {
    const view = copyFor(n, ctx);
    const unread = !n.read_at;
    const actions = (view.actions || []).map((a) =>
      `<button type="button" class="${a.kind === "ghost" ? "secondary-btn" : "primary-btn"} notif-action" data-act="${escapeHtml(a.act)}" data-id="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`
    ).join("");
    const time = timeLabel(n.created_at);
    const timeHtml = time ? `<time class="notif-time" datetime="${escapeHtml(n.created_at || "")}">${escapeHtml(time)}</time>` : "";
    let subHtml = "";
    if (view.state) {
      subHtml = `<p class="notif-state">${escapeHtml(view.sub)}</p>` + (timeHtml ? `<div class="item-sub notif-when">${timeHtml}</div>` : "");
    } else if (view.sub && timeHtml) {
      subHtml = `<div class="item-sub">${escapeHtml(view.sub)} · ${timeHtml}</div>`;
    } else if (view.sub) {
      subHtml = `<div class="item-sub">${escapeHtml(view.sub)}</div>`;
    } else if (timeHtml) {
      subHtml = `<div class="item-sub notif-when">${timeHtml}</div>`;
    }
    return `<article class="list-item notif-item ${unread ? "is-unread" : ""} ${view.actions.length ? "has-actions" : ""}" data-id="${escapeHtml(n.id)}" data-href="${escapeHtml(view.href || "dashboard.html")}">
      <span class="activity-avatar notif-avatar">${MB.avatarHtml(view.actor, "md")}<span class="activity-badge is-${escapeHtml(view.kind)}" aria-hidden="true">${badgeSvg(view.kind)}</span>${unread ? `<span class="notif-dot" title="Unread" aria-label="Unread"></span>` : ""}</span>
      <div class="notif-copy">
        <div class="item-title">${escapeHtml(view.title)}</div>
        ${subHtml}
        ${actions ? `<div class="btn-row compact notif-actions">${actions}</div>` : ""}
      </div>
    </article>`;
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Notifications" });
    if (!ctx) return;
    let members = (ctx.members && ctx.members.length) ? ctx.members.slice() : [];
    if (ctx.room && !members.length) {
      try { members = await MB.loadMembers(ctx.room.id); } catch (e) { members = []; }
    }
    let expenses = ctx.expenses || [];
    let splits = ctx.splits || [];
    let settlements = ctx.settlements || [];
    if (ctx.room) {
      try {
        const [setRes, exRes] = await Promise.all([
          MB.client().from("settlements").select("id, room_id, from_user, to_user, amount, date, note, created_by, created_at, status, confirmed_at, confirmed_by, rejected_at, rejected_by, voided_at, voided_by, proof_path").eq("room_id", ctx.room.id).order("created_at", { ascending: false }).limit(120),
          MB.client().from("room_expenses").select("id, room_id, paid_by, created_by, amount, description, category, date, created_at").eq("room_id", ctx.room.id).order("created_at", { ascending: false }).limit(120),
        ]);
        if (!setRes.error && setRes.data) settlements = setRes.data;
        if (!exRes.error && exRes.data) expenses = exRes.data;
        if (expenses.length) {
          const { data: splitRows, error: splitErr } = await MB.client().from("expense_splits").select("expense_id, user_id, share_amount, status, responded_at, forced_by, forced_at").in("expense_id", expenses.map((e) => e.id));
          if (!splitErr && splitRows) splits = splitRows;
        }
      } catch (e) { /* use boot data */ }
    }

    try {
      const inv = await MB.client().rpc("list_my_invites");
      const invites = Array.isArray(inv.data) ? inv.data : (inv.data ? [inv.data] : []);
      const box = $("invite-list") || (() => {
        const el = document.createElement("div");
        el.id = "invite-list";
        $("notif-list").parentElement.insertBefore(el, $("notif-list"));
        return el;
      })();
      if (!inv.error && invites.length) {
        box.innerHTML = "<h2 class=\"day-heading\">Invites for you</h2>" + invites.map((i) => `
          <div class="pending-card">
            <div><div class="item-title">${escapeHtml(i.room_name)}</div><div class="item-sub">Invited to ${escapeHtml(i.email || "your email")}</div></div>
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
            location.href = accept ? "dashboard.html" : "notifications.html";
          });
        });
      } else if (box) box.innerHTML = "";
    } catch (e) { console.warn(e); }

    const { data, error } = await MB.client().from("notifications").select("*").eq("user_id", ctx.uid).order("created_at", { ascending: false }).limit(80);
    if (error) { $("notif-list").innerHTML = `<p class="empty">${escapeHtml(MB.errorMessage(error))}</p>`; return; }
    let rows = data || [];
    const viewCtx = { uid: ctx.uid, room: ctx.room, members, expenses, splits, settlements };

    function paint() {
      if (!rows.length) {
        $("notif-list").innerHTML = MB.emptyState({ art: "images/illu-people.webp", title: "Nothing in your inbox", text: "You'll see join requests, share requests, and payment updates here." });
        return;
      }
      const groups = groupByDay(rows);
      $("notif-list").innerHTML = groups.map((g) => `
        <section class="activity-day notif-day">
          <h3 class="day-heading">${escapeHtml(g.heading)}</h3>
          <div class="list notif-feed">${g.rows.map((n) => rowHtml(n, viewCtx)).join("")}</div>
        </section>`).join("");
      bind();
    }

    function bind() {
      $("notif-list").querySelectorAll(".notif-item").forEach((el) => {
        el.addEventListener("click", async (e) => {
          if (e.target.closest(".notif-action")) return;
          const id = el.getAttribute("data-id");
          const href = el.getAttribute("data-href") || "dashboard.html";
          try { await MB.client().rpc("mark_notifications_read", { p_ids: [id] }); } catch (err) { /* still navigate */ }
          location.href = href;
        });
      });
      $("notif-list").querySelectorAll(".notif-action").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const act = btn.getAttribute("data-act");
          const id = btn.getAttribute("data-id");
          btn.disabled = true;
          try {
            if (act === "confirm") {
              const { error: err } = await MB.client().rpc("confirm_settlement", { p_settlement_id: id, p_force: false });
              if (err) throw err;
              const s = settlements.find((x) => x.id === id);
              if (s) { s.status = "confirmed"; s.confirmed_at = new Date().toISOString(); s.confirmed_by = ctx.uid; }
            } else if (act === "reject") {
              const { error: err } = await MB.client().rpc("reject_settlement", { p_settlement_id: id });
              if (err) throw err;
              const s = settlements.find((x) => x.id === id);
              if (s) { s.status = "rejected"; s.rejected_at = new Date().toISOString(); s.rejected_by = ctx.uid; }
            } else if (act === "accept") {
              const res = await MB.respondToShare(id, true);
              if (res && res.error) throw res.error;
              splits = (splits || []).map((s) => s.expense_id === id && s.user_id === ctx.uid ? Object.assign({}, s, { status: "accepted" }) : s);
            }
            const noteId = btn.closest(".notif-item") && btn.closest(".notif-item").getAttribute("data-id");
            if (noteId) {
              try { await MB.client().rpc("mark_notifications_read", { p_ids: [noteId] }); } catch (err) { /* ignore */ }
              const note = rows.find((r) => r.id === noteId);
              if (note) note.read_at = new Date().toISOString();
            }
            paint();
          } catch (err) {
            btn.disabled = false;
            MB.showPageError(MB.errorMessage(err));
          }
        });
      });
    }

    paint();
    $("mark-all").addEventListener("click", async () => {
      const { error: err } = await MB.client().rpc("mark_notifications_read", { p_ids: null });
      if (err) return MB.showPageError(MB.errorMessage(err));
      rows.forEach((r) => { r.read_at = r.read_at || new Date().toISOString(); });
      paint();
    });
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
