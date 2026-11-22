(() => {
  const { bootAuthPage, client, showError, hideError, errorMessage, $, safeNextPath } = window.MB;
  const params = new URLSearchParams(location.search);
  const nextPath = safeNextPath(params.get("next"));
  const switchLink = document.getElementById("auth-switch-link");
  if (switchLink && nextPath && nextPath !== "dashboard.html") {
    switchLink.href = "login.html?next=" + encodeURIComponent(nextPath);
  }
  if (params.get("code")) {
    try { sessionStorage.setItem("monthly-budget-pending-code", params.get("code").toUpperCase()); } catch (e) {}
  }
  document.getElementById("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError("auth-error");
    const name = $("auth-name").value.trim();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const confirm = $("auth-confirm").value;
    if (!name) return showError("auth-error", "Enter a display name.");
    if (password.length < 8) return showError("auth-error", "Password must be at least 8 characters.");
    if (password !== confirm) return showError("auth-error", "Passwords do not match.");
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
      const { data, error } = await client().auth.signUp({
        email, password, options: { data: { display_name: name } },
      });
      if (error) throw error;
      if (!data.session) {
        showError("auth-ok", "Account created. Please log in.");
        $("auth-ok").hidden = false;
        $("auth-ok").className = "form-ok";
        setTimeout(() => { location.href = "login.html?next=" + encodeURIComponent(nextPath); }, 800);
        return;
      }
      location.replace(nextPath);
    } catch (err) {
      showError("auth-error", errorMessage(err));
    } finally {
      btn.disabled = false;
    }
  });
  window.MB.bindPasswordRules({ passwordId: "auth-password", confirmId: "auth-confirm", hintId: "pw-hint", matchId: "pw-match", min: 8 });
  bootAuthPage();
})();
