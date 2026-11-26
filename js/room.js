(() => {
  const MB = window.MB;
  const { $, escapeHtml, showError, hideError, errorMessage } = MB;

  async function main() {
    const ctx = await MB.bootApp({ title: "Room" });
    if (!ctx) return;
    const rooms = ctx.rooms;
    if (ctx.room) {
      const current = $("current-room");
      if (current) current.hidden = false;
      const heading = $("room-heading");
      if (heading) {
        const meta = MB.roomTypeMeta ? MB.roomTypeMeta(ctx.room.type) : { emoji: "" };
        const emoji = meta && meta.emoji ? `<span class="group-switch-emoji" aria-hidden="true">${meta.emoji}</span>` : "";
        heading.innerHTML = `${emoji}<span>${escapeHtml(ctx.room.name || "Group")}</span>`;
      }
      $("room-code").textContent = ctx.room.code;
      const members = await MB.loadMembers(ctx.room.id);
      $("member-list").innerHTML = members.map((m) => {
        const name = (m.display_name || MB.displayName(m.id, members) || "Member");
        const you = m.id === ctx.uid ? " (you)" : "";
        const role = m.role === "owner" ? escapeHtml(MB.roleLabel(m.role)) : "";
        return `<div class="member-row">
          ${MB.avatarHtml(m, "md")}
          <div class="member-copy">
            <p class="member-name">${escapeHtml(name)}${you}</p>
            ${role ? `<p class="member-role">${role}</p>` : ""}
          </div>
        </div>`;
      }).join("");
      $("copy-code").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(ctx.room.code);
          $("copy-code").textContent = "Copied";
          setTimeout(() => { $("copy-code").textContent = "Copy"; }, 1500);
        } catch (e) { MB.showPageError("Code: " + ctx.room.code); }
      });
      const owner = members.find((m) => m.role === "owner");
      const inviter = (owner && owner.display_name) || (ctx.profile && ctx.profile.display_name) || "a roommate";
      const wa = $("share-wa");
      if (wa) {
        wa.href = MB.whatsappShareHref(ctx.room, inviter);
        wa.innerHTML = MB.ICONS && MB.ICONS.wa ? MB.ICONS.wa : "WA";
      }
      const share = $("share-invite");
      if (share) {
        share.addEventListener("click", async () => {
          const result = await MB.shareInvite(ctx.room, inviter);
          if (result === "shared" || result === "aborted" || result === "whatsapp") return;
          const ok = await MB.copyInviteMessage(ctx.room, inviter);
          share.textContent = ok ? "Copied" : "Share failed";
          setTimeout(() => { share.textContent = "Share"; }, 1800);
          if (!ok) MB.showPageError(MB.inviteShareText(ctx.room, inviter));
        });
      }
      const settings = $("room-settings-row");
      if (settings) {
        settings.hidden = !ctx.isAdmin;
        const chev = settings.querySelector(".sheet-chevron");
        if (chev && MB.ICONS) chev.innerHTML = MB.ICONS.chevron;
      }
      document.querySelectorAll("#current-room .link-row .sheet-chevron").forEach((el) => {
        if (MB.ICONS && !el.innerHTML) el.innerHTML = MB.ICONS.chevron;
      });

      $("leave-room").addEventListener("click", async () => {
        const ok = MB.confirmAction
          ? await MB.confirmAction({
              title: "Leave this group?",
              message: "You will lose access to its expenses.",
              confirmLabel: "Leave group",
              cancelLabel: "Stay",
            })
          : confirm("Leave this room? You will lose access to its expenses.");
        if (!ok) return;
        const { error } = await MB.client().rpc("leave_room", { p_room_id: ctx.room.id });
        if (error) return MB.showPageError(errorMessage(error));
        const rest = rooms.filter((r) => r.id !== ctx.room.id);
        MB.setActiveRoomId(rest[0] ? rest[0].id : "");
        location.href = "dashboard.html";
      });
    } else {
      const current = $("current-room");
      if (current) current.hidden = true;
    }

    const typSel = $("new-room-type");
    const dates = $("new-room-dates");
    if (typSel && dates) {
      typSel.addEventListener("change", () => { dates.hidden = typSel.value !== "trip"; });
    }
    $("create-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("room-error");
      const typ = (typSel && typSel.value) || "home";
      const { data, error } = await MB.client().rpc("create_room", {
        p_name: $("new-room-name").value.trim(),
        p_type: typ,
        p_start_date: typ === "trip" ? (($("new-room-start") && $("new-room-start").value) || null) : null,
        p_end_date: typ === "trip" ? (($("new-room-end") && $("new-room-end").value) || null) : null,
      });
      if (error) return showError("room-error", errorMessage(error));
      MB.setActiveRoomId(data.id);
      location.reload();
    });
    $("join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("room-error");
      const { data, error } = await MB.client().rpc("join_room", { p_code: $("join-code").value });
      if (error) return showError("room-error", errorMessage(error));
      if (data.status === "pending") return showError("room-error", "Your request to join " + (data.name || "this group") + " is waiting for approval.");
      MB.setActiveRoomId(data.id);
      location.reload();
    });
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
