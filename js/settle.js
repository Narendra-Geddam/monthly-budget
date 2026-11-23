(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, showError, hideError, errorMessage } = MB;
  async function main() {
    const ctx = await MB.bootApp({ title: "Settle up", month: true });
    if (!ctx) return;
    if (!ctx.room) { $("content").innerHTML = MB.emptyState({ emoji: "🏠", title: "Join a room first", text: "Once you share expenses, you can settle balances here.", href: "dashboard.html", cta: "Go to Home" }); return; }
    const members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    const { expenses, splits, settlements } = (ctx.expenses && ctx.splits && ctx.settlements) ? ctx : await MB.loadMonthData(ctx.room.id, ctx.month);
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const suggestions = MB.settleSuggestions(balances);
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    $("suggest-list").innerHTML = suggestions.length ? suggestions.map((t) => {
      const from = byId[t.from.id] || { display_name: t.from.name, id: t.from.id };
      const to = byId[t.to.id] || { display_name: t.to.name, id: t.to.id };
      const fromName = from.display_name || t.from.name;
      const toName = to.display_name || t.to.name;
      const canPayUpi = to.upi_id && t.from.id === ctx.uid;
      const cur = (ctx.room && ctx.room.currency) || "INR";
      const upi = canPayUpi
        ? "upi://pay?pa=" + encodeURIComponent(to.upi_id) + "&pn=" + encodeURIComponent(toName || "Roommate") + "&cu=" + encodeURIComponent(cur) + "&am=" + encodeURIComponent(String(t.amount))
        : "";
      const upiBtn = canPayUpi ? `<a class="primary-btn" href="${upi}">Pay via UPI</a>` : "";
      return `<article class="transfer-card" data-from="${escapeHtml(t.from.id)}" data-to="${escapeHtml(t.to.id)}" data-amount="${escapeHtml(String(t.amount))}">
        <div class="transfer-flow">
          <div class="transfer-person">${MB.personChip(from, members, "avatar-row")}${t.from.id === ctx.uid ? " (you)" : ""}</div>
          <span class="transfer-arrow" aria-hidden="true">→</span>
          <div class="transfer-person">${MB.personChip(to, members, "avatar-row")}${t.to.id === ctx.uid ? " (you)" : ""}</div>
        </div>
        <p class="transfer-amt">${escapeHtml(formatMoney(t.amount))}</p>
        <div class="btn-row">
          ${upiBtn}
          <button type="button" class="secondary-btn" data-mark-paid>Mark as paid</button>
        </div>
      </article>`;
    }).join("") : MB.emptyState({ emoji: "🎉", title: "You're all settled", text: "No one in this room owes anyone for this month.", href: "dashboard.html", cta: "Back to Home" });

    $("suggest-list").querySelectorAll("[data-mark-paid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".transfer-card");
        if (!card) return;
        $("pay-from").value = card.getAttribute("data-from");
        $("pay-to").value = card.getAttribute("data-to");
        $("pay-amount").value = card.getAttribute("data-amount");
        $("pay-date").value = MB.todayISO();
        paintUpi();
        $("pay-form").scrollIntoView({ behavior: "smooth", block: "start" });
        if ($("pay-note")) $("pay-note").focus();
        if ($("pay-proof-hint")) $("pay-proof-hint").textContent = "Optional. Attach a UPI, GPay, or bank screenshot of this payment.";
      });
    });

    const opts = members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}${m.id === ctx.uid ? " (you)" : ""}</option>`).join("");
    $("pay-from").innerHTML = opts;
    $("pay-to").innerHTML = opts;
    $("pay-from").value = ctx.uid;
    const other = members.find((m) => m.id !== ctx.uid);
    if (other) $("pay-to").value = other.id;
    $("pay-date").value = MB.todayISO();

    function paintUpi() {
      const box = $("upi-pay");
      if (!box) return;
      const to = members.find((m) => m.id === $("pay-to").value);
      const amount = Number($("pay-amount").value) || 0;
      if (!to || !to.upi_id || to.id === ctx.uid) { box.hidden = true; box.innerHTML = ""; return; }
      const cur = (ctx.room && ctx.room.currency) || "INR";
      const url = "upi://pay?pa=" + encodeURIComponent(to.upi_id) + "&pn=" + encodeURIComponent(to.display_name || "Roommate") + "&cu=" + encodeURIComponent(cur) + (amount ? "&am=" + encodeURIComponent(String(amount)) : "");
      box.hidden = false;
      box.innerHTML = `<a class="primary-btn" href="${url}">Pay ${escapeHtml(to.display_name)} via UPI</a><p class="card-sub">${escapeHtml(to.upi_id)}</p>`;
    }
    $("pay-to").addEventListener("change", paintUpi);
    $("pay-amount").addEventListener("input", paintUpi);
    paintUpi();

    let proofBlob = null;
    const proofInput = $("pay-proof");
    const proofPreview = $("pay-proof-preview");
    if (proofInput) {
      proofInput.addEventListener("change", async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        hideError("pay-error");
        try {
          proofBlob = await MB.compressImage(file, 1280, 0.8, { fit: true });
          if (proofPreview) {
            proofPreview.src = URL.createObjectURL(proofBlob);
            proofPreview.hidden = false;
          }
        } catch (err) {
          proofBlob = null;
          showError("pay-error", errorMessage(err) || "Could not read that screenshot. Try a JPEG or PNG.");
        }
      });
    }

    $("pay-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideError("pay-error");
      const from = $("pay-from").value;
      const to = $("pay-to").value;
      const amount = Number($("pay-amount").value);
      const date = $("pay-date").value;
      const note = $("pay-note").value.trim();
      if (from === to) return showError("pay-error", "Choose two different people.");
      if (!amount || amount <= 0) return showError("pay-error", "Enter an amount greater than zero.");
      let proofPath = null;
      try {
        if (proofBlob) {
          proofPath = ctx.room.id + "/" + Date.now() + "-payment.jpg";
          const { error: upErr } = await MB.client().storage.from("receipts").upload(proofPath, proofBlob, {
            upsert: true,
            contentType: "image/jpeg",
            cacheControl: "3600",
          });
          if (upErr) throw upErr;
        }
        const { error } = await MB.client().rpc("record_settlement", {
          p_room_id: ctx.room.id, p_from: from, p_to: to, p_amount: amount, p_date: date, p_note: note || null,
          p_proof_path: proofPath,
        });
        if (error) throw error;
        location.reload();
      } catch (err) {
        showError("pay-error", errorMessage(err));
        if (MB.showToast) MB.showToast(errorMessage(err), "error");
      }
    });

    const historyBits = await Promise.all((settlements || []).map(async (s) => {
      const pending = s.status === "pending";
      const canConfirm = pending && (s.to_user === ctx.uid || ctx.isAdmin);
      const status = pending ? " · waiting to be marked received" : " · confirmed";
      const force = pending && ctx.isAdmin && s.to_user !== ctx.uid;
      let thumb = "";
      if (s.proof_path) {
        try {
          const url = await MB.signedReceiptUrl(s.proof_path);
          thumb = url ? MB.proofThumbHtml(url, "Payment screenshot") : "";
        } catch (e) { thumb = ""; }
      }
      return `<div class="list-item">
        <div class="item-icon">₹</div>
        <div>
          <div class="item-title">${MB.personChip(s.from_user, members, "avatar-sm")} paid ${MB.personChip(s.to_user, members, "avatar-sm")}</div>
          <div class="item-sub">${escapeHtml(MB.friendlyDate(s.date))}${s.note ? " · " + escapeHtml(s.note) : ""}${status}</div>
          ${thumb}
          ${canConfirm ? `<button type="button" class="text-btn" data-confirm="${escapeHtml(s.id)}" data-force="${force ? "1" : "0"}">Mark as received</button>` : ""}
        </div>
        <div class="item-amt ${pending ? "" : "pos"}">${escapeHtml(formatMoney(s.amount))}</div>
      </div>`;
    }));
    $("history").innerHTML = historyBits.length ? historyBits.join("") : MB.emptyState({ emoji: "💸", title: "No payments yet", text: "When someone pays a roommate, the record will show up here." });
    if (MB.bindProofLightbox) MB.bindProofLightbox($("history"));
    $("history").querySelectorAll("[data-confirm]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const { error } = await MB.client().rpc("confirm_settlement", {
          p_settlement_id: btn.getAttribute("data-confirm"),
          p_force: btn.getAttribute("data-force") === "1",
        });
        if (error) return MB.showPageError(errorMessage(error));
        location.reload();
      });
    });
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
