(() => {
  const { bootAuthPage, client, showError, hideError, errorMessage, $, safeNextPath, originUrl } = window.MB;
  const nextPath = safeNextPath(new URLSearchParams(location.search).get("next"));
  const switchLink = document.getElementById("auth-switch-link");
  if (switchLink && nextPath && nextPath !== "dashboard.html") {
    switchLink.href = "signup.html?next=" + encodeURIComponent(nextPath);
  }
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError("auth-error");
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
      const { error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw error;
      location.replace(nextPath);
    } catch (err) {
      showError("auth-error", errorMessage(err));
    } finally {
      btn.disabled = false;
    }
  });
  const forgotBtn = $("forgot-btn");
  const forgotForm = $("forgot-form");
  const loginForm = document.getElementById("login-form");
  if (forgotBtn && forgotForm) {
    forgotBtn.addEventListener("click", () => {
      loginForm.hidden = true;
      forgotForm.hidden = false;
      $("forgot-email").value = $("auth-email").value;
      $("auth-error").hidden = true;
      const ok = $("auth-ok"); if (ok) ok.hidden = true;
    });
    $("forgot-cancel").addEventListener("click", () => {
      forgotForm.hidden = true;
      loginForm.hidden = false;
    });
    forgotForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideError("auth-error");
      const ok = $("auth-ok"); if (ok) { ok.hidden = true; ok.textContent = ""; }
      const email = ($("forgot-email").value || $("auth-email").value || "").trim();
      if (!email) return showError("auth-error", "Enter the email on your account.");
      $("forgot-submit").disabled = true;
      try {
        const { error } = await client().auth.resetPasswordForEmail(email, {
          redirectTo: originUrl("reset-password.html"),
        });
        if (error) throw error;
        if (ok) {
          ok.hidden = false;
          ok.className = "form-ok";
          ok.textContent = "If an account exists for that email, a reset link is on its way. Check your inbox (and spam). Supabase's built-in email has a low hourly limit.";
        }
      } catch (err) {
        showError("auth-error", errorMessage(err));
      } finally {
        $("forgot-submit").disabled = false;
      }
    });
  }
  bootAuthPage();
})();

