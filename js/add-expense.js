(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, equalSplits, showError, hideError, errorMessage } = MB;
  const PERSONAL_EXPENSE_CATS = (MB.PERSONAL_EXPENSE_CATS && MB.PERSONAL_EXPENSE_CATS.slice()) || (MB.CATEGORIES || []).slice();
  const INCOME_CATS = (MB.INCOME_CATS && MB.INCOME_CATS.slice()) || ["Salary", "Freelance", "Refund", "Gift", "Interest", "Other"];
  let members = [];
  let splitMode = "all";
  let editing = null;

  function selectedMemberIds() {
    if (splitMode === "all") return members.map((m) => m.id);
    const boxes = [...document.querySelectorAll("[data-split-id]")];
    if (!boxes.length) return initialSelected ? members.map((m) => m.id).filter((id) => initialSelected.has(id)) : members.map((m) => m.id);
    return boxes.filter((el) => el.checked).map((el) => el.getAttribute("data-split-id"));
  }


  let isManager = false;
  let initialSelected = null;
  const STATUS_LABEL = { paid: "Paid", pending: "Waiting", accepted: "Accepted", declined: "Declined" };
  const STATUS_RANK = { paid: 0, pending: 1, declined: 2, accepted: 3 };

  function statusFor(userId) {
    if (!editing) return null;
    const row = (editing.splits || []).find((s) => s.user_id === userId);
    return row ? row.status : null;
  }

  function payerId() {
    const el = $("exp-paid-by");
    return (el && el.value) || (editing && editing.paid_by) || MB.uid();
  }

  // paid | pending | accepted | declined | null (not part of this expense yet)
  function shareStatusKey(userId) {
    if (userId === payerId()) return "paid";
    if (!editing || editing.personal) return null;
    const row = (editing.splits || []).find((s) => s.user_id === userId);
    if (!row) return null;
    const k = MB.splitStatusKey ? MB.splitStatusKey(row) : (row.status || "pending");
    return k === "forced" ? "accepted" : (STATUS_LABEL[k] ? k : "pending");
  }

  function nameOf(m) {
    return (m && (MB.displayName ? MB.displayName(m.id, members) : m.display_name)) || "Member";
  }

  // Payer first, then people still to respond, then declined, then accepted; names A–Z within each.
  function orderedMembers() {
    const pid = payerId();
    return members.slice().sort((a, b) => {
      if (a.id === pid) return -1;
      if (b.id === pid) return 1;
      if (editing && !editing.personal) {
        const ra = STATUS_RANK[shareStatusKey(a.id)] ?? 4;
        const rb = STATUS_RANK[shareStatusKey(b.id)] ?? 4;
        if (ra !== rb) return ra - rb;
      }
      return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" });
    });
  }

  function statusPill(userId) {
    const st = shareStatusKey(userId);
    if (!st || (!editing && st !== "paid")) return "";
    const cls = st === "paid" ? "is-paid" : "is-" + st;
    return `<span class="status-pill ${cls}">${STATUS_LABEL[st]}</span>`;
  }

  function refreshStatusPanel() {
    const notice = $("decline-notice");
    const panel = $("split-status");
    if (panel) { panel.hidden = true; panel.innerHTML = ""; }
    if (!editing) {
      if (notice) notice.hidden = true;
      return;
    }
    const declined = (editing.splits || []).filter((s) => s.status === "declined");
    if (notice) {
      if (declined.length) {
        notice.hidden = false;
        const names = declined.map((s) => {
          const m = members.find((x) => x.id === s.user_id);
          return (m && m.display_name) || "A roommate";
        }).join(", ");
        notice.textContent = names + " declined this split. You can edit who is included; shares are not redistributed automatically.";
      } else {
        notice.hidden = true;
      }
    }
  }

  function shareRowHtml(m, opts) {
    const pid = payerId();
    const isPayer = m.id === pid;
    const st = shareStatusKey(m.id);
    const you = m.id === MB.uid() ? ` <span class="you-tag">(you)</span>` : "";
    const amountText = opts.amount != null && opts.amount > 0
      ? "share " + formatMoney(opts.amount)
      : (isPayer ? "no share" : "not included");
    const payerExtra = "";
    const meta = opts.hideAmount ? `${statusPill(m.id)}` : `${statusPill(m.id)}<span>${escapeHtml(payerExtra + amountText)}</span>`;
    const canForce = editing && !editing.personal && isManager && !isPayer && (st === "pending" || st === "declined");
    const action = canForce
      ? `<button type="button" class="outline-btn share-force" data-force="${escapeHtml(m.id)}" aria-label="Mark ${escapeHtml(nameOf(m))}'s share as accepted">Mark as accepted</button>`
      : "";
    return `<div class="split-member-row share-row${isPayer ? " is-payer" : ""}">
      <label class="share-main">${opts.control || ""}${MB.avatarHtml ? MB.avatarHtml(m, "sm") : ""}
        <span class="share-text"><span class="share-name"><span class="share-name-text">${escapeHtml(nameOf(m))}</span>${you}</span>
        <span class="share-meta">${meta}</span></span>
        ${opts.input || ""}
      </label>${action}</div>`;
  }

  function paintSplitSummary(shares) {
    const el = $("split-summary");
    if (!el) return;
    if (splitMode === "custom") {
      el.textContent = (document.querySelector("[data-item-row]") && collectItems().length ? "From items · " : "Custom amounts · ") + shares.filter((s) => s.share_amount > 0).length + " people";
      return;
    }
    const amts = shares.map((s) => Number(s.share_amount)).filter((x) => x > 0);
    if (!amts.length) { el.textContent = ""; return; }
    const each = Math.min(...amts);
    el.textContent = amts.length === 1
      ? "One person · " + formatMoney(each)
      : (splitMode === "all" ? "Split equally" : "Split equally between " + amts.length) + " · " + formatMoney(each) + " each";
  }

  function renderSplitUi() {
    const amount = Number($("exp-amount").value) || 0;
    const host = $("split-box");
    host.className = "split-member-list";
    const list = orderedMembers();
    if (splitMode === "custom") {
      const current = {};
      document.querySelectorAll("[data-custom-id]").forEach((el) => { current[el.getAttribute("data-custom-id")] = el.value; });
      if (!Object.keys(current).length && editing) {
        (editing.splits || []).forEach((s) => { current[s.user_id] = s.share_amount; });
      }
      host.innerHTML = list.map((m) => shareRowHtml(m, {
        hideAmount: true,
        input: `<input type="number" min="0" step="0.01" inputmode="decimal" data-custom-id="${escapeHtml(m.id)}" value="${escapeHtml(current[m.id] != null ? String(current[m.id]) : "")}" placeholder="0.00" aria-label="${escapeHtml(nameOf(m))} share" />`,
      })).join("") + `<p class="card-sub" id="split-sum"></p>`;
      host.querySelectorAll("[data-custom-id]").forEach((el) => el.addEventListener("input", () => { updateSplitSum(); paintSplitSummary(collectSplits()); }));
      updateSplitSum();
      paintSplitSummary(collectSplits());
      if (typeof validateExpense === "function") validateExpense(false);
      return;
    }
    const ids = selectedMemberIds();
    const shares = equalSplits(amount, members.map((m) => m.id).filter((id) => ids.includes(id)));
    host.innerHTML = list.map((m) => {
      const share = shares.find((s) => s.user_id === m.id);
      const checked = ids.includes(m.id) ? "checked" : "";
      const box = splitMode === "selected" ? `<input type="checkbox" data-split-id="${escapeHtml(m.id)}" ${checked} aria-label="Include ${escapeHtml(nameOf(m))}" />` : "";
      return shareRowHtml(m, { control: box, amount: share ? share.share_amount : null });
    }).join("");
    if (splitMode === "selected") {
      host.querySelectorAll("[data-split-id]").forEach((el) => el.addEventListener("change", renderSplitUi));
    }
    paintSplitSummary(shares);
    if (typeof validateExpense === "function") validateExpense(false);
  }

  function updateSplitSum() {
    const amount = Number($("exp-amount").value) || 0;
    const sum = [...document.querySelectorAll("[data-custom-id]")].reduce((s, el) => s + (Number(el.value) || 0), 0);
    const el = $("split-sum");
    if (!el) return;
    const diff = Math.round((sum - amount) * 100) / 100;
    el.textContent = diff === 0 ? "Splits add up to the amount." : `Splits total ${formatMoney(sum)} (${diff > 0 ? "over" : "under"} by ${formatMoney(Math.abs(diff))}).`;
  }

  function collectSplits() {
    const amount = Number($("exp-amount").value) || 0;
    if (splitMode === "custom") {
      return [...document.querySelectorAll("[data-custom-id]")].map((el) => ({
        user_id: el.getAttribute("data-custom-id"),
        share_amount: Math.round((Number(el.value) || 0) * 100) / 100,
      })).filter((s) => s.share_amount > 0);
    }
    return equalSplits(amount, selectedMemberIds());
  }


  function fillPersonalCategories() {
    const typ = $("per-type").value;
    const list = typ === "income" ? INCOME_CATS : PERSONAL_EXPENSE_CATS;
    const catEl = $("exp-category");
    if (MB.fillCategorySelect) MB.fillCategorySelect(catEl, list, catEl && catEl.value);
    else catEl.innerHTML = list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (MB.bindCategoryPicker) MB.bindCategoryPicker(catEl);
  }

  function setKind(next, ctx) {
    kind = next;
    document.querySelectorAll("#kind-toggle [data-kind]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-kind") === next));
    $("personal-fields").hidden = next !== "personal";
    $("room-fields").hidden = next !== "room";
    const paid = $("exp-paid-by");
    if (paid) paid.required = next === "room";
    if (next === "personal") fillPersonalCategories();
    else if (ctx && ctx.room) {
      const catEl = $("exp-category");
      if (MB.fillCategorySelect) MB.fillCategorySelect(catEl, (MB.pickerCategories || MB.roomCategories)(ctx.room), catEl && catEl.value);
      else catEl.innerHTML = MB.roomCategories(ctx.room).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      if (MB.bindCategoryPicker) MB.bindCategoryPicker(catEl);
    }
    if (MB.decorateRequiredFields) MB.decorateRequiredFields($("expense-form"));
    if (typeof validateExpense === "function") validateExpense(false);
  }

  function collectExpenseErrors() {
    const errors = [];
    const amountEl = $("exp-amount");
    const descEl = $("exp-desc");
    const catEl = $("exp-category");
    const dateEl = $("exp-date");
    const paidEl = $("exp-paid-by");
    const amount = Number(amountEl && amountEl.value);
    const description = descEl ? descEl.value.trim() : "";
    const category = catEl ? catEl.value : "";
    const date = dateEl ? dateEl.value : "";
    if (!amount || amount <= 0) errors.push({ el: amountEl, message: "Enter an amount greater than zero." });
    if (!description) errors.push({ el: descEl, message: "Add a short description." });
    if (!category) errors.push({ el: catEl, message: "Choose a category." });
    if (!date) errors.push({ el: dateEl, message: "Pick a date." });
    if (kind === "room") {
      if (!paidEl || !paidEl.value) errors.push({ el: paidEl, message: "Choose who paid." });
      const items = collectItems();
      let splits = collectSplits();
      if (items.length && typeof MB.itemizedSplits === "function") {
        const tax = Number($("exp-tax") && $("exp-tax").value) || 0;
        const tip = Number($("exp-tip") && $("exp-tip").value) || 0;
        splits = MB.itemizedSplits(items, tax, tip);
        const itemTotal = splits.reduce((acc, x) => acc + Number(x.share_amount), 0);
        if (amount > 0 && Math.abs(itemTotal - amount) > 0.02) {
          errors.push({ el: amountEl, message: "Items + tax + tip (" + formatMoney(itemTotal) + ") must match the bill amount." });
        }
      }
      const splitHost = $("split-box") || $("split-error");
      if (!splits.length) {
        errors.push({
          el: splitHost,
          message: splitMode === "selected" ? "Select at least one roommate." : "Choose at least one roommate to split with.",
        });
      } else if (!items.length && amount > 0) {
        const sum = splits.reduce((acc, x) => acc + Number(x.share_amount), 0);
        if (Math.abs(sum - amount) > 0.02) {
          errors.push({ el: splitHost, message: "Custom split amounts must add up to the total." });
        }
      }
      const roomCur = (window._mbRoomCurrency || MB.currency);
      const expCur = ($("exp-currency") && $("exp-currency").value) || roomCur;
      if (expCur && roomCur && expCur !== roomCur) {
        const fxEl = $("exp-fx-rate");
        if (!Number(fxEl && fxEl.value)) errors.push({ el: fxEl, message: "Enter or fetch an exchange rate." });
      }
    }
    return errors;
  }

  let validateExpense = (focus) => {
    const errors = collectExpenseErrors();
    const ok = !errors.some((e) => e && e.message);
    const form = $("expense-form");
    if (MB.applyFormErrors && form) {
      if (focus || (form.querySelector && form.querySelector(".field-error:not([hidden])"))) {
        return MB.applyFormErrors(form, errors, { button: $("exp-save"), focus: !!focus });
      }
    }
    const btn = $("exp-save");
    if (btn) btn.disabled = !ok;
    return ok;
  };

  async function savePersonal() {
    const amount = Number($("exp-amount").value);
    const description = $("exp-desc").value.trim();
    const category = $("exp-category").value;
    const date = $("exp-date").value;
    const type = $("per-type").value;
    if (!amount || amount <= 0) return showError("form-error", "Enter an amount greater than zero.");
    if (!description) return showError("form-error", "Add a short description.");
    const btn = $("exp-save");
    btn.disabled = true;
    try {
      if (editing && editing.personal) {
        const { error } = await MB.client().from("transactions").update({
          type, amount, category, date, note: description,
        }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await MB.client().from("transactions").insert({
          user_id: MB.uid(), type, amount, category, date, note: description,
        });
        if (error) throw error;
      }
      location.href = "personal.html";
    } catch (err) {
      showError("form-error", errorMessage(err));
    } finally {
      btn.disabled = false;
    }
  }

  async function save(event) {
    event.preventDefault();
    hideError("form-error");
    if (!validateExpense(true)) return;
    if (kind === "personal") return savePersonal();
    const description = $("exp-desc").value.trim();
    const category = $("exp-category").value;
    const date = $("exp-date").value;
    const paidBy = $("exp-paid-by").value;
    const tax = Number($("exp-tax") && $("exp-tax").value) || 0;
    const tip = Number($("exp-tip") && $("exp-tip").value) || 0;
    const items = collectItems();
    const roomCur = (window._mbRoomCurrency || MB.currency);
    const expCur = ($("exp-currency") && $("exp-currency").value) || roomCur;
    let amount = Number($("exp-amount").value);
    let originalAmount = null, originalCurrency = null, fxRate = null;
    if (expCur && roomCur && expCur !== roomCur) {
      fxRate = Number($("exp-fx-rate").value);
      if (!fxRate) return showError("form-error", "Enter or fetch an exchange rate.");
      originalAmount = amount;
      originalCurrency = expCur;
      amount = Math.round(originalAmount * fxRate * 100) / 100;
    }
    let splits = collectSplits();
    if (items.length) {
      const parts = MB.itemizedSplits(items, tax, tip);
      splits = parts;
      const itemSum = Math.round(parts.reduce((s, x) => s + x.share_amount, 0) * 100) / 100;
      if (!amount) amount = itemSum;
    } else if (originalCurrency && originalCurrency !== roomCur) {
      // Recompute equal/selected shares in room currency after conversion.
      if (splitMode !== "custom") splits = equalSplits(amount, selectedMemberIds());
      else splits = splits.map((s) => ({ ...s, share_amount: Math.round(s.share_amount * fxRate * 100) / 100 }));
    }
    if (!amount || amount <= 0) return showError("form-error", "Enter an amount greater than zero.");
    if (!description) return showError("form-error", "Add a short description.");
    if (!date) return showError("form-error", "Pick a date.");
    if (!splits.length) return showError("form-error", "Choose at least one roommate to split with.");
    const sum = splits.reduce((s, x) => s + x.share_amount, 0);
    if (Math.abs(sum - amount) > 0.02) return showError("form-error", "Splits must add up to the expense amount.");
    const btn = $("exp-save");
    btn.disabled = true;
    try {
      let receiptPath = window._mbReceiptPath || (editing && editing.receipt_path) || null;
      if (window._mbReceiptBlob && !editing) {
        const path = MB.getActiveRoomId() + "/" + Date.now() + "-receipt.jpg";
        const { error: upErr } = await MB.client().storage.from("receipts").upload(path, window._mbReceiptBlob, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw upErr;
        receiptPath = path;
      }
      const args = {
        p_paid_by: paidBy,
        p_amount: amount,
        p_description: description,
        p_category: category,
        p_date: date,
        p_splits: splits,
        p_original_amount: originalAmount,
        p_original_currency: originalCurrency,
        p_fx_rate: fxRate,
        p_receipt_path: receiptPath,
        p_items: items.length ? items : null,
        p_tax: tax,
        p_tip: tip,
      };
      if (editing) {
        const { error } = await MB.client().rpc("update_expense", { p_expense_id: editing.id, p_paid_by: paidBy, p_amount: amount, p_description: description, p_category: category, p_date: date, p_splits: splits });
        if (error) throw error;
      } else {
        const { error } = await MB.client().rpc("add_expense", { p_room_id: MB.getActiveRoomId(), ...args });
        if (error) throw error;
      }
      location.href = "dashboard.html";
    } catch (err) {
      showError("form-error", errorMessage(err));
    } finally {
      btn.disabled = false;
    }
  }

  async function removeExpense() {
    if (!editing) return;
    if (!confirm("Delete this expense? This cannot be undone.")) return;
    if (editing.personal) {
      const { error } = await MB.client().from("transactions").delete().eq("id", editing.id);
      if (error) return showError("form-error", errorMessage(error));
      location.href = "personal.html";
      return;
    }
    const { error } = await MB.client().rpc("delete_expense", { p_expense_id: editing.id });
    if (error) return showError("form-error", errorMessage(error));
    location.href = "activity.html?kind=expenses";
  }


  function collectItems() {
    const rows = [...document.querySelectorAll("[data-item-row]")];
    return rows.map((row, idx) => {
      const amount = Number(row.querySelector("[data-item-amt]").value) || 0;
      const description = (row.querySelector("[data-item-desc]").value || "").trim();
      const member_ids = [...row.querySelectorAll("[data-item-mem]:checked")].map((el) => el.value);
      return { description, amount, member_ids, sort_order: idx };
    }).filter((it) => it.amount > 0 && it.member_ids.length);
  }

  function addItemRow(item) {
    const first = !document.querySelector("[data-item-row]");
    item = item || { description: "", amount: "", member_ids: members.map((m) => m.id) };
    const row = document.createElement("div");
    row.className = "item-block";
    row.setAttribute("data-item-row", "1");
    row.innerHTML = `<div class="item-row">
        <label class="field"><span>Item</span><input type="text" data-item-desc value="${escapeHtml(item.description || "")}" placeholder="${first ? "e.g. Pizza" : "e.g. Cold drink"}" /></label>
        <label class="field"><span>Amount</span><input type="number" min="0" step="0.01" inputmode="decimal" data-item-amt value="${escapeHtml(item.amount === "" ? "" : String(item.amount))}" placeholder="${first ? "400" : "60"}" /></label>
        <button type="button" class="text-btn" data-item-del aria-label="Remove item">Remove</button>
      </div>
      <p class="item-who-label">Who shared it?</p>
      <div class="item-members">${orderedMembers().map((m) => {
        const on = (item.member_ids || []).includes(m.id) ? "checked" : "";
        return `<label class="chip"><input type="checkbox" data-item-mem value="${escapeHtml(m.id)}" ${on} /> ${escapeHtml(nameOf(m))}</label>`;
      }).join("")}</div>`;
    $("item-list").appendChild(row);
    row.querySelector("[data-item-del]").addEventListener("click", () => { row.remove(); paintItemSum(); });
    row.querySelectorAll("input").forEach((el) => el.addEventListener("input", paintItemSum));
    row.querySelectorAll("input[type=checkbox]").forEach((el) => el.addEventListener("change", paintItemSum));
    paintItemSum();
  }

  function itemizeTotals() {
    const items = collectItems();
    const tax = Number($("exp-tax") && $("exp-tax").value) || 0;
    const tip = Number($("exp-tip") && $("exp-tip").value) || 0;
    const parts = MB.itemizedSplits(items, tax, tip);
    const sub = {};
    items.forEach((it) => equalSplits(it.amount, it.member_ids).forEach((p) => { sub[p.user_id] = (sub[p.user_id] || 0) + p.share_amount; }));
    const itemsTotal = Math.round(items.reduce((acc, it) => acc + it.amount, 0) * 100) / 100;
    const total = Math.round(parts.reduce((acc, x) => acc + x.share_amount, 0) * 100) / 100;
    return { items, tax, tip, parts, sub, itemsTotal, total };
  }

  function paintItemSum() {
    const t = itemizeTotals();
    const el = $("itemize-sum");
    const box = $("itemize-breakdown");
    if (!t.items.length) {
      if (el) el.textContent = "";
      if (box) { box.hidden = true; box.innerHTML = ""; }
      if (typeof validateExpense === "function") validateExpense(false);
      return;
    }
    const amountEl = $("exp-amount");
    const bill = Number(amountEl.value) || 0;
    // Fill the bill from the items until the person types their own amount.
    if ((!bill || amountEl.dataset.auto === "1") && document.activeElement !== amountEl) {
      amountEl.value = String(t.total);
      amountEl.dataset.auto = "1";
    }
    const order = orderedMembers().map((m) => m.id);
    const rows = t.parts.slice().sort((a, b) => order.indexOf(a.user_id) - order.indexOf(b.user_id)).map((p) => {
      const m = members.find((x) => x.id === p.user_id) || { id: p.user_id, display_name: "Member" };
      const items = Math.round((t.sub[p.user_id] || 0) * 100) / 100;
      const extra = Math.round((p.share_amount - items) * 100) / 100;
      const math = (t.tax || t.tip)
        ? `${formatMoney(items)} items + ${formatMoney(extra)} tax & tip`
        : `${formatMoney(items)} items`;
      return `<div class="ib-row"><span class="ib-name">${escapeHtml(nameOf(m))}</span><span class="ib-math">${escapeHtml(math)}</span><strong class="ib-total">${escapeHtml(formatMoney(p.share_amount))}</strong></div>`;
    }).join("");
    const parts = [`Items ${formatMoney(t.itemsTotal)}`];
    if (t.tax) parts.push(`tax ${formatMoney(t.tax)}`);
    if (t.tip) parts.push(`tip ${formatMoney(t.tip)}`);
    const nowBill = Number(amountEl.value) || 0;
    const off = Math.round((t.total - nowBill) * 100) / 100;
    const mismatch = Math.abs(off) > 0.02
      ? `<p class="ib-warn">The bill amount is ${escapeHtml(formatMoney(nowBill))}, but items + tax + tip come to ${escapeHtml(formatMoney(t.total))}. <button type="button" class="text-btn" id="ib-use-total">Use ${escapeHtml(formatMoney(t.total))} as the bill</button></p>`
      : "";
    if (box) {
      box.hidden = false;
      box.innerHTML = `<p class="ib-title">Each person pays</p>${rows}<div class="ib-row ib-sum"><span class="ib-name">${escapeHtml(parts.join(" + "))}</span><strong class="ib-total">${escapeHtml(formatMoney(t.total))}</strong></div>${mismatch}`;
      const use = $("ib-use-total");
      if (use) use.addEventListener("click", () => { amountEl.value = String(t.total); amountEl.dataset.auto = "1"; paintItemSum(); });
    }
    if (el) el.textContent = "";
    // What you see is what gets saved: mirror the item shares into the split list.
    syncItemsToSplit(t);
    if (typeof validateExpense === "function") validateExpense(false);
  }

  function syncItemsToSplit(t) {
    if (!t.parts.length) return;
    splitMode = "custom";
    document.querySelectorAll("[data-split-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-split-mode") === "custom"));
    document.querySelectorAll("[data-custom-id]").forEach((el) => { el.value = ""; });
    if (!document.querySelector("[data-custom-id]")) renderSplitUi();
    document.querySelectorAll("[data-custom-id]").forEach((el) => { el.value = ""; });
    t.parts.forEach((p) => {
      const input = document.querySelector(`[data-custom-id="${p.user_id}"]`);
      if (input) input.value = String(p.share_amount);
    });
    updateSplitSum();
    paintSplitSummary(collectSplits());
  }

  function applyItemsToSplit() {
    const t = itemizeTotals();
    if (!t.parts.length) return;
    $("exp-amount").value = String(t.total);
    paintItemSum();
  }

  function parseReceiptText(text) {
    const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = { merchant: "", date: "", total: "", items: [] };
    const dateRe = /\b((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)?\d{2})\b/;
    for (const line of lines) {
      const dm = line.match(dateRe);
      if (dm && !out.date) {
        const p = dm[1].replace(/[.]/g, "-").replace(/\//g, "-").split("-");
        if (p[0].length === 4) out.date = p[0] + "-" + p[1].padStart(2,"0") + "-" + p[2].padStart(2,"0");
        else {
          const y = p[2].length === 2 ? "20" + p[2] : p[2];
          out.date = y + "-" + p[1].padStart(2,"0") + "-" + p[0].padStart(2,"0");
        }
      }
    }
    const money = /(?:rs|inr|₹|\$|€|£)?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})|[0-9]+\.[0-9]{2})\b/i;
    let best = 0;
    for (const line of lines) {
      if (/(total|amount due|grand total|net amount)/i.test(line)) {
        const m = line.match(money);
        if (m) best = Math.max(best, Number(String(m[1]).replace(/,/g, "")));
      }
    }
    if (!best) {
      lines.forEach((line) => {
        const m = line.match(money);
        if (m) best = Math.max(best, Number(String(m[1]).replace(/,/g, "")));
      });
    }
    if (best) out.total = String(best);
    const skip = /total|amount|tax|gst|tip|change|cash|visa|mastercard|debit|credit|tel|gstin|invoice|bill/i;
    for (const line of lines) {
      const m = line.match(/^(.*?)(?:\s+)((?:rs|inr|₹|\$)?\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{2}))$/i);
      if (!m) continue;
      const name = m[1].trim();
      const amt = Number(String(m[2]).replace(/[^0-9.]/g, ""));
      if (!name || skip.test(name) || !amt) continue;
      out.items.push({ description: name, amount: amt });
    }
    out.merchant = (lines.find((l) => l.length > 2 && !dateRe.test(l) && !/^[\d\s./-]+$/.test(l) && !money.test(l)) || "").slice(0, 80);
    return out;
  }

  async function loadTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return window.Tesseract;
  }


  function fillCurrencySelect(roomCur) {
    const cur = roomCur || (MB.currency) || "INR";
    const sel = $("exp-currency");
    if ($("amount-currency-label")) $("amount-currency-label").textContent = cur;
    if (!sel) return cur;
    const codes = (MB.CURRENCIES || []).map((c) => c.code);
    if (!codes.includes(cur)) codes.unshift(cur);
    if (!sel.dataset.filled || sel.options.length < codes.length) {
      sel.innerHTML = codes.map((code) => `<option value="${escapeHtml(code)}">${escapeHtml(code)}</option>`).join("");
      sel.dataset.filled = "1";
    }
    sel.value = cur;
    sel.setAttribute("aria-label", "Currency, " + cur);
    return cur;
  }

  async function setupExtras(ctx) {
    const roomCur = fillCurrencySelect((ctx.room && ctx.room.currency) || MB.currency || "INR");
    window._mbRoomCurrency = roomCur;
    if ($("exp-currency")) {
      const syncFx = async () => {
        const from = $("exp-currency").value;
        $("fx-rate-field").hidden = from === roomCur;
        $("fx-hint").hidden = from === roomCur;
        if (from === roomCur) { $("fx-hint").textContent = ""; return; }
        $("fx-hint").textContent = "Fetching rate…";
        try {
          const rate = await MB.fetchFxRate(from, roomCur, $("exp-date").value || undefined);
          $("exp-fx-rate").value = String(Math.round(rate * 1e6) / 1e6);
          const orig = Number($("exp-amount").value) || 0;
          $("fx-hint").textContent = orig
            ? (orig + " " + from + " × " + rate + " = " + (Math.round(orig * rate * 100) / 100) + " " + roomCur)
            : ("1 " + from + " = " + rate + " " + roomCur);
        } catch (err) {
          $("fx-hint").textContent = MB.errorMessage(err);
        }
      };
      $("exp-currency").addEventListener("change", syncFx);
      $("exp-fx-rate").addEventListener("input", () => {
        const from = $("exp-currency").value;
        const rate = Number($("exp-fx-rate").value) || 0;
        const orig = Number($("exp-amount").value) || 0;
        $("fx-hint").hidden = false;
        $("fx-hint").textContent = orig && rate ? (orig + " " + from + " × " + rate + " = " + (Math.round(orig * rate * 100) / 100) + " " + roomCur) : "";
      });
    }

    const presets = ctx.presets || [];
    const sel = $("split-preset");
    if (sel) {
      sel.innerHTML = `<option value="">Choose a preset</option>` + presets.map((p) => `<option value="${escapeHtml(p.id)}" data-cat="${escapeHtml(p.category || "")}">${escapeHtml(p.name)}${p.category ? " · " + escapeHtml(p.category) : ""}</option>`).join("");
      sel.addEventListener("change", () => {
        const p = presets.find((x) => x.id === sel.value);
        if (!p) return;
        const ids = p.members || [];
        splitMode = ids.length === members.length ? "all" : "selected";
        document.querySelectorAll("[data-split-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-split-mode") === splitMode));
        renderSplitUi();
        if (splitMode === "selected") {
          document.querySelectorAll("[data-split-id]").forEach((el) => { el.checked = ids.includes(el.getAttribute("data-split-id")); });
          renderSplitUi();
        }
      });
      $("exp-category").addEventListener("change", () => {
        const cat = $("exp-category").value;
        const def = presets.find((p) => p.category && p.category === cat);
        if (def) { sel.value = def.id; sel.dispatchEvent(new Event("change")); }
      });
      $("save-preset").addEventListener("click", async () => {
        const name = prompt("Name this split, e.g. Rent - equal 3");
        if (!name) return;
        const ids = selectedMemberIds();
        const { error } = await MB.client().rpc("upsert_split_preset", {
          p_room_id: ctx.room.id,
          p_name: name,
          p_members: ids,
          p_category: $("exp-category").value || null,
        });
        if (error) return MB.showPageError(errorMessage(error));
        location.reload();
      });
    }

    if ($("add-item")) {
      $("add-item").addEventListener("click", () => addItemRow());
      $("apply-items").addEventListener("click", applyItemsToSplit);
      $("exp-tax").addEventListener("input", paintItemSum);
      $("exp-tip").addEventListener("input", paintItemSum);
    }

    const scan = $("scan-receipt");
    if (scan) {
      scan.addEventListener("change", async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        const status = $("ocr-status");
        status.hidden = false;
        status.textContent = "Reading receipt…";
        try {
          const blob = await MB.compressImage(file, 1280, 0.8, { fit: true });
          window._mbReceiptBlob = blob;
          const preview = $("receipt-preview");
          preview.src = URL.createObjectURL(blob);
          preview.hidden = false;
          const Tesseract = await loadTesseract();
          const result = await Tesseract.recognize(blob, "eng", {
            logger: (m) => {
              if (m && m.status === "recognizing text" && status) {
                status.textContent = "Reading receipt… " + Math.round((m.progress || 0) * 100) + "%";
              }
            },
          });
          const parsed = parseReceiptText((result && result.data && result.data.text) || "");
          if (parsed.total) $("exp-amount").value = parsed.total;
          if (parsed.date) $("exp-date").value = parsed.date;
          if (parsed.merchant && !$("exp-desc").value) $("exp-desc").value = parsed.merchant;
          if (parsed.items.length) {
            $("item-list").innerHTML = "";
            parsed.items.forEach((it) => addItemRow({ description: it.description, amount: it.amount, member_ids: members.map((m) => m.id) }));
            $("itemize-box").open = true;
            applyItemsToSplit();
          } else {
            renderSplitUi();
          }
          status.textContent = "Prefill ready — check the total, date, and lines before saving. The receipt image can be stored with the expense.";
        } catch (err) {
          if (window._mbReceiptBlob) {
            status.textContent = "Image attached. " + (MB.errorMessage(err) || "Could not read the text, so fill the amount yourself.");
          } else {
            status.textContent = MB.errorMessage(err) || "Could not read that image. Try another photo or screenshot.";
          }
        }
      });
    }

    const params = new URLSearchParams(location.search);
    if (params.get("scan") === "1" && scan) scan.click();
  }


  function setTxTab(tab) {
    document.querySelectorAll("[data-tx-tab]").forEach((btn) => btn.classList.toggle("is-active", btn.getAttribute("data-tx-tab") === tab));
    const updates = $("tx-updates");
    const form = $("expense-form");
    if (updates) updates.hidden = tab !== "updates";
    if (form) form.hidden = tab !== "details";
  }

  function paintTxDetail() {
    const hero = $("tx-hero");
    const tabs = $("tx-tabs");
    const title = $("add-page-title");
    const timeline = $("tx-timeline");
    if (!editing) {
      if (hero) hero.hidden = true;
      if (tabs) tabs.hidden = true;
      if (title) title.hidden = false;
      if ($("kind-toggle")) $("kind-toggle").hidden = false;
      if ($("tx-updates")) $("tx-updates").hidden = true;
      if ($("expense-form")) $("expense-form").hidden = false;
      return;
    }
    if (title) title.hidden = true;
    if ($("kind-toggle")) $("kind-toggle").hidden = true;
    if (hero) {
      hero.hidden = false;
      $("tx-hero-kicker").textContent = editing.category || (editing.personal ? "Personal" : "Expense");
      $("tx-hero-amount").textContent = formatMoney(editing.amount);
      const payer = editing.personal ? null : MB.memberRecord(editing.paid_by, members);
      $("tx-hero-sub").innerHTML = editing.personal
        ? (MB.friendlyDate(editing.date) || "")
        : ("Paid by " + MB.personChip(payer, members, "sm") + " · " + MB.escapeHtml(MB.friendlyDate(editing.date) || ""));
    }
    if (tabs) {
      tabs.hidden = false;
      if (!tabs.dataset.bound) {
        tabs.dataset.bound = "1";
        tabs.querySelectorAll("[data-tx-tab]").forEach((btn) => {
          btn.addEventListener("click", () => setTxTab(btn.getAttribute("data-tx-tab")));
        });
      }
    }
    if (timeline) {
      const splits = editing.splits || [];
      if (!splits.length) {
        timeline.innerHTML = `<li class="is-pending"><span class="tl-icon"></span><div class="tl-body">No split updates yet.</div></li>`;
      } else {
        const created = editing.created_at || editing.date;
        const rows = [];
        rows.push(`<li class="is-done"><span class="tl-icon">✓</span><div class="tl-body"><strong>${escapeHtml(editing.description || "Expense")} added</strong><span class="tl-time">${escapeHtml(MB.friendlyDate(created) || "")}</span></div></li>`);
        const order = orderedMembers().map((m) => m.id);
        const rank = (id) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
        const pid = editing.paid_by;
        if (pid && !splits.some((s) => s.user_id === pid)) {
          rows.push(`<li class="is-done"><span class="tl-icon">✓</span><div class="tl-body"><div>${MB.personChip(MB.memberRecord(pid, members), members, "sm")} paid ${escapeHtml(formatMoney(editing.amount))} · no share</div></div></li>`);
        }
        splits.slice().sort((a, b) => rank(a.user_id) - rank(b.user_id)).forEach((s) => {
          const person = MB.memberRecord(s.user_id, members);
          if (s.user_id === pid) {
            rows.push(`<li class="is-done"><span class="tl-icon">✓</span><div class="tl-body"><div>${MB.personChip(person, members, "sm")} paid ${escapeHtml(formatMoney(editing.amount))} · share ${escapeHtml(formatMoney(s.share_amount))}</div></div></li>`);
            return;
          }
          const st = s.status || "pending";
          const when = s.responded_at || s.forced_at || "";
          let line = MB.personChip(person, members, "sm");
          if (st === "accepted") {
            const by = s.forced_by ? MB.displayName(s.forced_by, members) : "";
            line += s.forced_by ? ((" was accepted by " + by) ) : " accepted their share";
          }
          else if (st === "declined") line += " declined their share";
          else line += " hasn\u2019t accepted yet";
          line += " · " + escapeHtml(formatMoney(s.share_amount));
          rows.push(`<li class="is-${st === "accepted" ? "done" : st}"><span class="tl-icon">${st === "accepted" ? "✓" : (st === "declined" ? "!" : "")}</span><div class="tl-body"><div>${line}</div>${when ? `<span class="tl-time">${escapeHtml(MB.friendlyDate(String(when).slice(0,10)))}</span>` : ""}</div></li>`);
        });
        timeline.innerHTML = rows.join("");
      }
    }
    const save = $("exp-save");
    if (save) { save.classList.add("forest-btn"); save.classList.remove("primary-btn"); }
    setTxTab("updates");
  }


  // runPage re-runs main after fresh data arrives. The form binds listeners and holds
  // what the person typed, so build it once; only a run that hit "no room yet"
  // (cached data) may be followed by a full build.
  let built = false;
  let topBound = false;
  let submitBound = false;
  let noRoomShown = false;
  function bindSubmitOnce() {
    if (submitBound) return;
    submitBound = true;
    $("expense-form").addEventListener("submit", save);
  }
  async function main() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const initialKind = (params.get("kind") === "personal" || params.get("mode") === "personal") ? "personal" : "room";
    const ctx = await MB.bootApp({ title: id ? "Edit expense" : "Add expense", keepMonth: initialKind === "personal" });
    if (!ctx) return;
    if (built) {
      // Fresh data after a cached first paint: only pick up roommate changes.
      const fresh = (ctx.members && ctx.members.length) ? ctx.members : null;
      if (fresh && fresh.map((m) => m.id).join() !== members.map((m) => m.id).join()) {
        members = fresh;
        const paid = $("exp-paid-by");
        const keep = paid.value;
        paid.innerHTML = members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}${m.id === ctx.uid ? " (you)" : ""}</option>`).join("");
        paid.value = keep;
        isManager = !!ctx.isAdmin;
        renderSplitUi();
      }
      return;
    }
    fillCurrencySelect((ctx.room && ctx.room.currency) || (ctx.profile && ctx.profile.currency) || MB.currency || "INR");

    let ctxNow = ctx;
    if (!topBound) {
      topBound = true;
      document.querySelectorAll("#kind-toggle [data-kind]").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (id) return;
          setKind(btn.getAttribute("data-kind"), ctxNow);
        });
      });
      $("per-type").addEventListener("change", fillPersonalCategories);
    }

    if (!ctx.room) {
      if (noRoomShown) return;
      noRoomShown = true;
      $("no-room").hidden = false;
      setKind("personal", ctx);
      $("kind-toggle").querySelector('[data-kind="room"]').disabled = true;
      $("exp-date").value = MB.todayISO();
      bindSubmitOnce();
      return;
    }
    built = true;
    if (noRoomShown) {
      $("no-room").hidden = true;
      $("kind-toggle").querySelector('[data-kind="room"]').disabled = false;
    }
    setKind(initialKind, ctx);
    isManager = !!ctx.isAdmin;
    members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    if (kind === "room" && !ctx.isAdmin && ctx.room.members_can_add_expenses === false && !id) {
      $("expense-form").hidden = true;
      $("no-room").hidden = false;
      $("no-room").innerHTML = "Only people who can manage the room can add expenses here. <a href=\"dashboard.html\">Go to dashboard</a>";
      return;
    }
    if (MB.fillCategorySelect) MB.fillCategorySelect($("exp-category"), (MB.pickerCategories || MB.roomCategories)(ctx.room), $("exp-category").value);
    else $("exp-category").innerHTML = MB.roomCategories(ctx.room).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (MB.bindCategoryPicker) MB.bindCategoryPicker($("exp-category"));
    $("exp-paid-by").innerHTML = members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}${m.id === ctx.uid ? " (you)" : ""}</option>`).join("");
    $("exp-paid-by").value = ctx.uid;
    $("exp-date").value = MB.todayISO();
    if (!id) {
      const def = ctx.room.default_split_method;
      if (def === "equal_selected") splitMode = "selected";
      if (def === "custom") splitMode = "custom";
      document.querySelectorAll("[data-split-mode]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-split-mode") === (splitMode === "all" ? "all" : splitMode));
      });
    }

    if (id && kind === "personal") {
      const { data: row, error } = await MB.client().from("transactions").select("*").eq("id", id).maybeSingle();
      if (error || !row) return showError("form-error", "Entry not found.");
      editing = { ...row, personal: true };
      $("exp-amount").value = String(row.amount);
      $("exp-desc").value = row.note || row.category;
      $("per-type").value = row.type;
      fillPersonalCategories();
      $("exp-category").value = row.category;
      if (MB.syncCategoryPicker) MB.syncCategoryPicker($("exp-category"));
      $("exp-date").value = row.date;
      $("exp-delete").hidden = false;
      $("kind-toggle").querySelector('[data-kind="room"]').disabled = true;
    } else if (id) {
      const { data: exp, error } = await MB.client().from("room_expenses").select("*").eq("id", id).maybeSingle();
      if (error || !exp) return showError("form-error", "Expense not found.");
      const { data: splits } = await MB.client().from("expense_splits").select("*").eq("expense_id", id);
      editing = { ...exp, splits: splits || [] };
      $("exp-amount").value = String(exp.amount);
      $("exp-desc").value = exp.description;
      $("exp-category").value = exp.category;
      if (MB.syncCategoryPicker) MB.syncCategoryPicker($("exp-category"));
      $("exp-date").value = exp.date;
      $("exp-paid-by").value = exp.paid_by;
      const involved = new Set((splits || []).map((s) => s.user_id));
      const amts = (splits || []).map((s) => Number(s.share_amount) || 0);
      const evenly = amts.length > 0 && (Math.max(...amts) - Math.min(...amts)) <= 0.011;
      if (evenly && members.every((m) => involved.has(m.id))) splitMode = "all";
      else if (evenly) { splitMode = "selected"; initialSelected = involved; }
      else splitMode = "custom";
      document.querySelectorAll("[data-split-mode]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-split-mode") === splitMode);
      });
      document.querySelector('#kind-toggle [data-kind="personal"]').disabled = true;
      const canEdit = exp.created_by === ctx.uid || ctx.isAdmin;
      $("exp-delete").hidden = !canEdit;
      if (!canEdit) {
        $("expense-form").querySelectorAll("input, select, textarea, button[type=submit]").forEach((el) => { el.disabled = true; });
        showError("form-error", "Only the person who added this expense, or someone who can manage the room, can edit it.");
      } else if (ctx.isAdmin && exp.created_by !== ctx.uid) {
        const note = document.createElement("p");
        note.className = "notice";
        note.textContent = "You are editing someone else's expense. The person who added it and anyone affected will be notified.";
        $("expense-form").insertBefore(note, $("expense-form").firstChild);
      }
    }

    // Managers can mark someone's share as accepted, inline on that person's row.
    $("split-box").addEventListener("click", async (ev) => {
      const btn = ev.target.closest && ev.target.closest("[data-force]");
      if (!btn || !editing) return;
      ev.preventDefault();
      const who = MB.displayName(btn.getAttribute("data-force"), members);
      if (!confirm("Mark " + who + "'s share as accepted? " + who + " will be notified.")) return;
      btn.disabled = true;
      const { error } = await MB.client().rpc("force_accept_share", { p_expense_id: editing.id, p_user_id: btn.getAttribute("data-force") });
      if (error) { btn.disabled = false; return MB.showPageError(errorMessage(error)); }
      location.reload();
    });
    $("exp-paid-by").addEventListener("change", renderSplitUi);

    document.querySelectorAll("[data-split-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        splitMode = btn.getAttribute("data-split-mode");
        document.querySelectorAll("[data-split-mode]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderSplitUi();
      });
    });
    $("exp-amount").addEventListener("input", (ev) => {
      if (ev.isTrusted) delete $("exp-amount").dataset.auto;
      renderSplitUi();
      if (document.querySelector("[data-item-row]")) paintItemSum();
    });
    bindSubmitOnce();
    $("exp-delete").addEventListener("click", removeExpense);
    refreshStatusPanel();
    renderSplitUi();
    if (MB.bindFormValidation) {
      validateExpense = MB.bindFormValidation($("expense-form"), collectExpenseErrors, { button: $("exp-save") });
    } else {
      validateExpense(false);
    }
    paintTxDetail();
    await setupExtras(ctx);
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
