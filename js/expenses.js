(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney } = MB;
  async function main() {
    const ctx = await MB.bootApp({ title: "Expenses", month: true });
    if (!ctx) return;
    if (!ctx.room) { $("list").innerHTML = MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Shared expenses show up here after you join or create a room.", href: "dashboard.html", cta: "Go to Home" }); return; }
    const members = ctx.members && ctx.members.length ? ctx.members : await MB.loadMembers(ctx.room.id);
    const data = (ctx.expenses && ctx.splits) ? ctx : await MB.loadMonthData(ctx.room.id, ctx.month);
    const expenses = data.expenses || [];
    const splits = data.splits || [];
    $("filter-category").innerHTML = `<option value="">All categories</option>` + MB.roomCategories(ctx.room).map((c) => `<option>${escapeHtml(c)}</option>`).join("");
    $("filter-payer").innerHTML = `<option value="">Anyone paid</option>` + members.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.display_name)}</option>`).join("");
    async function thumb(path) {
      if (!path) return "";
      try {
        const url = await MB.signedReceiptUrl(path);
        return url ? `<img class="receipt-thumb" src="${escapeHtml(url)}" alt="Receipt" />` : "";
      } catch (e) { return ""; }
    }
    async function paint() {
      const q = ($("exp-search").value || "").trim().toLowerCase();
      const cat = $("filter-category").value;
      const payer = $("filter-payer").value;
      const from = $("filter-from").value;
      const to = $("filter-to").value;
      const rows = expenses.filter((e) => {
        if (cat && e.category !== cat) return false;
        if (payer && e.paid_by !== payer) return false;
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (q) {
          const payerName = MB.displayName(e.paid_by, members).toLowerCase();
          const hay = [e.description, e.category, e.date, String(e.amount), payerName, e.original_currency, e.original_amount].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const html = [];
      for (const e of rows) {
        const receipt = await thumb(e.receipt_path);
        const row = MB.expenseRowHtml(e, { members, splits, receipt });
        html.push(row);
      }
      $("list").innerHTML = html.length ? html.join("") : MB.emptyState({ art: "images/illu-receipts.webp", title: "No matching expenses", text: "Try another search, date, or category — or add the first bill.", href: "add-expense.html", cta: "Add an expense" });
    }
    ["exp-search", "filter-category", "filter-payer", "filter-from", "filter-to"].forEach((id) => {
      $(id).addEventListener("input", () => { paint().catch(() => {}); });
      $(id).addEventListener("change", () => { paint().catch(() => {}); });
    });
    await paint();
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
