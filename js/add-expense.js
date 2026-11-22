(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, equalSplits, showError, hideError, errorMessage } = MB;
  let members = [];
  let splitMode = "all";
  let editing = null;

  function selectedMemberIds() {
    if (splitMode === "all") return members.map((m) => m.id);
    return [...document.querySelectorAll("[data-split-id]:checked")].map((el) => el.getAttribute("data-split-id"));
  }


  function statusFor(userId) {
    if (!editing) return null;
    const row = (editing.splits || []).find((s) => s.user_id === userId);
    return row ? row.status : null;
  }

  function statusPill(userId) {
    const st = statusFor(userId);
    if (!st) return "";
    return ` <span class="status-pill is-${st}">${MB.splitStatusLabel(st)}</span>`;
  }

  function refreshStatusPanel() {
    const notice = $("decline-notice");
    const panel = $("split-status");
    if (!editing) {
      if (notice) notice.hidden = true;
      if (panel) panel.hidden = true;
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
    if (panel) {
      panel.hidden = false;
      panel.innerHTML = (editing.splits || []).map((s) => {
        const m = members.find((x) => x.id === s.user_id);
        const name = (m && m.display_name) || "Member";
        return `<div class="split-status-row"><span>${escapeHtml(name)}</span><span>${escapeHtml(formatMoney(s.share_amount))}</span><span class="status-pill is-${escapeHtml(s.status || "pending")}">${escapeHtml(MB.splitStatusLabel(s.status))}</span></div>`;
      }).join("");
    }
  }

  function renderSplitUi() {
    const amount = Number($("exp-amount").value) || 0;
    const host = $("split-box");
    if (splitMode === "custom") {
      const current = {};
      if (editing) {
        (editing.splits || []).forEach((s) => { current[s.user_id] = s.share_amount; });
      }
      host.innerHTML = `<div class="split-rows">${members.map((m) => `
        <label class="split-row"><span>${escapeHtml(m.display_name)}${m.id === MB.uid() ? " (you)" : ""}${statusPill(m.id)}</span>
        <input type="number" min="0" step="0.01" data-custom-id="${escapeHtml(m.id)}" value="${escapeHtml(current[m.id] != null ? String(current[m.id]) : "")}" placeholder="0.00" /></label>`).join("")}</div>
        <p class="card-sub" id="split-sum"></p>`;
      host.querySelectorAll("[data-custom-id]").forEach((el) => el.addEventListener("input", updateSplitSum));
      updateSplitSum();
      return;
    }
    const ids = selectedMemberIds();
    const shares = equalSplits(amount, ids);
    host.innerHTML = members.map((m) => {
      const share = shares.find((s) => s.user_id === m.id);
      const checked = ids.includes(m.id) ? "checked" : "";
      const box = splitMode === "selected" ? `<input type="checkbox" data-split-id="${escapeHtml(m.id)}" ${checked} />` : "";
      return `<label class="chip">${box}<span>${escapeHtml(m.display_name)}${m.id === MB.uid() ? " (you)" : ""}${statusPill(m.id)}</span><strong>${share ? formatMoney(share.share_amount) : "—"}</strong></label>`;
    }).join("");
    if (splitMode === "selected") {
      host.querySelectorAll("[data-split-id]").forEach((el) => el.addEventListener("change", renderSplitUi));
    }
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
    $("exp-category").innerHTML = list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
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
      $("exp-category").innerHTML = MB.roomCategories(ctx.room).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }
  }

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
    location.href = "expenses.html";
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
    item = item || { description: "", amount: "", member_ids: members.map((m) => m.id) };
    const row = document.createElement("div");
    row.className = "item-block";
    row.setAttribute("data-item-row", "1");
    row.innerHTML = `<div class="item-row">
        <label class="field"><span>Item</span><input type="text" data-item-desc value="${escapeHtml(item.description || "")}" placeholder="e.g. Pasta" /></label>
        <label class="field"><span>Amount</span><input type="number" min="0" step="0.01" data-item-amt value="${escapeHtml(item.amount === "" ? "" : String(item.amount))}" /></label>
        <button type="button" class="text-btn" data-item-del aria-label="Remove line">Remove</button>
      </div>
      <div class="item-members">${members.map((m) => {
        const on = (item.member_ids || []).includes(m.id) ? "checked" : "";
        return `<label class="chip"><input type="checkbox" data-item-mem value="${escapeHtml(m.id)}" ${on} /> ${escapeHtml(m.display_name)}</label>`;
      }).join("")}</div>`;
    $("item-list").appendChild(row);
    row.querySelector("[data-item-del]").addEventListener("click", () => { row.remove(); paintItemSum(); });
    row.querySelectorAll("input").forEach((el) => el.addEventListener("input", paintItemSum));
    paintItemSum();
  }

  function paintItemSum() {
    const items = collectItems();
    const tax = Number($("exp-tax") && $("exp-tax").value) || 0;
    const tip = Number($("exp-tip") && $("exp-tip").value) || 0;
    const parts = MB.itemizedSplits(items, tax, tip);
    const total = parts.reduce((s, x) => s + x.share_amount, 0);
    const el = $("itemize-sum");
    if (el) el.textContent = items.length ? ("Itemized total " + formatMoney(total) + " across " + parts.length + " people.") : "";
  }

  function applyItemsToSplit() {
    const items = collectItems();
    const tax = Number($("exp-tax").value) || 0;
    const tip = Number($("exp-tip").value) || 0;
    const parts = MB.itemizedSplits(items, tax, tip);
    const total = Math.round(parts.reduce((s, x) => s + x.share_amount, 0) * 100) / 100;
    if (!parts.length) return;
    $("exp-amount").value = String(total);
    splitMode = "custom";
    document.querySelectorAll("[data-split-mode]").forEach((b) => b.classList.toggle("is-active", b.getAttribute("data-split-mode") === "custom"));
    renderSplitUi();
    parts.forEach((p) => {
      const input = document.querySelector(`[data-custom-id="${p.user_id}"]`);
      if (input) input.value = String(p.share_amount);
    });
    updateSplitSum();
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

  async function setupExtras(ctx) {
    const roomCur = (ctx.room && ctx.room.currency) || MB.currency || "INR";
    window._mbRoomCurrency = roomCur;
    if ($("amount-currency-label")) $("amount-currency-label").textContent = roomCur;
    if ($("exp-currency")) {
      $("exp-currency").innerHTML = MB.CURRENCIES.map((c) => `<option value="${c.code}">${c.code}</option>`).join("");
      $("exp-currency").value = roomCur;
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
        if (!file) return;
        const status = $("ocr-status");
        status.hidden = false;
        status.textContent = "Reading receipt…";
        try {
          const blob = await MB.compressImage(file, 1280, 0.8);
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
          status.textContent = MB.errorMessage(err);
        }
      });
    }

    const params = new URLSearchParams(location.search);
    if (params.get("scan") === "1" && scan) scan.click();
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const initialKind = (params.get("kind") === "personal" || params.get("mode") === "personal") ? "personal" : "room";
    const ctx = await MB.bootApp({ title: id ? "Edit expense" : "Add expense", keepMonth: initialKind === "personal" });
    if (!ctx) return;

    document.querySelectorAll("#kind-toggle [data-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (id) return;
        setKind(btn.getAttribute("data-kind"), ctx);
      });
    });
    $("per-type").addEventListener("change", fillPersonalCategories);

    if (!ctx.room) {
      $("no-room").hidden = false;
      setKind("personal", ctx);
      $("kind-toggle").querySelector('[data-kind="room"]').disabled = true;
      $("exp-date").value = MB.todayISO();
      $("expense-form").addEventListener("submit", save);
      return;
    }
    setKind(initialKind, ctx);
    members = (ctx.members && ctx.members.length) ? ctx.members : await MB.loadMembers(ctx.room.id);
    if (kind === "room" && !ctx.isAdmin && ctx.room.members_can_add_expenses === false && !id) {
      $("expense-form").hidden = true;
      $("no-room").hidden = false;
      $("no-room").innerHTML = "Only admins can add expenses in this room. <a href=\"dashboard.html\">Go to dashboard</a>";
      return;
    }
    $("exp-category").innerHTML = MB.roomCategories(ctx.room).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
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
      $("exp-date").value = exp.date;
      $("exp-paid-by").value = exp.paid_by;
      const involved = new Set((splits || []).map((s) => s.user_id));
      const allEqual = members.every((m) => involved.has(m.id));
      splitMode = allEqual ? "all" : "custom";
      document.querySelectorAll("[data-split-mode]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-split-mode") === splitMode);
      });
      document.querySelector('#kind-toggle [data-kind="personal"]').disabled = true;
      const canEdit = exp.created_by === ctx.uid || ctx.isAdmin;
      $("exp-delete").hidden = !canEdit;
      if (!canEdit) {
        $("expense-form").querySelectorAll("input, select, textarea, button[type=submit]").forEach((el) => { el.disabled = true; });
        showError("form-error", "Only the person who added this expense or an admin can edit it.");
      } else if (ctx.isAdmin && exp.created_by !== ctx.uid) {
        const note = document.createElement("p");
        note.className = "notice";
        note.textContent = "You are editing this as an admin. The original creator and affected members will be notified.";
        $("expense-form").insertBefore(note, $("expense-form").firstChild);
      }
      if (ctx.isAdmin) {
        const host = document.createElement("div");
        host.id = "force-box";
        host.className = "split-status";
        $("expense-form").appendChild(host);
        const pending = (editing.splits || []).filter((s) => s.status === "pending" || s.status === "declined");
        if (pending.length) {
          host.innerHTML = "<h3>Force-accept shares</h3>" + pending.map((s) => {
            const m = members.find((x) => x.id === s.user_id);
            const name = (m && m.display_name) || "Member";
            return `<div class="split-status-row"><span>${escapeHtml(name)} · ${escapeHtml(formatMoney(s.share_amount))} · ${escapeHtml(MB.splitStatusLabel(s.status))}</span><button type="button" class="text-btn" data-force="${escapeHtml(s.user_id)}">Mark as accepted</button></div>`;
          }).join("");
          host.querySelectorAll("[data-force]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              if (!confirm("Accept this share on their behalf? They will be notified.")) return;
              const { error } = await MB.client().rpc("force_accept_share", { p_expense_id: editing.id, p_user_id: btn.getAttribute("data-force") });
              if (error) return MB.showPageError(errorMessage(error));
              location.reload();
            });
          });
        }
      }
    }

    document.querySelectorAll("[data-split-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        splitMode = btn.getAttribute("data-split-mode");
        document.querySelectorAll("[data-split-mode]").forEach((b) => b.classList.toggle("is-active", b === btn));
        renderSplitUi();
      });
    });
    $("exp-amount").addEventListener("input", renderSplitUi);
    $("expense-form").addEventListener("submit", save);
    $("exp-delete").addEventListener("click", removeExpense);
    refreshStatusPanel();
    renderSplitUi();
    await setupExtras(ctx);
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
