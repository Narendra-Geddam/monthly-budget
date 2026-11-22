(() => {
  const MB = window.MB;
  const { $, escapeHtml, showError, hideError, errorMessage } = MB;

  function nextParam(code) {
    return encodeURIComponent("invite.html?code=" + encodeURIComponent(code));
  }

  function rememberCode(code) {
    if (!code) return;
    try { sessionStorage.setItem("monthly-budget-pending-code", code); } catch (e) { /* ignore */ }
  }

  function renderPreview(preview) {
    $("invite-title").textContent = "You're invited to " + preview.name;
    $("invite-lead").textContent = (preview.inviter_name || "A roommate") + " invited you to join this room on Monthly Budget.";
    const n = Number(preview.member_count) || 0;
    const members = n === 1 ? "1 member" : n + " members";
    $("invite-meta").hidden = false;
    $("invite-meta").innerHTML =
      "<div><dt>Room</dt><dd>" + escapeHtml(preview.name) + "</dd></div>" +
      "<div><dt>Invited by</dt><dd>" + escapeHtml(preview.inviter_name || "A roommate") + "</dd></div>" +
      "<div><dt>Members</dt><dd>" + escapeHtml(members) + "</dd></div>" +
      (preview.code ? "<div><dt>Code</dt><dd><strong>" + escapeHtml(preview.code) + "</strong></dd></div>" : "");
  }

  async function loadPreview(code) {
    const { data, error } = await MB.client().rpc("get_room_invite_preview", { p_code: code });
    if (error) throw error;
    return data;
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    const code = (params.get("code") || "").trim().toUpperCase();
    const ctx = await MB.bootApp({ title: "Join a room", allowGuest: true });
    if (!ctx) return;

    if (code) {
      $("join-code").value = code;
      rememberCode(code);
      try {
        const preview = await loadPreview(code);
        if (preview) renderPreview(preview);
      } catch (err) {
        showError("join-error", errorMessage(err));
      }
    }

    if (ctx.guest || !ctx.session) {
      if (code) {
        $("invite-auth").hidden = false;
        $("invite-login").href = "login.html?next=" + nextParam(code);
        $("invite-signup").href = "signup.html?next=" + nextParam(code);
        $("join-form").hidden = true;
      } else {
        $("invite-lead").textContent = "Log in to join a room with a code, or create an account first.";
        $("invite-auth").hidden = false;
        $("invite-login").href = "login.html?next=" + encodeURIComponent("invite.html");
        $("invite-signup").href = "signup.html?next=" + encodeURIComponent("invite.html");
        $("join-form").hidden = true;
      }
      return;
    }

    // Logged in: already a member of this room? go to dashboard.
    if (code && ctx.rooms && ctx.rooms.length) {
      const mine = ctx.rooms.find((r) => String(r.code).toUpperCase() === code);
      if (mine) {
        MB.setActiveRoomId(mine.id);
        location.replace("dashboard.html");
        return;
      }
    }

    try {
      const pending = JSON.parse(sessionStorage.getItem("monthly-budget-join-pending") || "null");
      if (pending && pending.status === "pending" && (!code || String(pending.code || "").toUpperCase() === code || String(pending.name || "") === ($("invite-title").textContent || ""))) {
        $("invite-status").hidden = false;
        $("invite-status").textContent = "Request sent, waiting for admin approval. You'll get a notification when they respond.";
        $("invite-title").textContent = "Request sent";
        $("join-form").hidden = true;
        return;
      }
    } catch (e) { /* ignore */ }

    $("join-form").hidden = false;
    if (code) {
      $("invite-title").textContent = ($("invite-title").textContent.indexOf("invited") >= 0)
        ? $("invite-title").textContent.replace("You're invited to ", "Join ") + "?"
        : "Join this room?";
      $("join-code-field").hidden = true;
      $("join-btn").textContent = "Join";
    } else {
      $("join-code-field").hidden = false;
      $("join-btn").textContent = "Request to join";
    }

    $("join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("join-error");
      $("join-btn").disabled = true;
      try {
        const { data, error } = await MB.client().rpc("join_room", { p_code: $("join-code").value });
        if (error) throw error;
        if (data.status === "already_member" || data.status === "member") {
          MB.setActiveRoomId(data.id);
          location.href = "dashboard.html";
          return;
        }
        if (data.status === "pending") {
          $("invite-status").hidden = false;
          $("invite-status").textContent = "Request sent, waiting for admin approval. You'll get a notification when they respond.";
          $("invite-title").textContent = "Request sent";
          $("join-form").hidden = true;
          return;
        }
        MB.setActiveRoomId(data.id);
        location.href = "dashboard.html";
      } catch (err) {
        const msg = errorMessage(err);
        if (/already a member/i.test(msg)) {
          location.href = "dashboard.html";
          return;
        }
        showError("join-error", msg);
      } finally {
        $("join-btn").disabled = false;
      }
    });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
