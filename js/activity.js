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
  let scope = "all";
  let kind = "all";
  let cursor = null;
  let cursorId = null;
  let hasMore = false;
  let loading = false;
  let items = [];

  function who(row) {
    if (row.actor_id && row.actor_id === MB.uid()) return "You";
    return row.actor_name || "Someone";
  }
  function actorChip(row) {
    return MB.personChip({
      id: row.actor_id,
      display_name: who(row),
      avatar_url: row.actor_avatar,
    }, null, "avatar-sm");
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
    return MB.friendlyDate(String(iso).slice(0, 10));
  }

  function detail(row) {
    return row.detail && typeof row.detail === "object" ? row.detail : {};
  }

  function shareOf(row) {
    if (row.my_share != null && row.my_share !== "") return Number(row.my_share);
    const d = detail(row);
    if (d.share_amount != null) return Number(d.share_amount);
    const uid = MB.uid();
    if (d.shares && uid && d.shares[uid] != null) return Number(d.shares[uid]);
    return null;
  }

  function impact(row) {
    const d = detail(row);
    const uid = MB.uid();
    const action = row.action;
    const share = shareOf(row);
    const amount = d.amount != null ? Number(d.amount) : null;
    const paidBy = d.paid_by;
    if (action === "settlement_recorded" || action === "settlement_confirmed") {
      const amt = Number(d.amount) || 0;
      if (d.to === uid || d.to === MB.uid()) return { text: "+" + formatMoney(amt), cls: "is-good" };
      if (d.from === uid) return { text: "−" + formatMoney(amt), cls: "is-bad" };
    }
    if (action === "share_accepted" || action === "share_forced") {
      // Use the share that was accepted, not the viewer's split of the same bill.
      const accepted = d.share_amount != null && d.share_amount !== "" ? Number(d.share_amount) : null;
      if (accepted == null || Number.isNaN(accepted) || accepted < 0.005) return null;
      if (paidBy === uid) return { text: "+" + formatMoney(accepted), cls: "is-good", label: "you get back" };
      if (row.actor_id === uid || (action === "share_forced" && d.user_id === uid)) {
        return { text: "−" + formatMoney(accepted), cls: "is-bad", label: "you owe" };
      }
      return null;
    }
    if (["expense_added", "expense_edited"].includes(action) && share != null) {
      if (paidBy === uid) {
        const back = Math.max(0, (amount != null ? amount : share) - share);
        if (back > 0.004) return { text: "+" + formatMoney(back), cls: "is-good", label: "you get back" };
        return null;
      }
      if (share > 0.004) return { text: "−" + formatMoney(share), cls: "is-bad", label: "you owe" };
    }
    if (action === "expense_deleted" && share != null) {
      if (paidBy === uid) {
        const back = Math.max(0, (amount != null ? amount : share) - share);
        if (back > 0.004) return { text: "−" + formatMoney(back), cls: "is-bad", label: "reversed" };
      } else if (share > 0.004) return { text: "+" + formatMoney(share), cls: "is-good", label: "reversed" };
    }
    if (action === "personal_added" || action === "personal_edited") {
      const amt = Number(d.amount) || 0;
      if (d.type === "income") return { text: "+" + formatMoney(amt), cls: "is-good" };
      return { text: "−" + formatMoney(amt), cls: "is-bad" };
    }
    return null;
  }

  function sentence(row) {
    const d = detail(row);
    const actor = actorChip(row);
    const desc = escapeHtml(d.description || d.title || "");
    const cat = escapeHtml(d.category || "");
    const amt = d.amount != null ? formatMoney(d.amount) : "";
    const share = shareOf(row);
    const shareBit = share != null ? " · your share " + formatMoney(share) : "";
    const name = (label) => (label && label === MB.uid()) ? "you" : label;
    switch (row.action) {
      case "expense_added":
        return actor + " added " + (amt ? amt + " " : "") + (cat || desc || "an expense") + shareBit;
      case "expense_edited": {
        const before = d.before || {};
        if (before.amount != null && Number(before.amount) !== Number(d.amount)) {
          return "Expense edited: amount " + formatMoney(before.amount) + " → " + formatMoney(d.amount);
        }
        if (before.description && desc && before.description !== desc) {
          return "Expense edited: " + escapeHtml(before.description) + " → " + desc;
        }
        return actor + " edited " + (desc || cat || "an expense");
      }
      case "expense_deleted":
        return "Expense deleted" + (desc || cat ? ": " + (desc || cat) : "") + (amt ? " (" + amt + ")" : "");
      case "share_accepted":
        return actor + " accepted " + (cat || desc || "an") + " share";
      case "share_declined":
        return actor + " declined " + (cat || desc || "a") + " share";
      case "share_forced":
        return "Admin marked a " + (cat || desc || "") + " share as accepted";
      case "settlement_recorded": {
        const via = d.note && /upi/i.test(d.note) ? " via UPI" : (d.note ? " · " + escapeHtml(d.note) : "");
        if (d.to === MB.uid()) return (d.from === row.actor_id ? actor : (actor)) + " paid you " + (amt || formatMoney(d.amount)) + via;
        if (d.from === MB.uid() && row.actor_id === MB.uid()) return "You paid " + (amt || formatMoney(d.amount)) + via;
        return actor + " recorded a " + (amt || "") + " payment" + via;
      }
      case "settlement_confirmed":
        return actor + " confirmed a " + (amt || "") + " payment";
      case "member_joined":
        return actor + " joined the room";
      case "member_left":
        return actor + " left the room";
      case "member_removed":
        return actor + " removed a member";
      case "role_changed":
        return actor + " changed a role" + (d.role ? " to " + d.role : "");
      case "join_approved":
        return actor + " approved a join request";
      case "join_rejected":
        return actor + " declined a join request";
      case "room_created":
        return actor + " created " + escapeHtml(d.name || row.room_name || "the room");
      case "code_reset":
        return actor + " reset the invite code";
      case "settings_updated":
        return actor + " updated room settings";
      case "budget_warning":
        return escapeHtml(d.title || "") || ("Budget 80% reached" + (cat ? " for " + cat : ""));
      case "budget_exceeded":
        return escapeHtml(d.title || "") || ("Budget exceeded" + (cat ? " for " + cat : ""));
      case "personal_added":
        return "You added a personal " + (d.type === "income" ? "income" : "expense") + (amt ? ": " + amt : "") + (cat ? " · " + cat : "");
      case "personal_edited":
        return "You edited a personal " + (d.type === "income" ? "income" : "expense");
      case "personal_deleted":
        return "You deleted a personal " + (d.type === "income" ? "income" : "expense");
      default:
        return actor + " " + (row.action || "updated something").replace(/_/g, " ");
    }
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
    const imp = impact(row);
    const icons = MB.ICONS || {};
    if (imp && imp.cls === "is-good") return `<span class="tx-icon is-in" aria-hidden="true">${icons.arrowIn || "↓"}</span>`;
    if (imp && imp.cls === "is-bad") return `<span class="tx-icon is-out" aria-hidden="true">${icons.arrowOut || "↑"}</span>`;
    return `<span class="tx-icon" aria-hidden="true">${icons.activity || "•"}</span>`;
  }

  function renderFeed() {
    const host = $("activity-feed");
    if (!items.length) {
      host.innerHTML = MB.emptyState({
        emoji: "🕊️",
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
      <section class="card activity-day">
        <h3 class="day-heading">${escapeHtml(g.heading)}</h3>
        <div class="list">
          ${g.rows.map((row) => {
            const imp = impact(row);
            const href = hrefFor(row);
            const roomBit = row.room_name && scope === "all" ? `<span class="item-sub-room">${escapeHtml(row.room_name)}</span>` : "";
            const chip = imp ? `<span class="item-amt ${imp.cls === "is-good" ? "pos" : (imp.cls === "is-bad" ? "neg" : "")}" title="${escapeHtml(imp.label || "")}">${escapeHtml(imp.text)}</span>` : "";
            return `<a class="list-item activity-item" href="${escapeHtml(href)}">
              ${media(row)}
              <div>
                <div class="item-title">${sentence(row)}</div>
                <div class="item-sub">${escapeHtml(relativeTime(row.created_at))}${roomBit ? " · " + roomBit : ""}</div>
              </div>
              ${chip}
            </a>`;
          }).join("")}
        </div>
      </section>`).join("");
    $("activity-more-wrap").hidden = !hasMore;
  }

  function paintChips() {
    const scopeHost = $("scope-chips");
    const scopes = [{ id: "all", label: "All rooms" }]
      .concat(rooms.map((r) => ({ id: r.id, label: r.name || "Room" })))
      .concat([{ id: "personal", label: "Personal" }]);
    scopeHost.innerHTML = scopes.map((s) =>
      `<button type="button" class="filter-chip${scope === s.id ? " is-active" : ""}" data-scope="${escapeHtml(s.id)}" aria-pressed="${scope === s.id ? "true" : "false"}">${escapeHtml(s.label)}</button>`
    ).join("");
    scopeHost.querySelectorAll("[data-scope]").forEach((btn) => {
      btn.addEventListener("click", () => {
        scope = btn.getAttribute("data-scope");
        paintChips();
        reload();
      });
    });
    const kindHost = $("kind-chips");
    kindHost.innerHTML = KINDS.map((k) =>
      `<button type="button" class="filter-chip${kind === k.id ? " is-active" : ""}" data-kind="${escapeHtml(k.id)}" aria-pressed="${kind === k.id ? "true" : "false"}">${escapeHtml(k.label)}</button>`
    ).join("");
    kindHost.querySelectorAll("[data-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        kind = btn.getAttribute("data-kind");
        paintChips();
        reload();
      });
    });
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
      const missing = [...new Set(batch.filter((r) => r.actor_id && !r.actor_avatar).map((r) => r.actor_id))];
      if (missing.length) {
        const { data: profiles } = await MB.client().from("profiles").select("id, avatar_url, display_name").in("id", missing);
        const map = new Map((profiles || []).map((x) => [x.id, x]));
        batch.forEach((r) => {
          const pr = map.get(r.actor_id);
          if (!pr) return;
          if (!r.actor_avatar) r.actor_avatar = pr.avatar_url;
          if (!r.actor_name) r.actor_name = pr.display_name;
        });
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
    paintChips();
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
