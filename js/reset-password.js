(() => {
  const { client, showError, hideError, errorMessage, $, bindPasswordRules, enhancePasswordFields } = window.MB;
  bindPasswordRules({ passwordId: "auth-password", confirmId: "auth-confirm", hintId: "pw-hint", matchId: "pw-match", min: 8 });
  enhancePasswordFields();

  let ready = false;
  client().auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" || (session && event === "SIGNED_IN")) ready = true;
  });
  client().auth.getSession().then(({ data }) => {
    if (data && data.session) ready = true;
  });

  document.getElementById("reset-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    hideError("auth-error");
    const password = $("auth-password").value;
    const confirm = $("auth-confirm").value;
    if (password.length < 8) return showError("auth-error", "Password must be at least 8 characters.");
    if (password !== confirm) return showError("auth-error", "Passwords do not match.");
    const { data } = await client().auth.getSession();
    if (!(data && data.session) && !ready) {
      return showError("auth-error", "Open this page from the reset link in your email. That link expires, so request a new one if it is old.");
    }
    const btn = $("auth-submit");
    btn.disabled = true;
    try {
      const { error } = await client().auth.updateUser({ password });
      if (error) throw error;
      $("auth-ok").hidden = false;
      $("auth-ok").textContent = "Password updated. You can log in with it now.";
      setTimeout(() => { location.replace("dashboard.html"); }, 800);
    } catch (err) {
      showError("auth-error", errorMessage(err));
    } finally {
      btn.disabled = false;
    }
  });
})();
