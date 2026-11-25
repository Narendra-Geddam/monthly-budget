(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, showError, hideError, errorMessage } = MB;

  async function renderJoinRequests(roomId) {
    const box = $("admin-joins");
    const list = $("join-request-list");
    if (!box || !list) return;
    const { data, error } = await MB.client().from("join_requests").select("id, user_id, status, created_at").eq("room_id", roomId).eq("status", "pending").order("created_at");
    if (error || !data || !data.length) return;
    const ids = data.map((r) => r.user_id);
    const { data: profiles } = await MB.client().from("profiles").select("id, display_name, avatar_url, phone, upi_id").in("id", ids);
    box.hidden = false;
    list.innerHTML = data.map((r) => {
      const p = (profiles || []).find((x) => x.id === r.user_id);
      const name = (p && p.display_name) || "Someone";
      const person = { display_name: name, avatar_url: p && p.avatar_url };
      return `<div class="pending-card">
        <div><div class="item-title">${escapeHtml(name)}</div><div class="item-sub">Asked to join with the room code</div></div>
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
        if (error) return MB.showPageError(errorMessage(error));
        location.reload();
      });
    });
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Members", month: true });
    if (!ctx) return;
    if (!ctx.room) { $("list").innerHTML = MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Roommates will appear here after you join or create a room.", href: "dashboard.html", cta: "Go to Home" }); return; }
    const members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    const packed = (ctx.expenses && ctx.splits && ctx.settlements) ? ctx : await MB.loadMonthData(ctx.room.id, ctx.month);
    const { expenses, splits, settlements } = packed;
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));

    async function setRole(userId, role) {
      const msg = role === "owner" ? "Transfer ownership to this person? You will still be able to help manage the room." : (role === "admin" ? "Let this person help manage the room?" : "Stop this person from managing the room?");
      if (!confirm(msg)) return;
      const { error } = await MB.client().rpc("set_member_role", { p_room_id: ctx.room.id, p_user_id: userId, p_role: role });
      if (error) return MB.showPageError(errorMessage(error));
      location.reload();
    }
    async function removeMember(userId) {
      if (!confirm("Remove this member from the room?")) return;
      const { error } = await MB.client().rpc("remove_member", { p_room_id: ctx.room.id, p_user_id: userId });
      if (error) return MB.showPageError(errorMessage(error));
      location.reload();
    }

    $("list").innerHTML = balances.map((b) => {
      const m = byId[b.id] || { role: "member" };
      const canAct = ctx.isAdmin && b.id !== ctx.uid && m.role !== "owner";
      const canOwnTools = ctx.isOwner && b.id !== ctx.uid && m.role !== "owner";
      const person = Object.assign({ id: b.id, display_name: b.name, avatar_url: m.avatar_url || b.avatar_url }, m);
      const chips = [
        b.id === ctx.uid ? `<span class="role-badge">You</span>` : "",
        m.role === "owner" ? `<span class="role-badge">${escapeHtml(MB.roleLabel(m.role))}</span>` : "",
      ].filter(Boolean).join("");
      const kebab = canAct || canOwnTools ? `<button type="button" class="kebab-btn" data-member-menu="${escapeHtml(b.id)}" aria-haspopup="dialog" aria-label="Actions for ${escapeHtml(b.name)}">${MB.ICONS && MB.ICONS.kebab ? MB.ICONS.kebab : "⋯"}</button>` : "";
      return `<div class="member-row">
        <a class="member-main" href="member.html?id=${encodeURIComponent(b.id)}">
          ${MB.avatarHtml(person, "md")}
          <span class="member-copy">
            <span class="member-name-line">
              <span class="member-name">${escapeHtml(b.name)}</span>
              ${chips}
            </span>
            <span class="member-meta">Paid ${escapeHtml(formatMoney(b.paidAmt))} · share ${escapeHtml(formatMoney(b.shareAmt))}</span>
          </span>
          ${MB.memberNetChip(b.netAmt, true)}
        </a>
        ${kebab}
      </div>`;
    }).join("") || MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Invite a roommate to start splitting bills.", href: "room.html", cta: "Invite someone" });

    $("list").querySelectorAll("[data-member-menu]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-member-menu");
        const m = byId[id] || {};
        const name = (m.display_name || m.name || "Member");
        const items = [];
        if (ctx.isOwner && m.role !== "owner") {
          if (m.role === "admin") items.push({ label: "Stop managing room", onSelect: () => setRole(id, "member") });
          else items.push({ label: "Allow managing room", onSelect: () => setRole(id, "admin") });
          items.push({ label: "Transfer ownership", onSelect: () => setRole(id, "owner") });
        }
        if (ctx.isAdmin && m.role !== "owner") {
          items.push({ label: "Remove", danger: true, onSelect: () => removeMember(id) });
        }
        if (!items.length) return;
        MB.openActionSheet({ title: name, items });
      });
    });

    if (ctx.isAdmin) {
      $("invite-card").hidden = false;
      await renderJoinRequests(ctx.room.id);
      $("invite-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError("invite-error");
        $("invite-ok").hidden = true;
        const { data, error } = await MB.client().rpc("invite_to_room", { p_room_id: ctx.room.id, p_email: $("invite-email").value.trim() });
        if (error) return showError("invite-error", errorMessage(error));
        if (data && data.status === "not_found") {
          return showError("invite-error", "No account exists for that email yet. Share the invite link from Room settings instead.");
        }
        $("invite-ok").hidden = false;
        $("invite-ok").textContent = "Invite sent. They will see it in Notifications.";
        $("invite-email").value = "";
      });
    }
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
