(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney } = MB;

  const KINDS = [
    { id: "all", label: "All" },
    { id: "expenses", label: "Expenses" },
    { id: "payments", label: "Payments" },
    { id: "members", label: "Members" },
    { id: "alerts", label: "Alerts" },
    { id: "mine", label: "Mine" },
  ];

  let rooms = [];
  let people = new Map();
  let scope = "all";
  let kind = "all";
  let cursor = null;
  let cursorId = null;
  let hasMore = false;
  let loading = false;
  let items = [];

  function rememberPeople(list) {
    (list || []).forEach((p) => {
      if (!p) return;
      const id = p.id || p.user_id;
      if (!id) return;
      const prev = people.get(id) || {};
      people.set(id, {
        id,
        display_name: p.display_name || p.name || p.actor_name || prev.display_name,
        avatar_url: p.avatar_url || p.actor_avatar || prev.avatar_url,
      });
    });
  }

  function nameOf(userId, fallback) {
    if (!userId) return fallback || "Someone";
    if (userId === MB.uid()) return "You";
    const p = people.get(userId);
    return (p && p.display_name) || fallback || "Someone";
  }

  function actorName(row) {
    if (row.actor_id && row.actor_id === MB.uid()) return "You";
    return row.actor_name || nameOf(row.actor_id, "Someone");
  }

  function actorChip(row) {
    return MB.personChip({
      id: row.actor_id,
      display_name: actorName(row),
      avatar_url: row.actor_avatar,
    }, null, "sm");
  }

  function relativeTime(iso) {
    if (!iso) return "";
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const sec = Math.round((Date.now() - then) / 1000);
    if (sec < 45) return "Just now";
    if (sec < 90) return "1 min ago";
    if (sec < 3600) return Math.floor(sec / 60) + " min ago";
    if (sec < 5400) return "1 hour ago";
    if (sec < 86400) return Math.floor(sec / 3600) + " hours ago";
    const time = new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return time;
  }

  function dayHeading(iso) {
    const d = iso ? new Date(iso) : null;
    if (d && Number.isFinite(d.getTime())) {
      const local = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      return MB.friendlyDate(local);
    }
    return MB.friendlyDate(String(iso || "").slice(0, 10));
  }

  function detail(row) {
    return row.detail && typeof row.detail === "object" ? row.detail : {};
  }

  function expenseName(d) {
    return (d && (d.description || d.title || d.name)) || "";
  }

  function shareOf(row) {
    if (row.my_share != null && row.my_share !== "") return Number(row.my_share);
    const d = detail(row);
    if (d.share_amount != null) return Number(d.share_amount);
    const uid = MB.uid();
    if (d.shares && uid && d.shares[uid] != null) return Number(d.shares[uid]);
    return null;
  }

  function typeOf(row) {
    const a = row.action || "";
    if (/settlement|payment/.test(a)) return "payment";
    if (/member|join|role|room_created|left|removed/.test(a)) return "member";
    if (/budget|alert|remind|settings|code_reset/.test(a)) return "alert";
    return "expense";
  }

  function badgeSvg(type) {
    if (type === "payment") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h16v12H4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M15 13.5h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    if (type === "member") return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M5 19c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    if (type === "alert") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 21 20H3L12 4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M12 10v5M12 17.5v.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18H7z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M9 8h6M9 12h6M9 16h4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>`;
  }

  function impact(row) {
    const d = detail(row);
    const uid = MB.uid();
    const action = row.action;
    const share = shareOf(row);
    const amount = d.amount != null ? Number(d.amount) : null;
    const paidBy = d.paid_by;
    const none = { text: "no change", cls: "is-neutral" };
    const pill = (amt, kind) => {
      const n = Number(amt) || 0;
      if (n < 0.005) return none;
      if (kind === "get") return { text: "+" + formatMoney(n) + " you get", cls: "is-good" };
      if (kind === "owe") return { text: "−" + formatMoney(n) + " you owe", cls: "is-bad" };
      if (kind === "paid") return { text: "−" + formatMoney(n) + " paid", cls: "is-bad" };
      if (kind === "spend") return { text: "−" + formatMoney(n), cls: "is-bad" };
      if (kind === "income") return { text: "+" + formatMoney(n), cls: "is-good" };
      return none;
    };
    if (action === "settlement_recorded" || action === "settlement_confirmed") {
      const amt = Number(d.amount) || 0;
      if (d.to === uid) return pill(amt, "get");
      if (d.from === uid) return pill(amt, "paid");
      return none;
    }
    if (action === "share_accepted" || action === "share_forced") {
      const accepted = d.share_amount != null && d.share_amount !== "" ? Number(d.share_amount) : (share != null ? Number(share) : null);
      const subject = d.user_id;
      if (accepted == null || Number.isNaN(accepted)) return none;
      if (paidBy === uid) return pill(accepted, "get");
      if (subject === uid || (!subject && (row.actor_id === uid || (share != null && share > 0)))) return pill(accepted, "owe");
      return none;
    }
    if (["expense_added", "expense_edited"].includes(action)) {
      if (share == null || Number.isNaN(Number(share))) return none;
      if (paidBy === uid) {
        const back = Math.max(0, (amount != null ? amount : Number(share)) - Number(share));
        return back > 0.004 ? pill(back, "get") : none;
      }
      if (Number(share) > 0.004) return pill(share, "owe");
      return none;
    }
    if (action === "expense_deleted") {
      if (share == null) return none;
      if (paidBy === uid) {
        const back = Math.max(0, (amount != null ? amount : Number(share)) - Number(share));
        return back > 0.004 ? { text: "−" + formatMoney(back) + " reversed", cls: "is-bad" } : none;
      }
      if (Number(share) > 0.004) return { text: "+" + formatMoney(share) + " reversed", cls: "is-good" };
      return none;
    }
    if (action === "personal_added" || action === "personal_edited") {
      const amt = Number(d.amount) || 0;
      return d.type === "income" ? pill(amt, "income") : pill(amt, "spend");
    }
    return none;
  }

  function sentence(row) {
    const d = detail(row);
    const actor = actorName(row);
    const exp = expenseName(d);
    const amt = d.amount != null ? formatMoney(d.amount) : "";
    const expBit = exp || d.category || "an expense";
    const ofExp = exp ? " of " + exp : "";
    const uid = MB.uid();
    switch (row.action) {
      case "expense_added":
        return actor + " added " + expBit + (amt ? " · " + amt : "");
      case "expense_edited":
        return actor + " edited " + expBit;
      case "expense_deleted":
        return (exp || "An expense") + " was deleted" + (amt ? " · " + amt : "");
      case "share_accepted":
      case "share_forced": {
        const subject = d.user_id;
        if (subject && subject !== row.actor_id) {
          return actor + " accepted " + (subject === uid ? "your share" : nameOf(subject) + "'s share") + ofExp;
        }
        if (row.actor_id === uid) return "You accepted your share" + ofExp;
        return actor + " accepted their share" + ofExp;
      }
      case "share_declined":
        return actor + " declined " + (row.actor_id === uid ? "your share" : "their share") + ofExp;
      case "settlement_recorded": {
        const via = d.note && /upi/i.test(d.note) ? " via UPI" : "";
        if (d.to === uid) return actor + " paid you" + (amt ? " · " + amt : "") + via;
        if (d.from === uid) {
          const other = nameOf(d.to, "them");
          return (row.actor_id === uid ? "You paid " : actor + " paid ") + other + (amt ? " · " + amt : "") + via;
        }
        return actor + " recorded a payment" + (amt ? " · " + amt : "") + via;
      }
      case "settlement_confirmed":
        return actor + " confirmed a" + (amt ? " " + amt : "") + " payment";
      case "member_joined":
        return actor + " joined the room";
      case "member_left":
        return actor + " left the room";
      case "member_removed":
        return actor + " removed " + nameOf(row.target_id, "a roommate");
      case "role_changed":
        return actor + " updated a roommate's permissions";
      case "join_approved":
        return actor + " approved a join request";
      case "join_rejected":
        return actor + " declined a join request";
      case "room_created":
        return actor + " created " + (d.name || row.room_name || "the room");
      case "code_reset":
        return actor + " reset the invite code";
      case "settings_updated":
        return actor + " updated room settings";
      case "budget_warning":
        return d.title || ("Budget 80% reached" + (d.category ? " for " + d.category : ""));
      case "budget_exceeded":
        return d.title || ("Budget exceeded" + (d.category ? " for " + d.category : ""));
      case "personal_added":
        return "You added a personal " + (d.type === "income" ? "income" : "expense") + (exp ? " · " + exp : "") + (amt ? " · " + amt : "");
      case "personal_edited":
        return "You edited a personal " + (d.type === "income" ? "income" : "expense") + (exp ? " · " + exp : "");
      case "personal_deleted":
        return "You deleted a personal " + (d.type === "income" ? "income" : "expense") + (exp ? " · " + exp : "");
      default: {
        const a = (row.action || "updated something").replace(/_/g, " ");
        if (/remind/i.test(a)) return actor + " reminded " + nameOf(d.user_id || d.to, "a roommate");
        return actor + " " + a;
      }
    }
  }

  function subline(row) {
    const d = detail(row);
    const parts = [];
    if (d.category) parts.push(d.category);
    const t = relativeTime(row.created_at);
    if (t) parts.push(t);
    if (row.room_name) parts.push(row.room_name);
    return parts.join(" · ");
  }

  function hrefFor(row) {
    const id = row.target_id;
    if (row.target_type === "expense" && id && row.action !== "expense_deleted") return "add-expense.html?id=" + encodeURIComponent(id);
    if (row.target_type === "settlement") return "settle.html";
    if (row.target_type === "personal" && id && row.action !== "personal_deleted") return "add-expense.html?mode=personal&id=" + encodeURIComponent(id);
    if (row.action && row.action.indexOf("budget") === 0) return row.room_id ? "analytics.html" : "personal.html";
    if (row.target_type === "user" || (row.action && row.action.indexOf("member") === 0) || row.action === "join_approved") return "members.html";
    if (row.room_id && (row.target_type === "room" || row.action === "settings_updated" || row.action === "code_reset")) return "room.html";
    if (row.room_id) return "dashboard.html";
    return "personal.html";
  }

  function media(row) {
    const person = {
      id: row.actor_id,
      display_name: actorName(row),
      avatar_url: row.actor_avatar || (row.actor_id && people.get(row.actor_id) && people.get(row.actor_id).avatar_url),
    };
    const type = typeOf(row);
    return `<span class="activity-avatar">${MB.avatarHtml(person, "md")}<span class="activity-badge is-${type}" title="${escapeHtml(type)}">${badgeSvg(type)}</span></span>`;
  }

  function renderFeed() {
    const host = $("activity-feed");
    if (!items.length) {
      host.innerHTML = MB.emptyState({
        art: "images/illu-house.webp",
        title: "No activity yet",
        text: "Add an expense or invite a roommate — updates will show up here.",
        href: "add-expense.html",
        cta: "Add an expense",
      });
      $("activity-more-wrap").hidden = true;
      return;
    }
    const groups = [];
    items.forEach((row) => {
      const key = String(row.created_at || "").slice(0, 10);
      const last = groups[groups.length - 1];
      if (!last || last.key !== key) groups.push({ key, heading: dayHeading(row.created_at), rows: [row] });
      else last.rows.push(row);
    });
    host.innerHTML = groups.map((g) => `
      <section class="activity-day">
        <h3 class="day-heading">${escapeHtml(g.heading)}</h3>
        <div class="list">
          ${g.rows.map((row) => {
            const imp = impact(row);
            const href = hrefFor(row);
            const chip = `<span class="activity-impact ${imp.cls === "is-good" ? "is-good" : (imp.cls === "is-bad" ? "is-bad" : "is-neutral")}">${escapeHtml(imp.text)}</span>`;
            const thumb = row._proofUrl ? MB.proofThumbHtml(row._proofUrl, "Payment screenshot") : "";
            return `<a class="list-item activity-item" href="${escapeHtml(href)}">
              ${media(row)}
              <div class="activity-copy">
                <div class="item-title">${escapeHtml(sentence(row))}</div>
                <div class="item-sub">${escapeHtml(subline(row))}</div>
                ${thumb}
              </div>
              ${chip}
            </a>`;
          }).join("")}
        </div>
      </section>`).join("");
    $("activity-more-wrap").hidden = !hasMore;
    if (MB.bindProofLightbox) MB.bindProofLightbox(host);
  }

  function paintFilters() {
    const scopeEl = $("scope-filter");
    const kindEl = $("kind-filter");
    if (!scopeEl || !kindEl) return;
    const scopes = [{ id: "all", label: "All rooms" }]
      .concat(rooms.map((r) => ({ id: r.id, label: r.name || "Room" })))
      .concat([{ id: "personal", label: "Personal" }]);
    scopeEl.innerHTML = scopes.map((s) =>
      `<option value="${escapeHtml(s.id)}"${scope === s.id ? " selected" : ""}>${escapeHtml(s.label)}</option>`
    ).join("");
    kindEl.innerHTML = KINDS.map((k) =>
      `<option value="${escapeHtml(k.id)}"${kind === k.id ? " selected" : ""}>${escapeHtml(k.label)}</option>`
    ).join("");
    if (!scopeEl.dataset.bound) {
      scopeEl.dataset.bound = "1";
      scopeEl.addEventListener("change", () => {
        scope = scopeEl.value;
        reload();
      });
    }
    if (!kindEl.dataset.bound) {
      kindEl.dataset.bound = "1";
      kindEl.addEventListener("change", () => {
        kind = kindEl.value;
        reload();
      });
    }
  }

  async function loadPage(reset) {
    if (loading) return;
    loading = true;
    try {
      const params = {
        p_kind: kind,
        p_cursor: reset ? null : cursor,
        p_cursor_id: reset ? null : cursorId,
        p_limit: 30,
      };
      if (scope === "all") {
        params.p_room_ids = null;
        params.p_include_personal = true;
      } else if (scope === "personal") {
        params.p_room_ids = [];
        params.p_include_personal = true;
      } else {
        params.p_room_ids = [scope];
        params.p_include_personal = false;
      }
      const { data, error } = await MB.client().rpc("get_activity", params);
      if (error) throw error;
      const payload = data && data.items ? data : { items: Array.isArray(data) ? data : [], has_more: false };
      const batch = payload.items || [];
      const extraIds = [];
      batch.forEach((r) => {
        const d = r.detail && typeof r.detail === "object" ? r.detail : {};
        [r.actor_id, d.paid_by, d.from, d.to, d.user_id, r.target_type === "user" ? r.target_id : null].forEach((id) => {
          if (id && !people.has(id)) extraIds.push(id);
        });
      });
      const missing = [...new Set(extraIds)];
      if (missing.length) {
        const { data: profiles } = await MB.client().from("profiles").select("id, avatar_url, display_name").in("id", missing);
        rememberPeople(profiles);
      }
      batch.forEach((r) => {
        const pr = r.actor_id && people.get(r.actor_id);
        if (!pr) return;
        if (!r.actor_avatar) r.actor_avatar = pr.avatar_url;
        if (!r.actor_name) r.actor_name = pr.display_name;
      });
      const settleIds = [...new Set(batch.filter((r) => r.target_type === "settlement" && r.target_id).map((r) => r.target_id))];
      if (settleIds.length) {
        const { data: settles } = await MB.client().from("settlements").select("id, proof_path").in("id", settleIds);
        const pathById = new Map((settles || []).map((s) => [s.id, s.proof_path]));
        await Promise.all(batch.map(async (r) => {
          const path = (detail(r) && detail(r).proof_path) || pathById.get(r.target_id);
          if (!path) return;
          try { r._proofUrl = await MB.signedReceiptUrl(path); } catch (e) { r._proofUrl = ""; }
        }));
      }
      if (reset) items = batch;
      else items = items.concat(batch);
      hasMore = !!payload.has_more;
      const last = items[items.length - 1];
      cursor = last ? last.created_at : null;
      cursorId = last ? last.id : null;
      renderFeed();
    } catch (err) {
      if (reset) {
        $("activity-feed").innerHTML = `<p class="empty">${escapeHtml(MB.errorMessage(err))}</p>`;
      }
    } finally {
      loading = false;
    }
  }

  function reload() {
    cursor = null;
    cursorId = null;
    items = [];
    loadPage(true);
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Activity" });
    if (!ctx) return;
    rooms = (ctx.rooms || []).filter((r) => !r.archived_at);
    rememberPeople(ctx.members);
    paintFilters();
    $("activity-more").addEventListener("click", () => loadPage(false));
    const sentinel = $("activity-more-wrap");
    if ("IntersectionObserver" in window && sentinel) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && hasMore && !loading) loadPage(false);
      }, { rootMargin: "160px" });
      io.observe(sentinel);
    }
    await loadPage(true);
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
