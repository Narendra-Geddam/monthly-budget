(() => {
  const MB = window.MB;
  const { $, escapeHtml } = MB;

  function displayNotice(text, fallback) {
    const raw = (text == null || text === "") ? (fallback || "") : text;
    return MB.withoutAdminLabel ? MB.withoutAdminLabel(raw) : raw;
  }


  function timeLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  async function main() {
    const ctx = await MB.bootApp({ title: "Notifications" });
    if (!ctx) return;
    try {
      const inv = await MB.client().rpc("list_my_invites");
      const invites = Array.isArray(inv.data) ? inv.data : (inv.data ? [inv.data] : []);
      if (!inv.error && invites.length) {
        const box = document.createElement("div");
        box.id = "invite-list";
        box.innerHTML = "<h2>Invites for you</h2>" + invites.map((i) => `
          <div class="pending-card">
            <div><div class="item-title">${escapeHtml(i.room_name)}</div><div class="item-sub">Invited to ${escapeHtml(i.email || "your email")}</div></div>
            <div class="btn-row compact">
              <button type="button" class="primary-btn" data-accept-inv="${escapeHtml(i.id)}">Accept</button>
              <button type="button" class="danger-btn ghost" data-decline-inv="${escapeHtml(i.id)}">Decline</button>
            </div>
          </div>`).join("");
        $("notif-list").parentElement.insertBefore(box, $("notif-list"));
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
      }
    } catch (e) { console.warn(e); }

    const { data, error } = await MB.client().from("notifications").select("*").eq("user_id", ctx.uid).order("created_at", { ascending: false }).limit(80);
    if (error) { $("notif-list").innerHTML = `<p class="empty">${escapeHtml(MB.errorMessage(error))}</p>`; return; }
    const rows = data || [];
    $("notif-list").innerHTML = rows.length ? rows.map((n) => `
      <a class="list-item notif-item ${n.read_at ? "" : "is-unread"}" href="${escapeHtml(n.link || "dashboard.html")}" data-id="${escapeHtml(n.id)}">
        ${MB.avatarHtml({ id: n.actor_id || n.from_user || n.body, display_name: n.title, avatar_url: n.actor_avatar || n.avatar_url }, "md")}
        <div>
          <div class="item-title">${n.actor_id ? MB.personChip({ id: n.actor_id, display_name: displayNotice(n.title, n.body), avatar_url: n.actor_avatar || n.avatar_url }, null, "sm") : escapeHtml(displayNotice(n.title, n.body))}</div>
          <div class="item-sub">${escapeHtml(displayNotice(n.body, "") || "")}${(n.body) ? " · " : ""}${escapeHtml(timeLabel(n.created_at))}</div>
        </div>
      </a>`).join("") : MB.emptyState({ art: "images/illu-people.webp", title: "Nothing in your inbox", text: "You'll see join requests, share requests, and payment updates here." });

    $("notif-list").querySelectorAll(".notif-item").forEach((el) => {
      el.addEventListener("click", async (e) => {
        e.preventDefault();
        const id = el.getAttribute("data-id");
        const href = el.getAttribute("href") || "dashboard.html";
        try { await MB.client().rpc("mark_notifications_read", { p_ids: [id] }); } catch (err) { /* still navigate */ }
        location.href = href;
      });
    });
    $("mark-all").addEventListener("click", async () => {
      const { error } = await MB.client().rpc("mark_notifications_read", { p_ids: null });
      if (error) return MB.showPageError(MB.errorMessage(error));
      location.reload();
    });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
