(() => {
  const MB = window.MB;
  const { $, escapeHtml, formatMoney, netLabel } = MB;
  async function main() {
    const ctx = await MB.bootApp({ title: "My share", month: true });
    if (!ctx) return;
    if (!ctx.room) { $("content").innerHTML = MB.emptyState({ art: "images/illu-people.webp", title: "Add your people, near and far", text: "Your share of room bills will show up here after you join a room.", href: "dashboard.html", cta: "Go to Home" }); return; }
    const members = await MB.loadMembers(ctx.room.id);
    const { expenses, splits, settlements } = await MB.loadMonthData(ctx.room.id, ctx.month);
    const balances = MB.memberBalances(members, expenses, splits, settlements);
    const mine = balances.find((b) => b.id === ctx.uid) || { paidAmt: 0, shareAmt: 0, netAmt: 0 };
    const net = netLabel(mine.netAmt);
    $("stat-paid").textContent = formatMoney(mine.paidAmt);
    $("stat-share").textContent = formatMoney(mine.shareAmt);
    const cap = MB.shareStatCaption ? MB.shareStatCaption(mine.netAmt) : { label: net.text, value: formatMoney(Math.abs(mine.netAmt)), cls: net.cls };
    const netLabelEl = $("stat-net-label");
    if (netLabelEl) netLabelEl.textContent = cap.label;
    $("stat-net").textContent = cap.value;
    $("stat-net-card").className = "card stat " + cap.cls;
    if (MB.paintBalanceNote) MB.paintBalanceNote("stat-net-note", mine);

    const mySplits = splits.filter((s) => s.user_id === ctx.uid && s.status === "accepted");
    const myPending = splits.filter((s) => s.user_id === ctx.uid && s.status === "pending");
    $("share-list").innerHTML = mySplits.length ? mySplits.map((s) => {
      const e = expenses.find((x) => x.id === s.expense_id);
      if (!e) return "";
      return typeof MB.expenseRowHtml === "function" ? MB.expenseRowHtml(e, { members, splits: [s] }) : `<a class="list-item" href="add-expense.html?id=${escapeHtml(e.id)}"><div><div class="item-title">${escapeHtml(MB.displayName(e.paid_by, members))} paid ${escapeHtml(formatMoney(e.amount))}</div><div class="item-sub">${escapeHtml(e.category || "")} · your share ${escapeHtml(formatMoney(s.share_amount))}</div></div></a>`;
    }).join("") : MB.emptyState({ art: "images/illu-handshake.webp", title: "No shares this month", text: "When you accept your part of a bill, it will show up here.", href: "add-expense.html", cta: "Add an expense" });

    if (myPending.length && $("pending-note")) {
      $("pending-note").hidden = false;
      $("pending-note").innerHTML = `You have ${myPending.length} pending share request${myPending.length > 1 ? "s" : ""}. <a href="requests.html">Review them</a>. Pending shares are not included above.`;
    }
    const suggestions = (MB.myTransfers || function (bals, id) {
      return MB.settleSuggestions(bals).filter((t) => t.from.id === id || t.to.id === id);
    })(balances, ctx.uid);
    $("owe-list").innerHTML = suggestions.length
      ? suggestions.map((t) => MB.oweRowHtml(t, ctx.uid, members)).join("")
      : MB.emptyState({ art: "images/illu-handshake.webp", title: "You're all settled", text: "No outstanding balances with roommates this month." });
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
