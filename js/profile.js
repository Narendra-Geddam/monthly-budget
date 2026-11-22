(() => {
  const MB = window.MB;
  const { $, escapeHtml, showError, hideError, errorMessage } = MB;
  async function main() {
    const ctx = await MB.bootApp({ title: "Profile" });
    if (!ctx) return;
    const email = (ctx.session && ctx.session.user && ctx.session.user.email) || "";
    const fallbackName = ctx.profile.display_name || (email ? email.split("@")[0] : "You");
    $("profile-name").value = ctx.profile.display_name || fallbackName;
    const heading = $("profile-display-name");
    if (heading) heading.textContent = fallbackName;
    $("profile-email").textContent = email;
    $("profile-email").hidden = !email;
    document.querySelectorAll("[data-panel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = $("panel-" + btn.getAttribute("data-panel"));
        if (!panel) return;
        panel.hidden = !panel.hidden;
      });
    });
    const themeRow = $("theme-row");
    const themeSub = $("theme-row-sub");
    const paintTheme = () => { if (themeSub) themeSub.textContent = (MB.currentTheme() === "light" ? "Light" : "Dark") + " theme · tap to switch"; };
    paintTheme();
    if (themeRow) themeRow.addEventListener("click", () => {
      MB.setTheme(MB.currentTheme() === "dark" ? "light" : "dark");
      paintTheme();
    });
    const inRoom = !!(ctx.room && ctx.room.id);
    ["row-defaults", "row-leave", "row-invite"].forEach((id) => {
      const el = $(id);
      if (el && !inRoom) el.hidden = true;
    });
    const roomsRow = $("row-rooms");
    if (roomsRow && ctx.rooms && !ctx.rooms.length && !inRoom) roomsRow.querySelector(".row-sub").textContent = "Join or create a room";
    $("profile-phone").value = ctx.profile.phone || "";
    $("profile-upi").value = ctx.profile.upi_id || "";
    $("profile-currency").innerHTML = MB.CURRENCIES.map((c) => `<option value="${c.code}">${c.code} (${c.symbol})</option>`).join("");
    $("profile-currency").value = MB.currency;
    const preview = $("avatar-preview");
    preview.innerHTML = ctx.profile.avatar_url
      ? `<img src="${escapeHtml(ctx.profile.avatar_url)}" alt="" loading="lazy">`
      : escapeHtml(MB.initials(fallbackName));
    if (!ctx.profile.avatar_url && MB.avatarHue) {
      preview.style.setProperty("--avatar-hue", String(MB.avatarHue(ctx.uid || fallbackName)));
    }
    if (ctx.profile.avatar_url) preview.className = "avatar avatar-lg";
    $("profile-avatar").addEventListener("change", async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      hideError("profile-error");
      try {
        const blob = await MB.compressImage(file, 256, 0.82);
        const path = ctx.uid + "/avatar.jpg";
        const { error: upErr } = await MB.client().storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        const { data } = MB.client().storage.from("avatars").getPublicUrl(path);
        const url = data.publicUrl + "?v=" + Date.now();
        const { error } = await MB.client().rpc("update_my_profile", { p_patch: { avatar_url: url } });
        if (error) throw error;
        preview.className = "avatar avatar-lg";
        preview.innerHTML = `<img src="${escapeHtml(url)}" alt="">`;
        MB.paintHeaderAvatar({ display_name: $("profile-name").value, avatar_url: url });
        $("profile-ok").hidden = false;
        $("profile-ok").textContent = "Photo updated.";
      } catch (err) {
        showError("profile-error", errorMessage(err));
      }
    });
    $("profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("profile-error");
      const name = $("profile-name").value.trim();
      const currency = $("profile-currency").value;
      const phone = $("profile-phone").value.trim();
      const upi = $("profile-upi").value.trim();
      if (!name) return showError("profile-error", "Enter a display name.");
      const { data, error } = await MB.client().rpc("update_my_profile", {
        p_patch: { display_name: name, currency, phone, upi_id: upi },
      });
      if (error) return showError("profile-error", errorMessage(error));
      MB.setCurrency(currency);
      $("profile-ok").hidden = false;
      $("profile-ok").textContent = "Saved.";
      if ($("profile-display-name")) $("profile-display-name").textContent = name;
      MB.paintHeaderAvatar(data || { display_name: name, avatar_url: ctx.profile.avatar_url });
    });
    MB.bindPasswordRules({ passwordId: "new-password", confirmId: "new-password-confirm", hintId: "pw-hint", matchId: "pw-match", min: 8 });
    $("password-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      hideError("pw-error");
      $("pw-ok").hidden = true;
      const password = $("new-password").value;
      const confirm = $("new-password-confirm").value;
      if (password.length < 8) return showError("pw-error", "Password must be at least 8 characters.");
      if (password !== confirm) return showError("pw-error", "Passwords do not match.");
      const { error } = await MB.client().auth.updateUser({ password });
      if (error) return showError("pw-error", errorMessage(error));
      $("pw-ok").hidden = false;
      $("pw-ok").textContent = "Password updated.";
      $("password-form").reset();
    });
    $("delete-account").addEventListener("click", async () => {
      const typed = prompt("This cannot be undone. Type DELETE to permanently remove your account.");
      if (typed !== "DELETE") return;
      hideError("delete-error");
      try {
        const { error } = await MB.client().rpc("delete_my_account");
        if (error) throw error;
        await MB.client().auth.signOut();
        location.replace("login.html");
      } catch (err) {
        showError("delete-error", errorMessage(err));
      }
    });
    await setupPushCard();

    $("logout").addEventListener("click", async () => {
      await MB.client().auth.signOut();
      location.replace("login.html");
    });
  }

  async function setupPushCard() {
    const status = $("push-status");
    const enable = $("push-enable");
    const disable = $("push-disable");
    const test = $("push-test");
    const hint = $("ios-push-hint");
    if (MB.isIosDevice()) hint.hidden = false;
    async function refresh() {
      hideError("push-error");
      const supported = "Notification" in window && "PushManager" in window && "serviceWorker" in navigator;
      if (!supported) {
        status.textContent = "This browser does not support phone notifications.";
        enable.disabled = true;
        return;
      }
      if (MB.isIosDevice() && !MB.isStandaloneApp()) {
        status.textContent = "Add Monthly Budget to your Home Screen first, then enable notifications from the installed app.";
      }
      const permission = Notification.permission;
      const sub = await MB.getPushSubscription().catch(() => null);
      if (permission === "granted" && sub) {
        status.textContent = "Phone notifications are on. New alerts will appear in the notification bar with the default sound.";
        enable.hidden = true;
        disable.hidden = false;
        test.hidden = false;
      } else if (permission === "denied") {
        status.textContent = "Notifications are blocked. Allow them in your browser or system settings, then come back here.";
        enable.hidden = false;
        disable.hidden = true;
        test.hidden = true;
      } else {
        status.textContent = "Phone notifications are off. Enable them to get alerts even when this tab is closed.";
        enable.hidden = false;
        disable.hidden = true;
        test.hidden = true;
      }
    }
    enable.addEventListener("click", async () => {
      hideError("push-error");
      $("push-ok").hidden = true;
      try {
        await MB.subscribePush();
        $("push-ok").hidden = false;
        $("push-ok").textContent = "Phone notifications enabled.";
        await refresh();
      } catch (err) {
        showError("push-error", errorMessage(err));
      }
    });
    disable.addEventListener("click", async () => {
      hideError("push-error");
      $("push-ok").hidden = true;
      try {
        await MB.unsubscribePush();
        $("push-ok").hidden = false;
        $("push-ok").textContent = "Phone notifications disabled on this device.";
        await refresh();
      } catch (err) {
        showError("push-error", errorMessage(err));
      }
    });
    test.addEventListener("click", async () => {
      hideError("push-error");
      $("push-ok").hidden = true;
      try {
        await MB.sendTestPush();
        $("push-ok").hidden = false;
        $("push-ok").textContent = "Test sent. Check your notification bar — and the in-app list.";
      } catch (err) {
        showError("push-error", errorMessage(err));
      }
    });
    await refresh();
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
