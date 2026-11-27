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
    const nameEl = $("member-name") || $("shell-title");
    if (nameEl) nameEl.textContent = person.display_name;
    document.title = person.display_name + " · Monthly Budget";
    const { expenses, splits, settlements } = await MB.loadMonthData(ctx.room.id, ctx.month);
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const row = balances.find((b) => b.id === id);
    const net = netLabel(row.netAmt);
    $("stat-paid").textContent = formatMoney(row.paidAmt);
    $("stat-share").textContent = formatMoney(row.shareAmt);
    const netLabelEl = $("stat-net-label");
    if (Math.abs(row.netAmt) < 0.005) {
      if (netLabelEl) netLabelEl.textContent = "Balance";
      $("stat-net").textContent = "Settled up";
    } else if (row.netAmt > 0) {
      if (netLabelEl) netLabelEl.textContent = "Gets back";
      $("stat-net").textContent = formatMoney(row.netAmt);
    } else {
      if (netLabelEl) netLabelEl.textContent = "Owes";
      $("stat-net").textContent = formatMoney(Math.abs(row.netAmt));
    }
    $("stat-net-card").className = "card stat " + net.cls;
    if (MB.paintBalanceNote) MB.paintBalanceNote("stat-net-note", row);
    const link = $("see-activity");
    if (link) link.href = (MB.activityFilterHref ? MB.activityFilterHref({ person: id }) : ("activity.html?person=" + encodeURIComponent(id)));
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
