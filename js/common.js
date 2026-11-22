/* Shared auth, nav, room, money, and balance helpers. */
(() => {
  "use strict";

  function siteBase() {
    try {
      if (typeof window !== "undefined" && typeof window.MB_BASE === "string") {
        return window.MB_BASE.replace(/\/$/, "");
      }
      const scripts = document.getElementsByTagName("script");
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].getAttribute("src");
        if (!src) continue;
        const path = new URL(src, location.href).pathname;
        const m = path.match(/^(.*)\/(?:js\/[^/]+|config\.js)$/);
        if (m) return (m[1] || "").replace(/\/$/, "");
      }
    } catch (e) { /* fall through */ }
    const path = location.pathname || "";
    const cut = path.lastIndexOf("/");
    return cut > 0 ? path.slice(0, cut) : "";
  }
  function withBase(path) {
    const raw = String(path || "");
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("mailto:")) return raw;
    const rel = raw.replace(/^\/+/, "");
    const base = siteBase();
    return (base || "") + "/" + rel;
  }
  function originUrl(path) {
    const raw = String(path || "");
    if (/^https?:\/\//i.test(raw)) return raw;
    const qIdx = raw.indexOf("?");
    const hIdx = raw.indexOf("#");
    let file = raw, extra = "";
    let cut = -1;
    if (qIdx >= 0 && hIdx >= 0) cut = Math.min(qIdx, hIdx);
    else if (qIdx >= 0) cut = qIdx;
    else if (hIdx >= 0) cut = hIdx;
    if (cut >= 0) { file = raw.slice(0, cut); extra = raw.slice(cut); }
    return location.origin + withBase(file) + extra;
  }

  function registerPwa() {
    try {
      if (!document.querySelector('link[rel="manifest"]')) {
        const link = document.createElement("link");
        link.rel = "manifest";
        link.href = "manifest.json";
        document.head.appendChild(link);
      }
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const link = document.createElement("link");
        link.rel = "apple-touch-icon";
        link.href = withBase("icons/apple-touch-icon.png");
        document.head.appendChild(link);
      }
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register(withBase("sw.js"), { scope: (siteBase() || "") + "/", updateViaCache: "none" }).then((reg) => { try { reg.update(); } catch (e) {} }).catch(() => {});
        navigator.serviceWorker.addEventListener("message", (ev) => {
          const data = ev.data || {};
          if (data.type === "mb-push-received") {
            try { sessionStorage.setItem("mb-last-push", JSON.stringify(data.payload || {})); } catch (e) { /* ignore */ }
            try { window.dispatchEvent(new CustomEvent("mb-push-received", { detail: data.payload })); } catch (e2) { /* ignore */ }
            loadUnreadCount().then(setNotifBadge).catch(() => {});
          }
        });
      }
    } catch (e) { /* ignore */ }
  }
  registerPwa();

  const THEME_KEY = "monthly-budget-theme";
  const ROOM_KEY = "monthly-budget-active-room";
  const MONTH_KEY = "monthly-budget-month";
  const PENDING_CODE_KEY = "monthly-budget-pending-code";

  const CATEGORIES = ["Rent", "Groceries", "Electricity", "Water", "Internet", "Gas", "Food/Outing", "Maid", "Other"];
  const CAT_COLOR_TOKENS = {
    Rent: "--cat-indigo",
    Groceries: "--cat-green",
    Electricity: "--cat-amber",
    Water: "--cat-sky",
    Internet: "--cat-teal",
    Gas: "--cat-violet",
    "Food/Outing": "--cat-rose",
    Maid: "--cat-mint",
    Other: "--cat-slate",
  };
  const CAT_COLORS = {
    Rent: "#818CF8",
    Groceries: "#7BD44F",
    Electricity: "#FBBF24",
    Water: "#38BDF8",
    Internet: "#2EC4A3",
    Gas: "#C084FC",
    "Food/Outing": "#FB7185",
    Maid: "#6EE7B7",
    Other: "#94A3B8",
  };
  const CAT_ICONS = {
    Rent: "🏠",
    Groceries: "🛒",
    Electricity: "💡",
    Water: "🚿",
    Internet: "📶",
    Gas: "🔥",
    "Food/Outing": "🍽️",
    Maid: "🧹",
    Other: "📦",
  };
  const CURRENCIES = [
    { code: "INR", symbol: "₹", locale: "en-IN" },
    { code: "USD", symbol: "$", locale: "en-US" },
    { code: "EUR", symbol: "€", locale: "en-IE" },
    { code: "GBP", symbol: "£", locale: "en-GB" },
    { code: "AED", symbol: "AED", locale: "en-AE" },
  ];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const ICONS = {
    home: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 11 12 4l8 7v9H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20v-6h4v6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    list: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    share: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="8" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.7 10.5 13.3 8.5M10.7 13.5 13.3 15.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
    sun: '<svg class="icon-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    moon: '<svg class="icon-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M16.5 13A7 7 0 1 1 11 5.5 5.5 5.5 0 0 0 16.5 13Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    prev: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15.5 5 8.5 12l7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    next: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8.5 5 15.5 12l-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bell: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 19c1.2-3 3.6-4.5 7-4.5s5.8 1.5 7 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7.5h16v12H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M4 7.5 8 4h12v3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M15 13.5h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    chart: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 19h16M7 16V9M12 16V5M17 16v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    users: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c.8-3 2.8-4.5 6-4.5s5.2 1.5 6 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 19c.5-1.8 1.7-3 3.8-3.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    activity: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18.5" cy="19" r="2.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8h4l2-2h4l2 2h4v12H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="14" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    arrowOut: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 16 16 8M10 8h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowIn: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M16 8 8 16M14 16H8v-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    wa: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 19 6.2 15.4A7.5 7.5 0 1 1 8.6 17.8L5 19Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9.2 9.6c.2-.5.3-.5.6-.5h.5c.2 0 .4.1.5.4l.5 1.2c.1.2 0 .4-.1.6l-.4.5c-.1.1-.1.3 0 .4.3.6.8 1.1 1.4 1.4.2.1.3.1.4 0l.5-.4c.2-.2.4-.2.6-.1l1.2.5c.3.1.4.3.4.5v.5c0 .3 0 .4-.5.6A5 5 0 0 1 11 14.8 5.8 5.8 0 0 1 9.2 9.6Z" fill="currentColor"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.1 6.1l1.6 1.6M16.3 16.3l1.6 1.6M6.1 17.9l1.6-1.6M16.3 7.7l1.6-1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  };

  const PAGES = [
    { href: "dashboard.html", id: "dashboard", label: "Home" },
    { href: "add-expense.html", id: "add", label: "Add" },
    { href: "activity.html", id: "activity", label: "Activity" },
    { href: "expenses.html", id: "expenses", label: "Expenses" },
    { href: "personal.html", id: "personal", label: "Personal" },
    { href: "analytics.html", id: "analytics", label: "Analytics" },
    { href: "members.html", id: "members", label: "Members" },
    { href: "settle.html", id: "settle", label: "Settle" },
    { href: "room.html", id: "room", label: "Room" },
    { href: "profile.html", id: "profile", label: "Profile" },
  ];

  let sb = null;
  let session = null;
  let profile = null;
  let currency = "INR";

  const THEME_CHROME = { light: "#F4F4F2", dark: "#10150C" };
  function cssToken(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) return v;
    } catch (e) { /* ignore */ }
    return fallback;
  }
  function themeChromeColor(theme) {
    return THEME_CHROME[theme] || THEME_CHROME.dark;
  }
  function applyThemeColor(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", themeChromeColor(theme));
  }
  function applyThemeEarly() {
    try {
      let t = localStorage.getItem(THEME_KEY);
      if (t !== "light" && t !== "dark") {
        t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      }
      document.documentElement.setAttribute("data-theme", t);
      applyThemeColor(t);
    } catch (e) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }
  applyThemeEarly();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function errorMessage(err) {
    if (!err) return "Something went wrong.";
    return (err.message || err.error_description || String(err))
      .replace(/^.*?(Not authenticated|You are not a member of this room|Payer must be a room member|All participants must be room members|Splits must add up to the expense amount|At least one split is required|Only the person who added this expense can edit it|Expense not found|Enter a valid 6-character join code|No room found for that code|Room name is required)/i, "$1");
  }
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    applyThemeColor(theme);
    syncThemeToggle();
    try { window.dispatchEvent(new CustomEvent("mb-theme-change", { detail: { theme } })); } catch (e) { /* ignore */ }
  }
  function themeToggleLabel() {
    return currentTheme() === "dark" ? "Switch to light theme" : "Switch to dark theme";
  }
  function syncThemeToggle() {
    const btn = $("theme-toggle");
    if (!btn) return;
    const label = themeToggleLabel();
    btn.setAttribute("aria-label", label);
    btn.setAttribute("title", label);
  }
  function currencyMeta() {
    return CURRENCIES.find((c) => c.code === currency) || CURRENCIES[0];
  }
  function formatMoney(amount) {
    const meta = currencyMeta();
    const n = Number(amount) || 0;
    const whole = Math.abs(n - Math.round(n)) < 0.005;
    try {
      return new Intl.NumberFormat(meta.locale, {
        style: "currency", currency: meta.code,
        minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2,
      }).format(whole ? Math.round(n) : n);
    } catch (e) {
      return meta.symbol + (whole ? String(Math.round(n)) : n.toFixed(2));
    }
  }
  function toCents(amount) { return Math.round(Number(amount) * 100); }
  function fromCents(cents) { return cents / 100; }
  function monthKey(date) {
    if (typeof date === "string") return date.slice(0, 7);
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
  }
  function parseMonth(key) {
    const [y, m] = String(key).split("-").map(Number);
    return { year: y, month: m - 1 };
  }
  function monthLabel(key) {
    const { year, month } = parseMonth(key);
    return MONTHS[month] + " " + year;
  }
  function monthBounds(key) {
    const { year, month } = parseMonth(key);
    const start = key + "-01";
    const last = new Date(year, month + 1, 0).getDate();
    const end = key + "-" + String(last).padStart(2, "0");
    return { start, end };
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function getSelectedMonth() {
    const q = new URLSearchParams(location.search).get("month");
    if (q && /^\d{4}-\d{2}$/.test(q)) return q;
    try {
      const saved = localStorage.getItem(MONTH_KEY);
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    } catch (e) { /* ignore */ }
    return monthKey(new Date());
  }
  function setSelectedMonth(key) {
    try { localStorage.setItem(MONTH_KEY, key); } catch (e) { /* ignore */ }
    const url = new URL(location.href);
    url.searchParams.set("month", key);
    history.replaceState(null, "", url);
  }
  function shiftMonth(key, delta) {
    const { year, month } = parseMonth(key);
    const d = new Date(year, month + delta, 1);
    return monthKey(d);
  }
  function currentPage() {
    let file = (location.pathname.split("/").pop() || "index.html");
    if (!file) file = "index.html";
    if (!file.includes(".")) file = file + ".html";
    return file;
  }
  function configured() {
    return Boolean(window.SUPABASE_URL && window.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);
  }
  function client() {
    if (!sb) {
      if (!configured()) throw new Error("This app is not connected to a database yet.");
      sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
    return sb;
  }
  function uid() { return session && session.user ? session.user.id : null; }
  function getActiveRoomId() {
    try { return localStorage.getItem(ROOM_KEY) || ""; } catch (e) { return ""; }
  }
  function setActiveRoomId(id) {
    try {
      if (id) localStorage.setItem(ROOM_KEY, id);
      else localStorage.removeItem(ROOM_KEY);
    } catch (e) { /* ignore */ }
  }

  function equalSplits(amount, userIds) {
    const ids = userIds.slice();
    if (!ids.length) return [];
    const cents = toCents(amount);
    const base = Math.floor(cents / ids.length);
    let rem = cents - base * ids.length;
    return ids.map((id, i) => ({ user_id: id, share_amount: fromCents(base + (i < rem ? 1 : 0)) }));
  }

  function memberBalances(members, expenses, splits, settlements) {
    const map = new Map();
    members.forEach((m) => {
      map.set(m.id, { id: m.id, name: m.display_name || "Member", paid: 0, share: 0, collected: 0, pendingIn: 0, pendingOut: 0, sent: 0, received: 0, net: 0, avatar_url: m.avatar_url, pendingFrom: [], pendingTo: [] });
    });
    const ensure = (id) => {
      if (!map.has(id)) map.set(id, { id, name: "Member", paid: 0, share: 0, collected: 0, pendingIn: 0, pendingOut: 0, sent: 0, received: 0, net: 0, pendingFrom: [], pendingTo: [] });
      return map.get(id);
    };
    const addPending = (list, id, name, cents) => {
      const row = list.find((x) => x.id === id);
      if (row) row.amount += cents;
      else list.push({ id, name, amount: cents });
    };
    const settlementConfirmed = (s) => {
      const st = String(s && s.status || "").toLowerCase();
      if (st === "pending" || st === "cancelled" || st === "canceled" || st === "declined" || st === "rejected") return false;
      if (st === "confirmed" || st === "received" || st === "completed") return true;
      if (s && s.confirmed_at) return true;
      // Legacy rows with no status were treated as confirmed payments.
      return !st;
    };
    const expenseById = new Map((expenses || []).map((e) => [e.id, e]));
    expenses.forEach((e) => { ensure(e.paid_by).paid += toCents(e.amount); });
    splits.forEach((s) => {
      const cents = toCents(s.share_amount);
      const exp = expenseById.get(s.expense_id);
      if (s.status === "accepted") {
        ensure(s.user_id).share += cents;
        if (exp) ensure(exp.paid_by).collected += cents;
      } else if (s.status === "pending") {
        if (exp && exp.paid_by !== s.user_id) {
          const payer = ensure(exp.paid_by);
          const debtor = ensure(s.user_id);
          payer.pendingIn += cents;
          debtor.pendingOut += cents;
          addPending(payer.pendingFrom, debtor.id, debtor.name, cents);
          addPending(debtor.pendingTo, payer.id, payer.name, cents);
        }
      }
    });
    settlements.forEach((s) => {
      if (!settlementConfirmed(s)) return;
      ensure(s.from_user).sent += toCents(s.amount);
      ensure(s.to_user).received += toCents(s.amount);
    });
    for (const row of map.values()) {
      // Only accepted shares count toward the balance. "I paid" still shows the full amount.
      row.net = row.collected - row.share + row.sent - row.received;
      row.paidAmt = fromCents(row.paid);
      row.shareAmt = fromCents(row.share);
      row.netAmt = fromCents(row.net);
      row.pendingInAmt = fromCents(row.pendingIn);
      row.pendingOutAmt = fromCents(row.pendingOut);
      row.sentAmt = fromCents(row.sent);
      row.receivedAmt = fromCents(row.received);
    }
    return Array.from(map.values());
  }
  function andNames(names) {
    const list = (names || []).filter(Boolean);
    if (!list.length) return "Someone";
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + " and " + list[1];
    return list.slice(0, -1).join(", ") + ", and " + list[list.length - 1];
  }
  function balanceFootnote(row) {
    if (!row) return "";
    const parts = [];
    const pendingFrom = row.pendingFrom || [];
    const pendingTo = row.pendingTo || [];
    if ((row.pendingInAmt || 0) > 0.004) {
      if (pendingFrom.length === 1) {
        parts.push(pendingFrom[0].name + " hasn't accepted " + formatMoney(fromCents(pendingFrom[0].amount)) + " yet");
      } else if (pendingFrom.length) {
        parts.push(andNames(pendingFrom.map((p) => p.name)) + " haven't accepted " + formatMoney(row.pendingInAmt) + " yet");
      } else {
        parts.push(formatMoney(row.pendingInAmt) + " still waiting to be accepted");
      }
    }
    if ((row.pendingOutAmt || 0) > 0.004) {
      parts.push("Your " + formatMoney(row.pendingOutAmt) + " share hasn't been accepted yet");
    }
    // Only confirmed settlements count as money already received or paid.
    if ((row.receivedAmt || 0) > 0.004 && (row.sentAmt || 0) > 0.004) {
      parts.push("After " + formatMoney(row.receivedAmt) + " already received and " + formatMoney(row.sentAmt) + " already paid");
    } else if ((row.receivedAmt || 0) > 0.004) {
      parts.push("After " + formatMoney(row.receivedAmt) + " already received");
    } else if ((row.sentAmt || 0) > 0.004) {
      parts.push("After " + formatMoney(row.sentAmt) + " already paid to roommates");
    }
    if (!parts.length) return "";
    return parts.map((p) => p.endsWith(".") ? p : p + ".").join(" ");
  }
  function paintBalanceNote(id, row) {
    const el = $(id);
    if (!el) return;
    const text = balanceFootnote(row);
    el.hidden = !text;
    el.textContent = text || "";
  }

  // net > 0: others owe this person. net < 0: this person owes.
  function settleSuggestions(balances) {
    const creditors = balances.filter((b) => b.net > 0).map((b) => ({ ...b, left: b.net })).sort((a, b) => b.left - a.left);
    const debtors = balances.filter((b) => b.net < 0).map((b) => ({ ...b, left: -b.net })).sort((a, b) => b.left - a.left);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].left, creditors[j].left);
      if (pay > 0) {
        transfers.push({ from: debtors[i], to: creditors[j], amount: fromCents(pay) });
        debtors[i].left -= pay;
        creditors[j].left -= pay;
      }
      if (debtors[i].left <= 0) i += 1;
      if (creditors[j].left <= 0) j += 1;
    }
    return transfers;
  }

  async function loadProfile() {
    const { data, error } = await client().from("profiles").select("id, display_name, currency, personal_budget_limit, phone, upi_id, avatar_url").eq("id", uid()).maybeSingle();
    if (error) throw error;
    if (!data) {
      const email = session.user.email || "";
      const fallback = (session.user.user_metadata && session.user.user_metadata.display_name) || email.split("@")[0] || "You";
      const inserted = await client().from("profiles").insert({ id: uid(), display_name: fallback, currency: "INR" }).select("id, display_name, currency, personal_budget_limit, phone, upi_id, avatar_url").maybeSingle();
      profile = inserted.data || { id: uid(), display_name: fallback, currency: "INR" };
    } else {
      profile = data;
    }
    if (profile.currency && CURRENCIES.some((c) => c.code === profile.currency)) currency = profile.currency;
    return profile;
  }

  async function loadRooms() {
    const { data, error } = await client()
      .from("room_members")
      .select("room_id, joined_at, role, rooms (id, name, code, owner_id, created_at, description, currency, monthly_budget_limit, default_split_method, categories, members_can_add_expenses, require_join_approval, type, start_date, end_date, archived_at)")
      .eq("user_id", uid())
      .order("joined_at", { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => row.rooms ? { ...row.rooms, role: row.role, joined_at: row.joined_at } : null).filter(Boolean);
  }

  async function resolveActiveRoom(rooms) {
    if (!rooms.length) {
      setActiveRoomId("");
      return null;
    }
    const current = getActiveRoomId();
    const found = rooms.find((r) => r.id === current);
    const room = found || rooms[0];
    setActiveRoomId(room.id);
    return room;
  }

  async function loadMembers(roomId) {
    const { data: members, error } = await client().from("room_members").select("user_id, joined_at, role").eq("room_id", roomId).order("joined_at");
    if (error) throw error;
    const ids = (members || []).map((m) => m.user_id);
    let profiles = [];
    if (ids.length) {
      const { data, error: pErr } = await client().from("profiles").select("id, display_name, avatar_url, phone, upi_id").in("id", ids);
      if (pErr) throw pErr;
      profiles = data || [];
    }
    return (members || []).map((m) => {
      const p = profiles.find((row) => row.id === m.user_id);
      return { id: m.user_id, display_name: (p && p.display_name) || "Member", avatar_url: p && p.avatar_url, phone: p && p.phone, upi_id: p && p.upi_id, joined_at: m.joined_at, role: m.role || "member" };
    });
  }

  async function loadMonthData(roomId, month) {
    const { start, end } = monthBounds(month);
    const [exRes, setRes] = await Promise.all([
      client().from("room_expenses").select("id, room_id, paid_by, created_by, amount, description, category, date, created_at, receipt_path, original_amount, original_currency, fx_rate, tax_amount, tip_amount").eq("room_id", roomId).gte("date", start).lte("date", end).order("date", { ascending: false }),
      client().from("settlements").select("id, room_id, from_user, to_user, amount, date, note, created_by, created_at, status, confirmed_at, confirmed_by").eq("room_id", roomId).gte("date", start).lte("date", end).order("date", { ascending: false }),
    ]);
    if (exRes.error) throw exRes.error;
    if (setRes.error) throw setRes.error;
    const expenses = exRes.data || [];
    const settlements = setRes.data || [];
    let splits = [];
    if (expenses.length) {
      const { data, error } = await client().from("expense_splits").select("expense_id, user_id, share_amount, status, responded_at, forced_by, forced_at").in("expense_id", expenses.map((e) => e.id));
      if (error) throw error;
      splits = data || [];
    }
    return { expenses, splits, settlements };
  }

  async function maybeJoinPendingCode() {
    const params = new URLSearchParams(location.search);
    const q = (params.get("code") || "").trim();
    if (q) {
      try { sessionStorage.setItem(PENDING_CODE_KEY, q.toUpperCase()); } catch (e) { /* ignore */ }
    }
    // The invite page shows a Join prompt; do not auto-submit there.
    if (currentPage() === "invite.html") return null;
    let code = q;
    try { code = code || sessionStorage.getItem(PENDING_CODE_KEY) || ""; } catch (e) { /* ignore */ }
    if (!code) return null;
    const { data, error } = await client().rpc("join_room", { p_code: code });
    if (!error && data) {
      try { sessionStorage.removeItem(PENDING_CODE_KEY); } catch (e) { /* ignore */ }
      if (data.status === "pending") {
        try { sessionStorage.setItem("monthly-budget-join-pending", JSON.stringify(data)); } catch (e) { /* ignore */ }
        return data;
      }
      setActiveRoomId(data.id);
      return data;
    }
    return null;
  }

  function isAdmin(room) {
    const role = room && room.role;
    return role === "owner" || role === "admin";
  }
  function isOwner(room) { return !!(room && room.role === "owner"); }
  function roleLabel(role) {
    if (role === "owner") return "Owner";
    if (role === "admin") return "Admin";
    return "Member";
  }
  function roomCategories(room) {
    if (room && Array.isArray(room.categories) && room.categories.length) return room.categories;
    return CATEGORIES.slice();
  }

  async function loadUnreadCount() {
    const { count, error } = await client().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", uid()).is("read_at", null);
    if (error) throw error;
    return count || 0;
  }
  function setNotifBadge(count) {
    const n = Number(count) || 0;
    document.querySelectorAll("[data-notif-badge]").forEach((el) => {
      el.hidden = n < 1;
      el.textContent = n < 1 ? "" : String(n);
    });
  }
  let notifTimer = null;
  let notifChannel = null;
  function startNotifWatch() {
    const tick = async () => {
      try { setNotifBadge(await loadUnreadCount()); } catch (e) { /* ignore */ }
    };
    if (notifTimer) clearInterval(notifTimer);
    notifTimer = setInterval(tick, 30000);
    try {
      if (notifChannel) client().removeChannel(notifChannel);
      notifChannel = client().channel("notifications-" + uid());
      notifChannel.on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: "user_id=eq." + uid() }, tick).subscribe();
    } catch (e) { /* polling is enough */ }
  }



  function acceptedSplits(splits) {
    return (splits || []).filter((s) => s.status === "accepted");
  }

  function splitStatusKey(splitOrStatus) {
    if (splitOrStatus && typeof splitOrStatus === "object") {
      if (splitOrStatus.forced_at || splitOrStatus.forced_by) return "forced";
      return splitOrStatus.status || "pending";
    }
    return splitOrStatus || "pending";
  }
  function splitStatusLabel(status) {
    const key = splitStatusKey(status);
    if (key === "accepted") return "Accepted";
    if (key === "declined") return "Declined";
    if (key === "forced") return "Forced";
    return "Pending";
  }
  function statusChip(splitOrStatus, name) {
    const key = splitStatusKey(splitOrStatus);
    const label = splitStatusLabel(key);
    const who = name ? escapeHtml(name) + " · " : "";
    return `<span class="status-pill is-${escapeHtml(key)}">${who}${escapeHtml(label)}</span>`;
  }
  function splitStatusSummary(splits, members) {
    return (splits || []).map((s) => {
      const name = displayName(s.user_id, members);
      return name + " " + splitStatusLabel(s).toLowerCase();
    }).join(" · ");
  }
  function friendlyDate(iso) {
    if (!iso) return "";
    const day = String(iso).slice(0, 10);
    const today = todayISO();
    if (day === today) return "Today";
    const y = new Date(today + "T00:00:00");
    y.setDate(y.getDate() - 1);
    const yest = y.getFullYear() + "-" + String(y.getMonth() + 1).padStart(2, "0") + "-" + String(y.getDate()).padStart(2, "0");
    if (day === yest) return "Yesterday";
    const d = new Date(day + "T00:00:00");
    if (Number.isNaN(d.getTime())) return day;
    const short = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const label = d.getDate() + " " + short[d.getMonth()];
    const now = new Date(today + "T00:00:00");
    return d.getFullYear() === now.getFullYear() ? label : label + " " + d.getFullYear();
  }
  function daysLeftInMonth(key) {
    const end = monthBounds(key || getSelectedMonth()).end;
    const today = todayISO();
    if (today > end) return 0;
    const a = new Date(today + "T00:00:00");
    const b = new Date(end + "T00:00:00");
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  function categoryIcon(name) {
    return CAT_ICONS[name] || CAT_ICONS.Other || "📦";
  }
  function categoryChip(name) {
    const color = colorForCategory(name);
    return `<span class="cat-chip" style="--cat:${escapeHtml(color)}"><span class="cat-ico" aria-hidden="true">${categoryIcon(name)}</span>${escapeHtml(name || "Other")}</span>`;
  }
  function infoTip(text) {
    return `<details class="info-tip"><summary aria-label="What this means"><span aria-hidden="true">i</span></summary><p>${escapeHtml(text)}</p></details>`;
  }
  function emptyState(opts) {
    const o = opts || {};
    const cta = o.href && o.cta ? `<a class="primary-btn" href="${escapeHtml(o.href)}">${escapeHtml(o.cta)}</a>` : "";
    return `<div class="empty-state">
      <h2 class="display-title">${escapeHtml(o.title || "Nothing here yet")}</h2>
      <p>${escapeHtml(o.text || "")}</p>
      ${cta}
    </div>`;
  }
  function memberNetChip(netAmt) {
    if (Math.abs(netAmt) < 0.005) return `<span class="net-chip is-settled">settled</span>`;
    if (netAmt > 0) return `<span class="net-chip is-good">gets back ${escapeHtml(formatMoney(netAmt))}</span>`;
    return `<span class="net-chip is-bad">owes ${escapeHtml(formatMoney(Math.abs(netAmt)))}</span>`;
  }
  function balanceHeadline(userId, balances) {
    const mine = (balances || []).find((b) => b.id === userId);
    const netAmt = mine && mine.netAmt != null ? Number(mine.netAmt) : 0;
    // Same source as the "My balance" line (netLabel / memberBalances.netAmt).
    if (Math.abs(netAmt) < 0.005) {
      return { text: "You're all settled 🎉", cls: "is-settled", direction: "settled", counterpart: null, amount: 0 };
    }
    const transfers = settleSuggestions(balances || []);
    const paying = transfers.filter((x) => x.from.id === userId).sort((a, b) => b.amount - a.amount)[0];
    const receiving = transfers.filter((x) => x.to.id === userId).sort((a, b) => b.amount - a.amount)[0];
    if (netAmt < 0 && paying && Math.abs(paying.amount - Math.abs(netAmt)) < 0.05) {
      return { text: "You owe " + paying.to.name + " " + formatMoney(paying.amount), cls: "is-owe", direction: "owe", counterpart: paying.to, amount: paying.amount };
    }
    if (netAmt > 0 && receiving && Math.abs(receiving.amount - netAmt) < 0.05) {
      return { text: receiving.from.name + " owes you " + formatMoney(receiving.amount), cls: "is-owed", direction: "owed", counterpart: receiving.from, amount: receiving.amount };
    }
    if (netAmt > 0) {
      return { text: "You'll get " + formatMoney(netAmt), cls: "is-owed", direction: "owed", counterpart: receiving && receiving.from, amount: netAmt };
    }
    return { text: "You owe " + formatMoney(Math.abs(netAmt)), cls: "is-owe", direction: "owe", counterpart: paying && paying.to, amount: Math.abs(netAmt) };
  }

  function remindWhatsAppHref(headline, room) {
    const roomName = (room && room.name) || "our room";
    let msg;
    if (headline && headline.direction === "owe" && headline.counterpart) {
      msg = "Hi " + headline.counterpart.name + "! Just a reminder that I owe you " + formatMoney(headline.amount) + " for " + roomName + " on Monthly Budget this month.";
    } else if (headline && headline.direction === "owed" && headline.counterpart) {
      msg = "Hi " + headline.counterpart.name + "! Just a reminder that you owe me " + formatMoney(headline.amount) + " for " + roomName + " on Monthly Budget this month. Let's settle up when you can.";
    } else if (headline && headline.direction === "settled") {
      msg = "We're all settled up for " + roomName + " on Monthly Budget this month 🎉";
    } else {
      return "";
    }
    return "https://wa.me/?text=" + encodeURIComponent(msg);
  }
  function monthSpendSentence(spent, limit, monthKey) {
    if (limit > 0) {
      const left = Math.max(0, Number(limit) - Number(spent));
      const days = daysLeftInMonth(monthKey);
      const dayText = days <= 0 ? "the month is over" : (days === 1 ? "1 day to go" : days + " days to go");
      return formatMoney(spent) + " of " + formatMoney(limit) + " used, " + formatMoney(left) + " left, " + dayText;
    }
    return formatMoney(spent) + " spent this month";
  }
  function expenseRowHtml(expense, opts) {
    const o = opts || {};
    const members = o.members || [];
    const allSplits = o.splits || [];
    const splits = allSplits.filter((s) => s.expense_id === expense.id);
    const href = o.href || ("add-expense.html?id=" + expense.id);
    const receipt = o.receipt || "";
    const payer = memberRecord(expense.paid_by, members);
    const minePaid = expense.paid_by === uid();
    const mine = splits.find((s) => s.user_id === uid());
    const shareBit = mine ? " · your share " + formatMoney(mine.share_amount) : "";
    const fx = expense.original_currency && expense.original_amount
      ? " · was " + expense.original_amount + " " + expense.original_currency
      : "";
    const title = expense.description || "Expense";
    const subKind = minePaid ? "Paid" : "From " + displayName(expense.paid_by, members);
    return `<a class="list-item expense-row" href="${escapeHtml(href)}">
      <span class="tx-icon ${minePaid ? "is-out" : "is-in"}" aria-hidden="true">${minePaid ? ICONS.arrowOut : ICONS.arrowIn}</span>
      <div>
        <div class="item-title">${personChip(payer, members, "avatar-sm")}<span>${escapeHtml(title)}${escapeHtml(fx)}</span></div>
        <div class="item-sub">${escapeHtml(subKind)} · ${escapeHtml(friendlyDate(expense.date))}${escapeHtml(shareBit)}</div>
        ${receipt}
      </div>
      <div class="item-amt ${minePaid ? "" : "pos"}">${minePaid ? "" : "+"}${escapeHtml(formatMoney(expense.amount))}</div>
    </a>`;
  }
  function renderOnboardingTip(host) {
    if (!host) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem("mb-onboard-tips") === "1"; } catch (e) { dismissed = false; }
    if (dismissed) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.innerHTML = `
      <header class="card-head">
        <div>
          <h2>A quick look around</h2>
          <p class="card-sub">The big line at the top is your bottom line. Rose means you need to pay someone; lime means money is coming back to you.</p>
        </div>
      </header>
      <ul class="tip-list">
        <li>Your share is the part of each bill that belongs to you, once you accept it.</li>
        <li>Settle up when you pay or get paid, so balances go back to zero.</li>
        <li>An admin can mark a share as accepted if someone does not respond.</li>
      </ul>
      <button type="button" class="secondary-btn" id="dismiss-tips">Got it</button>`;
    const btn = host.querySelector("#dismiss-tips");
    if (btn) btn.addEventListener("click", () => {
      try { localStorage.setItem("mb-onboard-tips", "1"); } catch (e) { /* ignore */ }
      host.hidden = true;
    });
  }

  async function loadPendingRequests(roomId) {
    if (!roomId) return [];
    const { data: splits, error } = await client()
      .from("expense_splits")
      .select("expense_id, user_id, share_amount, status, responded_at, forced_by, forced_at")
      .eq("user_id", uid())
      .eq("status", "pending");
    if (error) throw error;
    const ids = [...new Set((splits || []).map((s) => s.expense_id))];
    if (!ids.length) return [];
    const { data: expenses, error: exErr } = await client()
      .from("room_expenses")
      .select("id, room_id, paid_by, created_by, amount, description, category, date")
      .in("id", ids)
      .eq("room_id", roomId)
      .order("date", { ascending: false });
    if (exErr) throw exErr;
    const byId = new Map((expenses || []).map((e) => [e.id, e]));
    return (splits || []).map((s) => ({ ...s, expense: byId.get(s.expense_id) })).filter((s) => s.expense);
  }

  async function respondToShare(expenseId, accept) {
    const { data, error } = await client().rpc("respond_to_share", { p_expense_id: expenseId, p_accept: accept });
    if (error) throw error;
    return data;
  }

  function renderPendingItems(host, requests, members) {
    if (!host) return;
    if (!requests.length) {
      host.innerHTML = `<p class="empty">No pending share requests.</p>`;
      return;
    }
    host.innerHTML = requests.map((r) => {
      const e = r.expense;
      const payer = memberRecord(e.paid_by, members);
      return `<article class="pending-card" data-expense-id="${escapeHtml(e.id)}">
        <div>
          <div class="item-title">${escapeHtml(e.description)}</div>
          <div class="item-sub">${categoryChip(e.category)} · ${escapeHtml(friendlyDate(e.date))} · paid by ${personChip(payer, members, "avatar-sm")}</div>
          <div class="item-sub">Your share ${escapeHtml(formatMoney(r.share_amount))} ${infoTip("Your share is the part of this expense that you are responsible for.")}</div>
        </div>
        <div class="btn-row compact">
          <button type="button" class="primary-btn" data-accept="${escapeHtml(e.id)}">Accept</button>
          <button type="button" class="danger-btn ghost" data-decline="${escapeHtml(e.id)}">Decline</button>
        </div>
      </article>`;
    }).join("");
    host.querySelectorAll("[data-accept], [data-decline]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const accept = btn.hasAttribute("data-accept");
        const id = btn.getAttribute("data-accept") || btn.getAttribute("data-decline");
        btn.disabled = true;
        try {
          await respondToShare(id, accept);
          location.reload();
        } catch (err) {
          showPageError(errorMessage(err));
          btn.disabled = false;
        }
      });
    });
  }

  let pendingCount = 0;
  function setPendingBadge(count) {
    const n = Number(count) || 0;
    pendingCount = n;
    document.querySelectorAll("[data-pending-badge]").forEach((el) => {
      el.hidden = n < 1;
      el.textContent = n < 1 ? "" : String(n);
    });
  }

  function displayName(userId, members) {
    if (userId === uid()) return (profile && profile.display_name) ? profile.display_name : "You";
    const m = (members || []).find((x) => x.id === userId);
    return (m && m.display_name) || "Member";
  }

  function netLabel(netAmt) {
    if (Math.abs(netAmt) < 0.005) return { text: "Settled up", cls: "" };
    if (netAmt > 0) return { text: "You'll get " + formatMoney(netAmt), cls: "is-good" };
    return { text: "You owe " + formatMoney(Math.abs(netAmt)), cls: "is-bad" };
  }

  const MORE_PAGES = ["my-share.html", "settle.html", "room.html", "profile.html", "requests.html", "room-settings.html", "expenses.html", "notifications.html", "invite.html", "members.html", "member.html", "analytics.html"];

  function injectShell(options) {
    const page = currentPage();
    const month = options.month ? getSelectedMonth() : null;
    const header = document.getElementById("topbar");
    if (header) {
      header.className = "topbar";
      if (page === "profile.html") {
        document.body.classList.add("profile-page");
        header.innerHTML = `
          <div class="profile-top">
            <a class="back-btn" href="dashboard.html" aria-label="Back">${ICONS.prev}</a>
          </div>`;
      } else {
      header.innerHTML = `
        <a class="brand" href="dashboard.html" title="Monthly Budget home">
          <img class="brand-logo" src="${withBase("favicon.svg")}" width="32" height="32" alt="" />
          <div class="brand-text">
            <p class="brand-kicker">Monthly Budget</p>
            <h1 id="room-name" class="room-name">Monthly Budget</h1>
          </div>
        </a>
        <nav class="desktop-nav" aria-label="Main">
          ${PAGES.filter((p) => p.id !== "profile" && p.id !== "expenses").map((p) => `<a href="${p.href}" class="${p.href === page || (p.id === "members" && page === "member.html") ? "is-active" : ""}">${escapeHtml(p.label)}${p.id === "requests" ? `<span class="badge" data-pending-badge hidden></span>` : ""}</a>`).join("")}
        </nav>
        <div class="top-actions">
          <a class="top-avatar" href="profile.html" id="header-profile" aria-label="Profile" title="Profile">${avatarHtml({ display_name: (profile && profile.display_name) || "You", avatar_url: profile && profile.avatar_url, id: uid() }, "avatar-row")}</a>
          <a class="icon-btn pill-btn requests-link" href="notifications.html" aria-label="Notifications" title="Notifications">
            ${ICONS.bell}<span class="badge" data-notif-badge hidden></span>
          </a>
          <button type="button" class="icon-btn pill-btn" id="theme-toggle" aria-label="${escapeHtml(themeToggleLabel())}" title="${escapeHtml(themeToggleLabel())}">${ICONS.sun}${ICONS.moon}</button>
        </div>`;
      }
    }
    const bottom = document.getElementById("bottom-nav");
    if (bottom) {
      bottom.className = "bottom-nav";
      const items = [
        { href: "dashboard.html", label: "Home", icon: ICONS.home, id: "dashboard.html" },
        { href: "add-expense.html", label: "Add", icon: ICONS.plus, id: "add-expense.html" },
        { href: "activity.html", label: "Activity", icon: ICONS.activity, id: "activity.html" },
        { href: "personal.html", label: "Personal", icon: ICONS.wallet, id: "personal.html" },
      ];
      bottom.innerHTML = items.map((item) =>
        `<a href="${item.href}" class="${page === item.id || (item.also || []).includes(page) ? "is-active" : ""}">${item.icon}<span>${item.label}</span></a>`
      ).join("") + `<button type="button" id="more-btn" aria-label="More options, including settle up" title="More, including settle up" ${MORE_PAGES.includes(page) ? 'class="is-active"' : ""}>${ICONS.more}<span>More</span></button>`;
    }
    if (month) injectMonthBar(month);
    syncThemeToggle();
    $("theme-toggle") && $("theme-toggle").addEventListener("click", () => {
      setTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    const more = $("more-btn");
    if (more) more.addEventListener("click", openMoreSheet);
    enhancePasswordFields();
    injectFab();
    setupPrefetch();
  }

  function injectMonthBar(month) {
    const header = document.getElementById("topbar");
    let chrome = document.querySelector(".app-chrome");
    if (header && !chrome) {
      chrome = document.createElement("div");
      chrome.className = "app-chrome";
      header.parentNode.insertBefore(chrome, header);
      chrome.appendChild(header);
    }
    const main = document.getElementById("main") || document.querySelector("main.page");
    let bar = document.getElementById("month-picker");
    if (!bar) bar = document.querySelector(".month-bar");
    if (!bar || bar.closest("#month-card, #budget-card")) {
      bar = document.createElement("div");
      bar.id = "month-picker";
      bar.className = "month-bar";
      if (chrome) chrome.appendChild(bar);
      else if (main) main.insertBefore(bar, main.firstChild);
    } else {
      bar.id = "month-picker";
      if (chrome && bar.parentNode !== chrome) chrome.appendChild(bar);
    }
    bar.hidden = false;
    const label = monthLabel(month);
    bar.innerHTML = `
      <button type="button" class="month-nav" id="prev-month" aria-label="Previous month" title="Previous month">${ICONS.prev}</button>
      <div class="month-current-wrap">
        <span class="month-current" id="month-open">${escapeHtml(label)}</span>
        <input type="month" id="month-input" class="month-native" value="${escapeHtml(month)}" aria-label="Select month, currently ${escapeHtml(label)}" title="Select month" />
      </div>
      <button type="button" class="month-nav" id="next-month" aria-label="Next month" title="Next month">${ICONS.next}</button>`;
    const go = (key) => {
      if (!key || !/^\d{4}-\d{2}$/.test(key)) return;
      setSelectedMonth(key);
      location.reload();
    };
    $("prev-month").addEventListener("click", () => go(shiftMonth(getSelectedMonth(), -1)));
    $("next-month").addEventListener("click", () => go(shiftMonth(getSelectedMonth(), 1)));
    $("month-input").addEventListener("change", (e) => go(e.target.value));
  }

  let moreSheetPushed = false;
  function moreRow(href, icon, label, badgeAttr) {
    return `<a class="sheet-row" href="${href}">
      <span class="sheet-icon" aria-hidden="true">${icon}</span>
      <span class="sheet-label">${label}</span>
      ${badgeAttr ? `<span class="badge" ${badgeAttr} hidden></span>` : ""}
      <span class="sheet-chevron" aria-hidden="true">${ICONS.chevron}</span>
    </a>`;
  }
  function hideFabMenu() {
    const root = document.getElementById("fab-root");
    const scrim = document.getElementById("fab-scrim");
    const btn = document.getElementById("fab-btn");
    const dial = document.getElementById("fab-dial");
    if (root) root.classList.remove("is-open");
    if (dial) dial.hidden = true;
    if (scrim) scrim.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("fab-menu-open");
  }
  function onMoreKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMoreSheet();
    }
  }
  function onMorePopState() {
    closeMoreSheet({ fromPop: true });
  }
  function openMoreSheet() {
    closeMoreSheet({ skipHistory: true });
    hideFabMenu();
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.id = "more-sheet";
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="more-sheet-title">
      <header class="sheet-head">
        <p class="sheet-title" id="more-sheet-title">More</p>
        <button type="button" class="sheet-close" id="sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <nav class="sheet-list">
        ${moreRow("analytics.html", ICONS.chart, "Analytics")}
        ${moreRow("members.html", ICONS.users, "Members")}
        ${moreRow("notifications.html", ICONS.bell, "Notifications", "data-notif-badge")}
        ${moreRow("my-share.html", ICONS.wallet, "My share")}
        ${moreRow("settle.html", ICONS.arrowIn, "Settle up")}
        ${moreRow("requests.html", ICONS.list, "Share requests", "data-pending-badge")}
        ${moreRow("room.html", ICONS.home, "Room &amp; invite")}
        ${moreRow("room-settings.html", ICONS.gear, "Room settings")}
        ${moreRow("expenses.html", ICONS.list, "All expenses")}
        ${moreRow("profile.html", ICONS.user, "Profile")}
      </nav>
    </div>`;
    back.addEventListener("click", (e) => { if (e.target === back) closeMoreSheet(); });
    document.body.appendChild(back);
    document.body.classList.add("more-sheet-open");
    setPendingBadge(pendingCount);
    loadUnreadCount().then(setNotifBadge).catch(() => {});
    const closeBtn = $("sheet-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeMoreSheet);
      try { closeBtn.focus(); } catch (err) { /* ignore */ }
    }
    window.addEventListener("keydown", onMoreKeydown);
    window.addEventListener("popstate", onMorePopState);
    if (!moreSheetPushed) {
      try { history.pushState({ mbMore: 1 }, ""); moreSheetPushed = true; } catch (err) { moreSheetPushed = false; }
    }
  }
  function closeMoreSheet(opts) {
    opts = opts || {};
    const el = $("more-sheet");
    if (el) el.remove();
    document.body.classList.remove("more-sheet-open");
    window.removeEventListener("keydown", onMoreKeydown);
    window.removeEventListener("popstate", onMorePopState);
    if (moreSheetPushed && !opts.fromPop && !opts.skipHistory) {
      moreSheetPushed = false;
      try { if (history.state && history.state.mbMore) history.back(); } catch (err) { /* ignore */ }
    } else {
      moreSheetPushed = false;
    }
  }

  function showPageError(message) {
    const text = message || "Something went wrong. Please refresh and try again.";
    let el = $("page-error-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "page-error-banner";
      el.className = "page-error-banner";
      el.setAttribute("role", "alert");
      const main = document.getElementById("main") || document.querySelector("main") || document.body;
      main.insertBefore(el, main.firstChild);
    }
    el.hidden = false;
    el.textContent = text;
  }
  function showError(id, message) {
    const el = $(id);
    if (!el) { showPageError(message); return; }
    el.hidden = false;
    el.textContent = message;
  }
  function hideError(id) {
    const el = $(id);
    if (el) { el.hidden = true; el.textContent = ""; }
  }

  async function bootAuthPage() {
    if (!configured()) {
      const warn = $("config-warning");
      if (warn) {
        warn.hidden = false;
        warn.textContent = "This app is not connected to a database yet.";
      }
      return { sb: null, session: null };
    }
    const { data } = await client().auth.getSession();
    session = data ? data.session : null;
    if (session) {
      const next = safeNextPath(new URLSearchParams(location.search).get("next") || "dashboard.html");
      location.replace(next);
      return { sb: client(), session };
    }
    const params = new URLSearchParams(location.search);
    if (params.get("code")) {
      try { sessionStorage.setItem(PENDING_CODE_KEY, params.get("code").toUpperCase()); } catch (e) { /* ignore */ }
    }
    return { sb: client(), session: null };
  }

  async function bootApp(options) {
    options = options || {};
    injectShell(options);
    if (!configured()) {
      location.replace("login.html");
      return null;
    }
    const { data } = await client().auth.getSession();
    session = data ? data.session : null;
    if (!session) {
      if (options.allowGuest) {
        return {
          sb: client(), session: null, profile: null, rooms: [], room: null,
          month: getSelectedMonth(), uid: null, pending: [], unread: 0,
          isAdmin: false, isOwner: false, guest: true,
        };
      }
      const next = encodeURIComponent(safeNextPath(currentPage() + location.search));
      location.replace("login.html?next=" + next);
      return null;
    }
    const mainEl = document.getElementById("main");
    if (mainEl) mainEl.classList.add("is-loading");

    const cachedWrap = readCachedState();
    const cached = cachedWrap && cachedWrap.state;
    if (cached && cached.profile && cached.profile.id) {
      profile = cached.profile;
      if (profile.currency && CURRENCIES.some((c) => c.code === profile.currency)) currency = profile.currency;
      paintHeaderAvatar(profile);
      const rname = $("room-name");
      const cachedRoom = (cached.rooms || []).find((r) => r.id === (cached.room_id || getActiveRoomId()));
      if (rname && cachedRoom) rname.textContent = cachedRoom.name;
    }

    await maybeMarkReadFromQuery();
    await maybeJoinPendingCode();

    let applied = null;
    let rooms = [];
    let room = null;
    let pending = [];
    let unread = 0;
    try {
      const { data, error } = await client().rpc("get_app_state", {
        p_room_id: getActiveRoomId() || null,
        p_month: getSelectedMonth(),
      });
      if (error) throw error;
      applied = applyAppState(data);
      rooms = applied.rooms;
      room = applied.room;
      pending = applied.pending || [];
      unread = applied.unread || 0;
      writeCachedState(data);
    } catch (err) {
      console.warn(err);
      await loadProfile();
      paintHeaderAvatar(profile);
      rooms = await loadRooms();
      room = await resolveActiveRoom(rooms);
      if (room) {
        try { await client().rpc("generate_recurring_for_month", { p_room_id: room.id, p_month: getSelectedMonth() }); }
        catch (e2) { console.warn(e2); }
        try { pending = await loadPendingRequests(room.id); } catch (e3) { console.warn(e3); }
      }
      try { unread = await loadUnreadCount(); } catch (e4) { console.warn(e4); }
    }

    const roomName = $("room-name");
    if (roomName) roomName.textContent = room ? room.name : "Monthly Budget";
    const monthBar = $("month-picker") || document.querySelector("main > .month-bar");
    if (monthBar && !room && !options.keepMonth) monthBar.hidden = true;
    if (room && room.currency && CURRENCIES.some((c) => c.code === room.currency)) currency = room.currency;
    setPendingBadge((pending && pending.length) || 0);
    setNotifBadge(unread || 0);
    try { startNotifWatch(); } catch (err) { console.warn(err); }
    paintHeaderAvatar(profile);
    if (mainEl) mainEl.classList.remove("is-loading");
    return {
      sb: client(),
      session,
      profile,
      rooms,
      room,
      month: getSelectedMonth(),
      uid: uid(),
      pending,
      unread,
      isAdmin: isAdmin(room),
      isOwner: isOwner(room),
      members: applied && applied.members,
      expenses: applied && applied.expenses,
      splits: applied && applied.splits,
      settlements: applied && applied.settlements,
      invites: applied && applied.invites,
      joinRequests: applied && applied.joinRequests,
      categoryBudgets: applied && applied.categoryBudgets,
      presets: applied && applied.presets,
      spendByMonth: applied && applied.spendByMonth,
    };
  }


  function colorForCategory(name) {
    const token = CAT_COLOR_TOKENS[name];
    if (token) {
      const v = cssToken(token, "");
      if (v) return v;
    }
    if (CAT_COLORS[name]) return CAT_COLORS[name];
    let hash = 0;
    String(name || "").split("").forEach((ch) => { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
    const hues = [170, 152, 199, 217, 239, 38, 350, 262, 215];
    return "hsl(" + hues[hash % hues.length] + " 58% 46%)";
  }

  function monthKeysBack(from, count) {
    const out = [];
    let key = from;
    for (let i = 0; i < count; i++) {
      out.unshift(key);
      key = shiftMonth(key, -1);
    }
    return out;
  }

  async function loadRoomExpensesRange(roomId, start, end) {
    const { data, error } = await client().from("room_expenses")
      .select("id, room_id, paid_by, created_by, amount, description, category, date, created_at, receipt_path, original_amount, original_currency, fx_rate, tax_amount, tip_amount")
      .eq("room_id", roomId).gte("date", start).lte("date", end).order("date");
    if (error) throw error;
    return data || [];
  }

  async function loadPersonalRange(start, end) {
    const { data, error } = await client().from("transactions")
      .select("id, user_id, type, amount, category, date, note, created_at")
      .eq("user_id", uid()).gte("date", start).lte("date", end).order("date", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function loadRoomCategoryBudgets(roomId) {
    const { data, error } = await client().from("room_category_budgets").select("category, limit_amount").eq("room_id", roomId);
    if (error) throw error;
    return data || [];
  }

  function maybeBrowserNotify(title, body, key) {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const stamp = sessionStorage.getItem("mb-push-" + key);
      if (stamp) return;
      sessionStorage.setItem("mb-push-" + key, "1");
      new Notification(title, { body: body || "", tag: key });
    } catch (e) { /* ignore */ }
  }

  async function requestBrowserNotify() {
    try {
      if (typeof Notification === "undefined") return "unsupported";
      if (Notification.permission === "granted") return "granted";
      if (Notification.permission === "denied") return "denied";
      return await Notification.requestPermission();
    } catch (e) { return "denied"; }
  }


  function safeNextPath(raw) {
    if (!raw) return "dashboard.html";
    try {
      const url = new URL(String(raw), location.href);
      if (url.origin !== location.origin) return "dashboard.html";
      let path = url.pathname || "";
      const base = siteBase();
      if (base && (path === base || path.startsWith(base + "/"))) path = path.slice(base.length);
      path = path.replace(/^\//, "");
      if (!path || path.startsWith(".netlify") || path.includes("..")) return "dashboard.html";
      return path + url.search + url.hash;
    } catch (e) {
      return "dashboard.html";
    }
  }
  function isIosDevice() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isStandaloneApp() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }
  function vapidPublicKey() { return window.VAPID_PUBLIC_KEY || ""; }
  function urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function maybeMarkReadFromQuery() {
    const params = new URLSearchParams(location.search);
    const nid = params.get("n");
    if (!nid) return;
    try { await client().rpc("mark_notifications_read", { p_ids: [nid] }); } catch (e) { /* ignore */ }
    try {
      const url = new URL(location.href);
      url.searchParams.delete("n");
      history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch (e) { /* ignore */ }
    try { setNotifBadge(await loadUnreadCount()); } catch (e2) { /* ignore */ }
  }
  async function getPushSubscription() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  }
  async function subscribePush() {
    if (!vapidPublicKey()) throw new Error("Push is not configured on this site yet.");
    if (!("Notification" in window) || !("PushManager" in window)) throw new Error("This browser does not support phone notifications.");
    if (isIosDevice() && !isStandaloneApp()) {
      throw new Error("On iPhone, add Monthly Budget to your Home Screen first (Share → Add to Home Screen), then open it from there. Push works on iOS 16.4 and later.");
    }
    const permission = await requestBrowserNotify();
    if (permission !== "granted") throw new Error("Notifications are blocked. Allow them in the browser or system settings, then try again.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
      });
    }
    const json = sub.toJSON();
    const { error } = await client().rpc("upsert_push_subscription", {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys && json.keys.p256dh,
      p_auth: json.keys && json.keys.auth,
      p_user_agent: navigator.userAgent,
    });
    if (error) throw error;
    try { localStorage.setItem("mb-push-enabled", "1"); localStorage.setItem("mb-push-banner-dismissed", "1"); } catch (e) { /* ignore */ }
    return sub;
  }
  async function unsubscribePush() {
    const sub = await getPushSubscription();
    if (sub) {
      try { await client().rpc("delete_push_subscription", { p_endpoint: sub.endpoint }); } catch (e) { /* ignore */ }
      try { await sub.unsubscribe(); } catch (e2) { /* ignore */ }
    } else {
      try { await client().rpc("delete_push_subscription", { p_endpoint: null }); } catch (e) { /* ignore */ }
    }
    try { localStorage.removeItem("mb-push-enabled"); } catch (e) { /* ignore */ }
  }
  async function sendTestPush() {
    const { data, error } = await client().rpc("send_test_notification");
    if (error) throw error;
    return data;
  }
  function invitePageUrl(code) {
    return originUrl("invite.html?code=" + encodeURIComponent(code || ""));
  }
  function inviteShareText(room, inviterName) {
    const name = (room && room.name) || "a room";
    const who = inviterName || "a roommate";
    const code = (room && room.code) || "";
    const url = invitePageUrl(code);
    return "Hi! 👋 You're invited to join *" + name + "* on Monthly Budget by " + who + ".\n\nTap to join: " + url + "\n\nOr open the site and enter code: *" + code + "*";
  }
  function whatsappShareHref(room, inviterName) {
    return "https://wa.me/?text=" + encodeURIComponent(inviteShareText(room, inviterName));
  }
  async function copyInviteMessage(room, inviterName) {
    const text = inviteShareText(room, inviterName);
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) { return false; }
  }
  async function shareInvite(room, inviterName) {
    const text = inviteShareText(room, inviterName);
    const url = invitePageUrl(room && room.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join " + ((room && room.name) || "Monthly Budget"), text, url });
        return "shared";
      } catch (e) {
        if (e && e.name === "AbortError") return "aborted";
      }
    }
    window.open(whatsappShareHref(room, inviterName), "_blank", "noopener");
    return "whatsapp";
  }


  const STATE_KEY = "monthly-budget-app-state";
  const EYE_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3l18 18M10.5 10.7A3 3 0 0 0 13.3 13.5M9.9 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-4.2 4.8M6.7 6.7C3.9 8.6 2 12 2 12a18 18 0 0 0 6.1 5.9C9.3 18.6 10.6 19 12 19c.6 0 1.1 0 1.7-.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function readCachedState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCachedState(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify({ state: state, cachedAt: Date.now() })); } catch (e) { /* ignore */ }
  }
  function initials(name) {
    const s = String(name || "?").trim();
    return (s.slice(0, 1) || "?").toUpperCase();
  }
  function avatarUrlOf(person) {
    return person && (person.avatar_url || person.actor_avatar) ? (person.avatar_url || person.actor_avatar) : "";
  }
  function avatarHue(id) {
    const s = String(id || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return Math.abs(h) % 360;
  }
  const AVATAR_PALETTE = [
    { bg: "#163300", fg: "#9FE870" },
    { bg: "#2F5711", fg: "#F3F7EE" },
    { bg: "#1A3A0C", fg: "#D8F5B8" },
    { bg: "#3F6212", fg: "#F3F7EE" },
    { bg: "#245018", fg: "#E8F6D8" },
    { bg: "#0F2410", fg: "#9FE870" },
    { bg: "#4D7C0F", fg: "#F7FEE7" },
    { bg: "#365314", fg: "#ECFCCB" },
  ];
  function avatarSwatch(id) {
    const hue = avatarHue(id);
    return AVATAR_PALETTE[hue % AVATAR_PALETTE.length];
  }
  function memberRecord(id, members) {
    if (id && profile && id === uid()) {
      const fromList = (members || []).find((m) => m.id === id) || {};
      return {
        id,
        display_name: (profile.display_name || fromList.display_name || "You"),
        avatar_url: profile.avatar_url || fromList.avatar_url,
      };
    }
    const m = (members || []).find((x) => x.id === id);
    if (m) return m;
    return { id: id, display_name: "Member" };
  }
  function avatarHtml(person, cls) {
    const p = person || {};
    const name = p.display_name || p.name || p.actor_name || "?";
    const url = avatarUrlOf(p);
    const klass = "avatar " + (cls || "avatar-row");
    const sw = avatarSwatch(p.id || p.user_id || p.actor_id || name);
    const style = `--avatar-bg:${sw.bg};--avatar-fg:${sw.fg};background:${sw.bg};color:${sw.fg}`;
    if (url) {
      return `<span class="${klass}" style="${style}"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    return `<span class="avatar-fallback ${klass}" style="${style}">${escapeHtml(initials(name))}</span>`;
  }
  function personChip(personOrId, members, cls) {
    const p = (personOrId && typeof personOrId === "object")
      ? personOrId
      : memberRecord(personOrId, members);
    const id = p.id || p.user_id;
    const name = (id && members) ? displayName(id, members) : (p.display_name || p.name || p.actor_name || "Member");
    // Avatar always sits to the left of the name.
    return `<span class="person">${avatarHtml(p, cls || "avatar-sm")}<span class="person-name">${escapeHtml(name)}</span></span>`;
  }
  function paintHeaderAvatar(p) {
    const el = document.getElementById("header-profile");
    if (!el) return;
    const person = p || profile;
    if (!person) return;
    el.innerHTML = avatarHtml(person, "");
  }
  function enhancePasswordFields(root) {
    (root || document).querySelectorAll("input[type='password']").forEach((input) => {
      if (input.closest(".password-field")) return;
      const wrap = document.createElement("div");
      wrap.className = "password-field";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "password-toggle";
      btn.setAttribute("aria-label", "Show password");
      btn.innerHTML = EYE_ON;
      btn.addEventListener("click", () => {
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        btn.innerHTML = show ? EYE_OFF : EYE_ON;
      });
      wrap.appendChild(btn);
    });
  }
  function bindPasswordRules(opts) {
    const min = opts.min || 8;
    const pw = $(opts.passwordId);
    if (!pw) return;
    const cf = opts.confirmId ? $(opts.confirmId) : null;
    const hint = opts.hintId ? $(opts.hintId) : null;
    const match = opts.matchId ? $(opts.matchId) : null;
    function paint() {
      const v = pw.value || "";
      if (hint) {
        if (!v) { hint.textContent = "Use at least " + min + " characters."; hint.className = "pw-hint"; }
        else if (v.length < min) { hint.textContent = "Too short — need " + (min - v.length) + " more character" + (min - v.length === 1 ? "" : "s") + "."; hint.className = "pw-hint is-bad"; }
        else { hint.textContent = "Looks good. A longer phrase is even stronger."; hint.className = "pw-hint is-good"; }
      }
      if (cf && match) {
        if (!cf.value) { match.hidden = true; match.textContent = ""; return; }
        match.hidden = false;
        const ok = cf.value === v && v.length >= min;
        match.textContent = ok ? "Passwords match." : (v.length < min ? "Passwords must be at least " + min + " characters and match." : "Passwords do not match.");
        match.className = "pw-match " + (ok ? "is-good" : "is-bad");
      }
    }
    pw.addEventListener("input", paint);
    if (cf) cf.addEventListener("input", paint);
    paint();
  }
  function itemizedSplits(items, tax, tip) {
    const person = {};
    let itemsTotal = 0;
    (items || []).forEach((it) => {
      const amt = Number(it.amount) || 0;
      const ids = it.member_ids || it.memberIds || [];
      if (!ids.length || amt <= 0) return;
      itemsTotal += amt;
      equalSplits(amt, ids).forEach((p) => {
        person[p.user_id] = (person[p.user_id] || 0) + p.share_amount;
      });
    });
    const extra = (Number(tax) || 0) + (Number(tip) || 0);
    const ids = Object.keys(person);
    if (extra && itemsTotal && ids.length) {
      let allocated = 0;
      ids.forEach((id, i) => {
        const add = i === ids.length - 1
          ? Math.round((extra - allocated) * 100) / 100
          : Math.round((extra * (person[id] / itemsTotal)) * 100) / 100;
        allocated = Math.round((allocated + add) * 100) / 100;
        person[id] = Math.round((person[id] + add) * 100) / 100;
      });
    }
    return ids.map((user_id) => ({ user_id, share_amount: Math.round((person[user_id] || 0) * 100) / 100 }));
  }
  async function fetchFxRate(from, to, date) {
    if (!from || !to || from === to) return 1;
    const day = date || "latest";
    const frank = day === "latest"
      ? `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      : `https://api.frankfurter.app/${encodeURIComponent(day)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      const res = await fetch(frank);
      const json = await res.json();
      if (json && json.rates && json.rates[to]) return Number(json.rates[to]);
    } catch (e) { /* fall through */ }
    const res = await fetch("https://open.er-api.com/v6/latest/" + encodeURIComponent(from));
    const json = await res.json();
    if (json && json.rates && json.rates[to]) return Number(json.rates[to]);
    throw new Error("Could not fetch an exchange rate right now.");
  }
  function compressImage(file, size, quality) {
    size = size || 256;
    quality = quality == null ? 0.82 : quality;
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (!blob) return reject(new Error("Could not compress the image."));
          resolve(blob);
        }, "image/jpeg", quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image.")); };
      img.src = url;
    });
  }
  function receiptPublicUrl(path) {
    if (!path) return "";
    if (/^https?:/i.test(path)) return path;
    try {
      const { data } = client().storage.from("receipts").getPublicUrl(path);
      // private bucket: signed URL is fetched separately
    } catch (e) { /* ignore */ }
    return path;
  }
  async function signedReceiptUrl(path) {
    if (!path) return "";
    if (/^https?:/i.test(path)) return path;
    const { data, error } = await client().storage.from("receipts").createSignedUrl(path, 3600);
    if (error) throw error;
    return data && data.signedUrl;
  }
  async function loadChartJs() {
    if (window.Chart) return window.Chart;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = withBase("vendor/chart.umd.min.js");
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load the chart library."));
      document.head.appendChild(s);
    });
    return window.Chart;
  }
  function whenVisible(el, fn) {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      try {
        const result = fn();
        if (result && typeof result.then === "function") result.catch((e) => console.warn(e));
      } catch (e) { console.warn(e); }
    };
    if (!el) { run(); return; }
    const hidden = !!(el.hidden || el.closest && el.closest("[hidden]"));
    let displayNone = false;
    try {
      const st = window.getComputedStyle(el);
      displayNone = st.display === "none" || st.visibility === "hidden";
    } catch (e) { /* ignore */ }
    if (hidden || displayNone || !("IntersectionObserver" in window)) { run(); return; }
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) { io.disconnect(); run(); }
    }, { rootMargin: "160px" });
    io.observe(el);
    try {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      if (rect.width > 0 && rect.height > 0 && rect.top < vh + 160 && rect.bottom > -160) {
        io.disconnect();
        run();
      }
    } catch (e) { /* observer will fire */ }
  }
  function setupPrefetch() {
    const pages = ["dashboard.html", "activity.html", "expenses.html", "add-expense.html", "personal.html", "analytics.html", "settle.html", "notifications.html"];
    const go = (href) => {
      if (!href || document.querySelector(`link[rel="prefetch"][href="${href}"]`)) return;
      const l = document.createElement("link");
      l.rel = "prefetch";
      l.href = href;
      document.head.appendChild(l);
    };
    document.addEventListener("pointerenter", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (a && /\.html/.test(a.getAttribute("href") || "")) go(a.getAttribute("href"));
    }, true);
    document.addEventListener("touchstart", (e) => {
      const a = e.target && e.target.closest && e.target.closest("a[href]");
      if (a && /\.html/.test(a.getAttribute("href") || "")) go(a.getAttribute("href"));
    }, { capture: true, passive: true });
    if ("requestIdleCallback" in window) requestIdleCallback(() => pages.forEach(go));
    else setTimeout(() => pages.forEach(go), 1200);
  }
  function injectFab() {
    const page = currentPage();
    if (!["dashboard.html", "expenses.html", "activity.html"].includes(page)) return;
    if (document.getElementById("fab-root")) return;
    const scan = page === "personal.html" ? "add-expense.html?kind=personal&scan=1" : "add-expense.html?scan=1";
    const room = "add-expense.html?kind=room";
    const personal = "add-expense.html?kind=personal";
    const action = (href, icon, label) =>
      `<a class="fab-action" role="menuitem" href="${href}"><span class="fab-action-icon" aria-hidden="true">${icon}</span><span class="fab-action-label">${label}</span></a>`;
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "fab-scrim";
    scrim.id = "fab-scrim";
    scrim.hidden = true;
    scrim.setAttribute("aria-label", "Close add menu");
    scrim.tabIndex = -1;
    const root = document.createElement("div");
    root.className = "fab-root";
    root.id = "fab-root";
    root.innerHTML = `
      <div class="fab-dial" id="fab-dial" hidden role="menu" aria-label="Add an expense">
        ${action(room, ICONS.home, "Room expense")}
        ${action(personal, ICONS.wallet, "Personal expense")}
        ${action(scan, ICONS.camera, "Scan receipt")}
      </div>
      <button type="button" class="fab" id="fab-btn" aria-label="Add expense" aria-haspopup="menu" aria-expanded="false" aria-controls="fab-dial" title="Add expense">${ICONS.plus}</button>`;
    document.body.appendChild(scrim);
    document.body.appendChild(root);
    const btn = $("fab-btn");
    const dial = $("fab-dial");
    const toggle = (open) => {
      const next = open == null ? !root.classList.contains("is-open") : open;
      root.classList.toggle("is-open", next);
      dial.hidden = !next;
      scrim.hidden = !next;
      btn.setAttribute("aria-expanded", next ? "true" : "false");
      document.body.classList.toggle("fab-menu-open", next);
    };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    });
    scrim.addEventListener("click", () => toggle(false));
    let press;
    btn.addEventListener("pointerdown", () => {
      press = setTimeout(() => toggle(true), 450);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => {
      btn.addEventListener(ev, () => clearTimeout(press));
    });
    document.addEventListener("click", (e) => {
      if (!root.classList.contains("is-open")) return;
      if (root.contains(e.target) || e.target === scrim) return;
      toggle(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("is-open")) {
        toggle(false);
        btn.focus();
      }
    });
  }
  function applyAppState(data, roomsPreferred) {
    if (!data) return null;
    if (data.profile) {
      profile = data.profile;
      if (profile.currency && CURRENCIES.some((c) => c.code === profile.currency)) currency = profile.currency;
      paintHeaderAvatar(profile);
    }
    const rooms = data.rooms || roomsPreferred || [];
    let room = null;
    if (data.room_id) room = rooms.find((r) => r.id === data.room_id) || null;
    if (!room) room = rooms.find((r) => !r.archived_at) || rooms[0] || null;
    if (room) setActiveRoomId(room.id);
    return {
      rooms, room, members: data.members || [],
      expenses: data.expenses || [], splits: data.splits || [],
      settlements: data.settlements || [],
      pending: data.pending || [], unread: data.unread || 0,
      invites: data.invites || [], joinRequests: data.join_requests || [],
      categoryBudgets: data.category_budgets || [],
      presets: data.presets || [],
      spendByMonth: data.spend_by_month || {},
    };
  }

  window.MB = {
    CATEGORIES, CAT_COLORS, CAT_COLOR_TOKENS, CAT_ICONS, CURRENCIES, MONTHS, ICONS,
    $, escapeHtml, errorMessage, formatMoney, equalSplits,
    getSelectedMonth, setSelectedMonth, monthLabel, monthBounds, todayISO,
    client, uid, currentPage, configured,
    getActiveRoomId, setActiveRoomId,
    loadRooms, loadMembers, loadMonthData, loadProfile, resolveActiveRoom,
    memberBalances, settleSuggestions, displayName, netLabel,
    acceptedSplits, splitStatusLabel, splitStatusKey, splitStatusSummary, statusChip,
    friendlyDate, daysLeftInMonth, categoryIcon, categoryChip, infoTip, emptyState,
    memberNetChip, balanceHeadline, remindWhatsAppHref, monthSpendSentence, expenseRowHtml, balanceFootnote, paintBalanceNote, personChip, memberRecord, avatarHue, avatarSwatch,
    renderOnboardingTip,
    loadPendingRequests, respondToShare, renderPendingItems, setPendingBadge,
    isAdmin, isOwner, roleLabel, roomCategories, loadUnreadCount, setNotifBadge,
    colorForCategory, monthKeysBack, shiftMonth, loadRoomExpensesRange, loadPersonalRange,
    loadRoomCategoryBudgets, maybeBrowserNotify, requestBrowserNotify,
    isIosDevice, isStandaloneApp, subscribePush, unsubscribePush, sendTestPush, getPushSubscription,
    invitePageUrl, inviteShareText, whatsappShareHref, copyInviteMessage, shareInvite, safeNextPath,
    avatarHtml, paintHeaderAvatar, enhancePasswordFields, bindPasswordRules, itemizedSplits, fetchFxRate,
    compressImage, signedReceiptUrl, loadChartJs, whenVisible, cssToken, initials,
    bootAuthPage, bootApp, showError, hideError, showPageError, setTheme, currentTheme, siteBase, withBase, originUrl,
    get profile() { return profile; },
    setCurrency(code) { currency = code; },
    get currency() { return currency; },
  };

  document.addEventListener("DOMContentLoaded", () => { enhancePasswordFields(); });
  if (document.readyState !== "loading") enhancePasswordFields();
})();
