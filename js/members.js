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

    $("list").innerHTML = balances.map((b) => {
      const m = byId[b.id] || { role: "member" };
      let actions = "";
      if (ctx.isAdmin && b.id !== ctx.uid) {
        if (ctx.isOwner && m.role !== "owner") {
          if (m.role === "admin") actions += `<button type="button" class="text-btn" data-role="${b.id}" data-to="member">Demote</button>`;
          else actions += `<button type="button" class="text-btn" data-role="${b.id}" data-to="admin">Make admin</button>`;
          actions += `<button type="button" class="text-btn" data-role="${b.id}" data-to="owner">Transfer ownership</button>`;
        }
        if (m.role !== "owner") actions += `<button type="button" class="text-btn danger-link" data-remove="${b.id}">Remove</button>`;
      }
      const role = MB.roleLabel(m.role);
      const roleBadge = (m.role === "owner" || m.role === "admin") ? ` <span class="role-badge">${escapeHtml(role)}</span>` : "";
      const person = Object.assign({ id: b.id, display_name: b.name, avatar_url: m.avatar_url || b.avatar_url }, m);
      return `<div class="member-card">
        <a href="member.html?id=${escapeHtml(b.id)}" style="color:inherit;text-decoration:none;flex:1;min-width:0">
          <div class="item-title">${MB.personChip(person, members, "md")}${b.id === ctx.uid ? " (you)" : ""}${roleBadge}</div>
          <div class="item-sub">Paid ${escapeHtml(formatMoney(b.paidAmt))} · share ${escapeHtml(formatMoney(b.shareAmt))}</div>
        </a>
        <div class="member-actions">
          ${MB.memberNetChip(b.netAmt)}
          ${actions}
        </div>
      </div>`;
    }).join("") || MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Invite a roommate to start splitting bills.", href: "room.html", cta: "Invite someone" });

    $("list").querySelectorAll("[data-role]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const role = btn.getAttribute("data-to");
        const msg = role === "owner" ? "Transfer ownership to this person? You will become an admin." : "Change this member's role?";
        if (!confirm(msg)) return;
        const { error } = await MB.client().rpc("set_member_role", { p_room_id: ctx.room.id, p_user_id: btn.getAttribute("data-role"), p_role: role });
        if (error) return MB.showPageError(errorMessage(error));
        location.reload();
      });
    });
    $("list").querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this member from the room?")) return;
        const { error } = await MB.client().rpc("remove_member", { p_room_id: ctx.room.id, p_user_id: btn.getAttribute("data-remove") });
        if (error) return MB.showPageError(errorMessage(error));
        location.reload();
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
