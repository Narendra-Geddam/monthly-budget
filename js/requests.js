(() => {
  const MB = window.MB;
  const { $ } = MB;

  async function main() {
    const ctx = await MB.bootApp({ title: "Pending requests" });
    if (!ctx) return;
    if (!ctx.room) {
      $("pending-list").innerHTML = `<p class="empty">Join or create a room first. <a href="dashboard.html">Go to dashboard</a></p>`;
      return;
    }
    const members = await MB.loadMembers(ctx.room.id);
    const expenses = ctx.expenses || [];
    MB.renderPendingItems($("pending-list"), ctx.pending || [], members, expenses);
  }
  main().catch((err) => { console.error(err); MB.showPageError(MB.errorMessage(err)); });
})();
