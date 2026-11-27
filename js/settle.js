(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, showError, hideError, errorMessage } = MB;
  async function main() {
    const ctx = await MB.bootApp({ title: "Settle up", month: true });
    if (!ctx) return;
    if (!ctx.room) { $("content").innerHTML = MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Once you share expenses, you can settle balances here.", href: "dashboard.html", cta: "Go to Home" }); return; }
    const members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    const { expenses, splits, settlements } = (ctx.expenses && ctx.splits && ctx.settlements) ? ctx : await MB.loadMonthData(ctx.room.id, ctx.month);
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const suggestions = (MB.myTransfers || function (bals, id, ex, sp, st) {
      return MB.settleSuggestions(bals, ex, sp, st).filter((t) => t.from.id === id || t.to.id === id);
    })(balances, ctx.uid, expenses, splits, settlements);
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const paying = suggestions.filter((t) => t.from.id === ctx.uid);
    const collecting = suggestions.filter((t) => t.to.id === ctx.uid);

    function otherMember(t) {
      const id = t.from.id === ctx.uid ? t.to.id : t.from.id;
      return byId[id] || { display_name: (t.from.id === ctx.uid ? t.to.name : t.from.name), id };
    }
    function transferCard(t) {
      const fromId = t.from.id;
      const toId = t.to.id;
      const iPay = fromId === ctx.uid;
      const other = otherMember(t);
      const otherName = other.display_name || (iPay ? t.to.name : t.from.name) || "Roommate";
      const pending = MB.pendingSettlementFor ? MB.pendingSettlementFor(settlements, fromId, toId, t.amount) : null;
      const role = iPay ? "You pay" : "pays you";
      const canPayUpi = iPay && !pending && other.upi_id;
      const cur = (ctx.room && ctx.room.currency) || "INR";
      const upi = canPayUpi
        ? "upi://pay?pa=" + encodeURIComponent(other.upi_id) + "&pn=" + encodeURIComponent(otherName) + "&cu=" + encodeURIComponent(cur) + "&am=" + encodeURIComponent(String(t.amount))
        : "";
      let actions = "";
      if (iPay && !pending) {
        actions = (canPayUpi ? `<a class="primary-btn" href="${upi}">Pay via UPI</a>` : "")
          + `<button type="button" class="secondary-btn" data-mark-paid>Mark as paid</button>`;
      } else if (iPay && pending) {
        actions = `<p class="transfer-wait">Waiting for ${escapeHtml(otherName)} to confirm</p>`;
      } else if (!iPay && pending) {
        actions = `<button type="button" class="primary-btn" data-confirm-received="${escapeHtml(pending.id)}">Confirm received</button><button type="button" class="secondary-btn" data-reject-received="${escapeHtml(pending.id)}">Didn't get it</button>`;
      } else {
        actions = `<p class="transfer-wait">Waiting for them to pay</p>`;
      }
      return `<article class="transfer-card" data-from="${escapeHtml(fromId)}" data-to="${escapeHtml(toId)}" data-amount="${escapeHtml(String(t.amount))}">
        <div class="transfer-flow">
          <div class="suggest-who">
            ${MB.avatarHtml ? MB.avatarHtml(other, "md") : MB.personChip(other, members, "md")}
            <div class="suggest-copy">
              <div class="suggest-name">${escapeHtml(otherName)}</div>
              <div class="suggest-role">${escapeHtml(role)}</div>
            </div>
          </div>
          <p class="transfer-amt">${escapeHtml(formatMoney(t.amount))}</p>
        </div>
        <div class="btn-row">${actions}</div>
      </article>`;
    }
    function section(title, rows) {
      if (!rows.length) return "";
      return `<div class="suggest-section"><h3>${escapeHtml(title)}</h3>${rows.map(transferCard).join("")}</div>`;
    }
    if (!suggestions.length) {
      $("suggest-list").innerHTML = MB.emptyState({ art: "images/illu-handshake.webp", title: "You're all settled", text: "You don't owe anyone, and no one owes you, for this month.", href: "dashboard.html", cta: "Back to Home" });
    } else {
      $("suggest-list").innerHTML = section("You pay", paying) + section("You're owed", collecting);
    }

    $("suggest-list").querySelectorAll("[data-mark-paid]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".transfer-card");
        if (!card) return;
        $("pay-from").value = ctx.uid;
        $("pay-to").value = card.getAttribute("data-to");
        $("pay-amount").value = card.getAttribute("data-amount");
        $("pay-date").value = MB.todayISO();
        paintUpi();
        $("pay-form").scrollIntoView({ behavior: "smooth", block: "start" });
        if ($("pay-note")) $("pay-note").focus();
        if ($("pay-proof-hint")) $("pay-proof-hint").textContent = "Optional. Attach a UPI, GPay, or bank screenshot of this payment.";
      });
    });
    async function respondSettlement(id, accept) {
      const { error } = await MB.client().rpc(accept ? "confirm_settlement" : "reject_settlement", accept
        ? { p_settlement_id: id, p_force: false }
        : { p_settlement_id: id });
      if (error) return MB.showPageError(errorMessage(error));
      location.reload();
    }
    $("suggest-list").querySelectorAll("[data-confirm-received]").forEach((btn) => {
      btn.addEventListener("click", () => respondSettlement(btn.getAttribute("data-confirm-received"), true));
    });
    $("suggest-list").querySelectorAll("[data-reject-received]").forEach((btn) => {
      btn.addEventListener("click", () => respondSettlement(btn.getAttribute("data-reject-received"), false));
    });

    if ($("pay-from-label")) $("pay-from-label").value = "You";
    $("pay-from").value = ctx.uid;
    const others = members.filter((m) => m.id !== ctx.uid);
    $("pay-to").innerHTML = others.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}</option>`).join("");
    if (others[0]) $("pay-to").value = others[0].id;
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

    function collectPayErrors() {
      const fromEl = $("pay-from");
      const toEl = $("pay-to");
      const amountEl = $("pay-amount");
      const dateEl = $("pay-date");
      const errors = [];
      if (!fromEl || !fromEl.value) errors.push({ el: fromEl, message: "You need to be signed in to record a payment." });
      if (!toEl || !toEl.value) errors.push({ el: toEl, message: "Choose who is receiving." });
      if (fromEl && toEl && fromEl.value && toEl.value && fromEl.value === toEl.value) {
        errors.push({ el: toEl, message: "Choose someone else to pay." });
      }
      const amount = Number(amountEl && amountEl.value);
      if (!amount || amount <= 0) errors.push({ el: amountEl, message: "Enter an amount greater than zero." });
      if (!dateEl || !dateEl.value) errors.push({ el: dateEl, message: "Pick a date." });
      return errors;
    }
    const validatePay = MB.bindFormValidation
      ? MB.bindFormValidation($("pay-form"), collectPayErrors, { button: $("pay-save") })
      : () => true;

    $("pay-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      hideError("pay-error");
      if (!validatePay(true)) return;
      const from = ctx.uid;
      const to = $("pay-to").value;
      const amount = Number($("pay-amount").value);
      const date = $("pay-date").value;
      const note = $("pay-note").value.trim();
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
        const toMember = members.find((m) => m.id === to);
        const toName = (toMember && toMember.display_name) || "this roommate";
        const owedRow = suggestions.find((s) => s.from.id === from && s.to.id === to);
        const owed = owedRow ? Number(owedRow.amount) : 0;
        if (owed > 0.005 && amount - owed > 0.5) {
          const ok = confirm(toName + " is owed " + formatMoney(owed) + ". This payment of " + formatMoney(amount) + " is more than that. Record it anyway?");
          if (!ok) return;
        } else if (owed <= 0.005 && amount > 0.5) {
          const netRow = balances.find((b) => b.id === from);
          const ok = confirm("There is no open balance to " + toName + " right now. Record a payment of " + formatMoney(amount) + " anyway?");
          if (!ok) return;
        }
        const cutoff = Date.now() - 30 * 60 * 1000;
        const similar = (settlements || []).filter((s) => {
          if (s.from_user !== from || s.to_user !== to) return false;
          if (s.status === "rejected" || s.status === "voided") return false;
          if (Math.abs(Number(s.amount) - amount) > 1.01) return false;
          const ts = s.created_at ? new Date(s.created_at).getTime() : 0;
          return ts && ts >= cutoff;
        });
        if (similar.length) {
          const last = similar[0];
          const ok = confirm("A similar payment of " + formatMoney(last.amount) + " was already recorded in the last 30 minutes. Record another?");
          if (!ok) return;
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

    const mineHistory = (settlements || []).filter((s) => s.from_user === ctx.uid || s.to_user === ctx.uid);
    const historyBits = await Promise.all(mineHistory.map(async (s) => {
      const pending = s.status === "pending";
      const rejected = s.status === "rejected";
      const voided = s.status === "voided";
      const canConfirm = pending && s.to_user === ctx.uid;
      const canUndo = !pending && !rejected && !voided && MB.canUndoSettlement && MB.canUndoSettlement(s, ctx.uid, ctx.room);
      const iPaid = s.from_user === ctx.uid;
      const status = pending
        ? (iPaid ? " · waiting for them to confirm" : " · waiting for you to confirm")
        : (rejected ? " · not received" : (voided ? " · undone" : " · confirmed"));
      let thumb = "";
      if (s.proof_path) {
        try {
          const url = await MB.signedReceiptUrl(s.proof_path);
          thumb = url ? MB.proofThumbHtml(url, "Payment screenshot") : "";
        } catch (e) { thumb = ""; }
      }
      const title = iPaid
        ? `You paid ${MB.personChip(s.to_user, members, "sm")}`
        : `${MB.personChip(s.from_user, members, "sm")} paid you`;
      const actions = canConfirm
        ? `<div class="btn-row compact"><button type="button" class="text-btn" data-confirm="${escapeHtml(s.id)}">Confirm received</button><button type="button" class="text-btn" data-reject="${escapeHtml(s.id)}">Didn't get it</button></div>`
        : (canUndo ? `<div class="btn-row compact"><button type="button" class="text-btn is-danger" data-undo="${escapeHtml(s.id)}">Undo</button></div>` : "");
      return `<div class="list-item">
        <div class="item-icon">₹</div>
        <div>
          <div class="item-title">${title}</div>
          <div class="item-sub">${escapeHtml(MB.friendlyDate(s.date))}${s.note ? " · " + escapeHtml(s.note) : ""}${status}</div>
          ${thumb}
          ${actions}
        </div>
        <div class="item-amt ${pending || rejected || voided ? "" : "pos"}">${escapeHtml(formatMoney(s.amount))}</div>
      </div>`;
    }));
    $("history").innerHTML = historyBits.length ? historyBits.join("") : MB.emptyState({ art: "images/illu-house.webp", title: "No payments yet", text: "When you pay a roommate, or someone pays you, the record will show up here." });
    if (MB.bindProofLightbox) MB.bindProofLightbox($("history"));
    $("history").querySelectorAll("[data-confirm]").forEach((btn) => {
      btn.addEventListener("click", () => respondSettlement(btn.getAttribute("data-confirm"), true));
    });
    $("history").querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", () => respondSettlement(btn.getAttribute("data-reject"), false));
    });
    $("history").querySelectorAll("[data-undo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-undo");
        const row = mineHistory.find((s) => s.id === id);
        if (!row || !MB.promptUndoSettlement) return;
        try {
          const ok = await MB.promptUndoSettlement(row, members);
          if (ok) location.reload();
        } catch (err) {
          if (MB.showToast) MB.showToast(errorMessage(err), "error");
        }
      });
    });
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
