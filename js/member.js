(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, netLabel } = MB;
  async function main() {
    const id = new URLSearchParams(location.search).get("id");
    const ctx = await MB.bootApp({ title: "Member", month: true });
    if (!ctx) return;
    if (!ctx.room || !id) { $("content").innerHTML = `<p class="empty">Member not found.</p>`; return; }
    const members = await MB.loadMembers(ctx.room.id);
    const person = members.find((m) => m.id === id);
    if (!person) { $("content").innerHTML = `<p class="empty">That person is not in this room.</p>`; return; }
    $("shell-title").textContent = person.display_name;
    const { expenses, splits, settlements } = await MB.loadMonthData(ctx.room.id, ctx.month);
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const row = balances.find((b) => b.id === id);
    const net = netLabel(row.netAmt);
    $("stat-paid").textContent = formatMoney(row.paidAmt);
    $("stat-share").textContent = formatMoney(row.shareAmt);
    $("stat-net").textContent = net.text;
    $("stat-net-card").className = "card stat " + net.cls;
    const paid = expenses.filter((e) => e.paid_by === id);
    $("paid-list").innerHTML = paid.length ? paid.map((e) => `
      <a class="list-item" href="add-expense.html?id=${escapeHtml(e.id)}">
        <div class="item-icon">${escapeHtml(e.category.slice(0,1))}</div>
        <div><div class="item-title">${escapeHtml(e.description)}</div><div class="item-sub">${escapeHtml(e.category)} · ${escapeHtml(e.date)}</div></div>
        <div class="item-amt">${escapeHtml(formatMoney(e.amount))}</div>
      </a>`).join("") : `<p class="empty">No expenses paid this month.</p>`;
    const theirSplits = splits.filter((s) => s.user_id === id && s.status === "accepted");
    $("share-list").innerHTML = theirSplits.length ? theirSplits.map((s) => {
      const e = expenses.find((x) => x.id === s.expense_id);
      if (!e) return "";
      return `<a class="list-item" href="add-expense.html?id=${escapeHtml(e.id)}">
        <div class="item-icon">${escapeHtml(e.category.slice(0,1))}</div>
        <div><div class="item-title">${escapeHtml(e.description)}</div><div class="item-sub">Paid by ${escapeHtml(MB.displayName(e.paid_by, members))}</div></div>
        <div class="item-amt">${escapeHtml(formatMoney(s.share_amount))}</div>
      </a>`;
    }).join("") : `<p class="empty">No shares this month.</p>`;
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
