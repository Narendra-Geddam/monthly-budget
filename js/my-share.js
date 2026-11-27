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
    const viewerPaid = (expenses || []).reduce((sum, e) => (
      e && e.paid_by === ctx.uid ? sum + Number(e.amount || 0) : sum
    ), 0);
    $("stat-paid").textContent = formatMoney(viewerPaid);
    $("stat-share").textContent = formatMoney(mine.shareAmt);
    const cap = MB.shareStatCaption ? MB.shareStatCaption(mine.netAmt) : { label: net.text, value: formatMoney(Math.abs(mine.netAmt)), cls: net.cls };
    const netLabelEl = $("stat-net-label");
    if (netLabelEl) netLabelEl.textContent = cap.label;
    $("stat-net").textContent = cap.value;
    $("stat-net-card").className = "card stat " + cap.cls;
    if (MB.paintBalanceNote) MB.paintBalanceNote("stat-net-note", mine);
    const myPending = (splits || []).filter((s) => s.user_id === ctx.uid && s.status === "pending");
    if (myPending.length && $("pending-note")) {
      $("pending-note").hidden = false;
      $("pending-note").innerHTML = `You have ${myPending.length} pending share request${myPending.length > 1 ? "s" : ""}. <a href="requests.html">Review them</a>. Pending shares are not included above.`;
    }
    const suggestions = (MB.myTransfers || function (bals, id, ex, sp, st) {
      return MB.settleSuggestions(bals, ex, sp, st).filter((t) => t.from.id === id || t.to.id === id);
    })(balances, ctx.uid, expenses, splits, settlements);
    $("owe-list").innerHTML = suggestions.length
      ? suggestions.map((t) => MB.oweRowHtml(t, ctx.uid, members)).join("")
      : MB.emptyState({ art: "images/illu-handshake.webp", title: "You're all settled", text: "No outstanding balances with roommates this month." });
  }
  (MB.runPage ? MB.runPage(main) : main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); }));
})();
