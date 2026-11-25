(() => {
  const MB = window.MB;
  const { $, escapeHtml, showError, hideError, errorMessage } = MB;

  async function main() {
    const ctx = await MB.bootApp({ title: "Room" });
    if (!ctx) return;
    const rooms = ctx.rooms;
    if (ctx.room) {
      $("room-name").textContent = ctx.room.name;
      $("room-code").textContent = ctx.room.code;
      const members = await MB.loadMembers(ctx.room.id);
      $("member-list").innerHTML = members.map((m) => `<div class="list-item">
        <div><div class="item-title">${MB.personChip(m, members, "md")}${m.id === ctx.uid ? " (you)" : ""}</div>
        <div class="item-sub">${m.role === "owner" ? escapeHtml(MB.roleLabel(m.role)) : ""}</div></div>
      </div>`).join("");
      $("copy-code").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(ctx.room.code);
          $("copy-code").textContent = "Copied";
          setTimeout(() => { $("copy-code").textContent = "Copy"; }, 1500);
        } catch (e) { MB.showPageError("Code: " + ctx.room.code); }
      });
      const owner = members.find((m) => m.role === "owner");
      const inviter = (owner && owner.display_name) || (ctx.profile && ctx.profile.display_name) || "a roommate";
      $("share-wa").href = MB.whatsappShareHref(ctx.room, inviter);
      const native = $("share-native");
      if (native && navigator.share) {
        native.hidden = false;
        native.addEventListener("click", () => MB.shareInvite(ctx.room, inviter));
      }
      $("copy-msg").addEventListener("click", async () => {
        const ok = await MB.copyInviteMessage(ctx.room, inviter);
        $("copy-msg").textContent = ok ? "Copied" : "Copy failed — long-press WhatsApp instead";
        setTimeout(() => { $("copy-msg").textContent = "Copy message"; }, 1800);
        if (!ok) MB.showPageError(MB.inviteShareText(ctx.room, inviter));
      });
      const row = $("share-wa").parentElement;
      if (ctx.isAdmin) {
        const settings = document.createElement("a");
        settings.className = "secondary-btn";
        settings.href = "room-settings.html";
        settings.textContent = "Room settings";
        row.insertBefore(settings, $("share-wa"));
      }
      const activity = document.createElement("a");
      activity.className = "secondary-btn";
      activity.href = "activity.html";
      activity.textContent = "Activity log";
      row.appendChild(activity);

      $("leave-room").addEventListener("click", async () => {
        if (!confirm("Leave this room? You will lose access to its expenses.")) return;
        const { error } = await MB.client().rpc("leave_room", { p_room_id: ctx.room.id });
        if (error) return MB.showPageError(errorMessage(error));
        const rest = rooms.filter((r) => r.id !== ctx.room.id);
        MB.setActiveRoomId(rest[0] ? rest[0].id : "");
        location.href = "dashboard.html";
      });
    } else {
      $("current-room").hidden = true;
    }

    $("room-switch").innerHTML = rooms.length
      ? rooms.map((r) => `<option value="${escapeHtml(r.id)}" ${r.id === (ctx.room && ctx.room.id) ? "selected" : ""}>${escapeHtml(r.name)} (${escapeHtml(r.code)})</option>`).join("")
      : `<option>No rooms yet</option>`;
    $("switch-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = $("room-switch").value;
      if (id) MB.setActiveRoomId(id);
      location.href = "dashboard.html";
    });
    $("create-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("room-error");
      const { data, error } = await MB.client().rpc("create_room", { p_name: $("new-room-name").value.trim() });
      if (error) return showError("room-error", errorMessage(error));
      MB.setActiveRoomId(data.id);
      location.reload();
    });
    $("join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("room-error");
      const { data, error } = await MB.client().rpc("join_room", { p_code: $("join-code").value });
      if (error) return showError("room-error", errorMessage(error));
      if (data.status === "pending") return showError("room-error", "Your request to join " + (data.name || "this room") + " is waiting for admin approval.");
      MB.setActiveRoomId(data.id);
      location.reload();
    });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
