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

  const MANIFEST_HREF = "manifest.json?v=38";
  function registerPwa() {
    try {
      const manifestHref = withBase(MANIFEST_HREF);
      const existingManifest = document.querySelector('link[rel="manifest"]');
      if (existingManifest) existingManifest.href = manifestHref;
      else {
        const link = document.createElement("link");
        link.rel = "manifest";
        link.href = manifestHref;
        document.head.appendChild(link);
      }
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const link = document.createElement("link");
        link.rel = "apple-touch-icon";
        link.href = withBase("icons/apple-touch-icon.png?v=22");
        document.head.appendChild(link);
      }
      if ("serviceWorker" in navigator) {
        const promptSkip = (worker) => {
          try { if (worker) worker.postMessage({ type: "SKIP_WAITING" }); } catch (e) { /* ignore */ }
        };
        const checkUpdate = (reg) => {
          if (!reg) return;
          try { reg.update(); } catch (e) { /* ignore */ }
          if (reg.waiting) promptSkip(reg.waiting);
        };
        // If a controller is already in place, a later controllerchange means a new SW just took over — reload so the user gets the new HTML/JS, not the in-memory stale page.
        const reloadOnce = () => {
          try {
            if (sessionStorage.getItem("mb-sw-reloading")) return;
            sessionStorage.setItem("mb-sw-reloading", "1");
          } catch (e) { /* ignore */ }
          location.reload();
        };
        try {
          if (sessionStorage.getItem("mb-sw-reloading")) {
            setTimeout(() => { try { sessionStorage.removeItem("mb-sw-reloading"); } catch (e) { /* ignore */ } }, 2500);
          }
        } catch (e) { /* ignore */ }
        // Reload on a *new* worker taking over, not on the first SW claim (that would
        // interrupt sign-in). Clear the session flag after a successful reload so a
        // later update in the same tab can apply without a full app reopen.
        let hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!hadController) { hadController = true; return; }
          reloadOnce();
        });
        navigator.serviceWorker.register(withBase("sw.js"), {
          scope: (siteBase() || "") + "/",
          updateViaCache: "none",
        }).then((reg) => {
          checkUpdate(reg);
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener("statechange", () => {
              if (next.state === "installed") promptSkip(next);
            });
          });
          let ticks = 0;
          const poke = setInterval(() => {
            ticks += 1;
            checkUpdate(reg);
            if (ticks >= 6) clearInterval(poke);
          }, 8000);
        }).catch(() => {});
        const onVisible = () => {
          if (document.visibilityState && document.visibilityState !== "visible") return;
          navigator.serviceWorker.getRegistration().then(checkUpdate).catch(() => {});
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("pageshow", (ev) => { if (ev.persisted) onVisible(); });
        navigator.serviceWorker.addEventListener("message", (ev) => {
          const data = ev.data || {};
          if (data.type === "MB_RELOAD") { reloadOnce(); return; }
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
  const ROOM_META_KEY = "monthly-budget-active-room-meta";
  const MONTH_KEY = "monthly-budget-month";
  const GROUP_TYPES = [
    { id: "home", emoji: "🏠", label: "Home" },
    { id: "friends", emoji: "👥", label: "Friends" },
    { id: "trip", emoji: "✈️", label: "Trip" },
    { id: "other", emoji: "✨", label: "Other" },
  ];
  const PENDING_CODE_KEY = "monthly-budget-pending-code";

  function uniqueCats(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((c) => {
      const name = String(c || "").trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      out.push(name);
    });
    return out;
  }
  const CATEGORIES = [
    "Rent", "Groceries", "Electricity", "Water", "WiFi / Internet", "Gas", "Gas cylinder",
    "Food/Outing", "Eating out", "Food delivery (Swiggy/Zomato)", "Snacks & tea",
    "Movies & outings", "Alcohol & drinks", "Cigarettes/Smoke",
    "Travel/Fuel", "Mobile & internet recharge", "Gym & fitness",
    "Laundry", "Maid", "Maid/Cook", "Gifts & parties", "Medical",
    "Shopping/Clothes", "Subscriptions (OTT)", "Other"
  ];
  const PERSONAL_EXPENSE_CATS = uniqueCats([
    "Groceries", "Food/Outing", "Eating out", "Food delivery (Swiggy/Zomato)", "Snacks & tea",
    "Transport", "Travel/Fuel", "Shopping", "Shopping/Clothes", "Health", "Medical",
    "Entertainment", "Movies & outings", "Subscriptions", "Subscriptions (OTT)",
    "Rent", "Electricity", "Water", "Internet", "WiFi / Internet",
    "Mobile & internet recharge", "Gas", "Gas cylinder",
    "Gym & fitness", "Alcohol & drinks", "Cigarettes/Smoke",
    "Laundry", "Maid", "Maid/Cook", "Gifts & parties", "Other"
  ]);
  const INCOME_CATS = ["Salary", "Freelance", "Refund", "Gift", "Interest", "Other"];
  const CAT_COLOR_TOKENS = {
    Rent: "--cat-indigo",
    Groceries: "--cat-green",
    Electricity: "--cat-amber",
    Water: "--cat-sky",
    Internet: "--cat-teal",
    "WiFi / Internet": "--cat-teal",
    Gas: "--cat-violet",
    "Gas cylinder": "--cat-violet",
    "Food/Outing": "--cat-rose",
    "Eating out": "--cat-coral",
    "Food delivery (Swiggy/Zomato)": "--cat-orange",
    "Snacks & tea": "--cat-amber",
    "Movies & outings": "--cat-pink",
    "Alcohol & drinks": "--cat-wine",
    "Cigarettes/Smoke": "--cat-slate",
    "Travel/Fuel": "--cat-indigo",
    Transport: "--cat-indigo",
    "Mobile & internet recharge": "--cat-cyan",
    "Gym & fitness": "--cat-orange",
    Laundry: "--cat-sky",
    Maid: "--cat-mint",
    "Maid/Cook": "--cat-mint",
    "Gifts & parties": "--cat-pink",
    Medical: "--cat-rose",
    Health: "--cat-rose",
    "Shopping/Clothes": "--cat-violet",
    Shopping: "--cat-violet",
    "Subscriptions (OTT)": "--cat-indigo",
    Subscriptions: "--cat-indigo",
    Entertainment: "--cat-pink",
    Other: "--cat-slate",
  };
  const CAT_COLORS = {
    Rent: "#818CF8",
    Groceries: "#7BD44F",
    Electricity: "#FBBF24",
    Water: "#38BDF8",
    Internet: "#2EC4A3",
    "WiFi / Internet": "#2EC4A3",
    Gas: "#C084FC",
    "Gas cylinder": "#A78BFA",
    "Food/Outing": "#FB7185",
    "Eating out": "#FB7185",
    "Food delivery (Swiggy/Zomato)": "#FB923C",
    "Snacks & tea": "#FBBF24",
    "Movies & outings": "#F472B6",
    "Alcohol & drinks": "#E11D48",
    "Cigarettes/Smoke": "#94A3B8",
    "Travel/Fuel": "#818CF8",
    Transport: "#818CF8",
    "Mobile & internet recharge": "#22D3EE",
    "Gym & fitness": "#FB923C",
    Laundry: "#38BDF8",
    Maid: "#6EE7B7",
    "Maid/Cook": "#34D399",
    "Gifts & parties": "#F472B6",
    Medical: "#FB7185",
    Health: "#FB7185",
    "Shopping/Clothes": "#C084FC",
    Shopping: "#C084FC",
    "Subscriptions (OTT)": "#818CF8",
    Subscriptions: "#818CF8",
    Entertainment: "#F472B6",
    Other: "#94A3B8",
    Salary: "#34D399",
    Freelance: "#38BDF8",
    Refund: "#FBBF24",
    Gift: "#F472B6",
    Interest: "#818CF8",
  };
  const CAT_ICONS = {
    Rent: "🏠",
    Groceries: "🛒",
    Electricity: "💡",
    Water: "🚿",
    Internet: "🛜",
    "WiFi / Internet": "🛜",
    Gas: "🔥",
    "Gas cylinder": "🛢️",
    "Food/Outing": "🍽️",
    "Eating out": "🍴",
    "Food delivery (Swiggy/Zomato)": "🛵",
    "Snacks & tea": "☕",
    "Movies & outings": "🎬",
    "Alcohol & drinks": "🍺",
    "Cigarettes/Smoke": "🚬",
    "Travel/Fuel": "⛽",
    Transport: "🚌",
    "Mobile & internet recharge": "📱",
    "Gym & fitness": "🏋️",
    Laundry: "👕",
    Maid: "🧹",
    "Maid/Cook": "🍳",
    "Gifts & parties": "🎁",
    Medical: "🩺",
    Health: "🩺",
    "Shopping/Clothes": "👗",
    Shopping: "🛍️",
    "Subscriptions (OTT)": "📺",
    Subscriptions: "📺",
    Entertainment: "🎭",
    Other: "📦",
    Salary: "💼",
    Freelance: "💻",
    Refund: "🧾",
    Gift: "🎁",
    Interest: "📈",
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
    swap: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 7h11M16 4l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 17H5M8 14l-3 3 3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
    kebab: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="6" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="18" r="1.7" fill="currentColor"/></svg>',
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

  const THEME_CHROME = { light: "#F4F4F2", dark: "#0E1410" };
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
    const color = themeChromeColor(theme);
    try {
      document.documentElement.style.backgroundColor = color;
      if (document.body) document.body.style.backgroundColor = color;
      document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
    } catch (e) { /* ignore */ }
    let meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.insertBefore(meta, document.head.firstChild);
    }
    meta.setAttribute("content", color);
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
      try { document.documentElement.style.backgroundColor = THEME_CHROME.dark; } catch (e2) { /* ignore */ }
    }
  }
  applyThemeEarly();

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function withoutAdminLabel(text) {
    if (text == null || text === "") return text;
    let s = String(text);
    s = s.replace(/\bAn admin accepted a share on your behalf\b/gi, "A roommate accepted a share on your behalf");
    s = s.replace(/\bAdmin marked\b/g, "A roommate marked");
    s = s.replace(/\bOnly owners and admins\b/gi, "Only people who can manage the room");
    s = s.replace(/\bOnly admins\b/gi, "Only people who can manage the room");
    s = s.replace(/\ban admin\b/gi, "a roommate");
    s = s.replace(/\bAn admin\b/g, "A roommate");
    s = s.replace(/\badmins\b/gi, "people who can manage the room");
    s = s.replace(/\badmin approval\b/gi, "approval");
    s = s.replace(/\band admin actions\b/gi, "and room changes");
    s = s.replace(/\badmin actions\b/gi, "room changes");
    s = s.replace(/\bforce-accepted\b/gi, "accepted");
    s = s.replace(/\bAdmin\b/g, "Roommate");
    s = s.replace(/[ \t]{2,}/g, " ");
    return s;
  }
  function errorMessage(err) {
    if (!err) return "Something went wrong.";
    let text = (err.message || err.error_description || String(err));
    text = text
      .replace(/^.*?(Not authenticated|You are not a member of this room|Payer must be a room member|All participants must be room members|Splits must add up to the expense amount|At least one split is required|Only the person who added this expense can edit it|Expense not found|Enter a valid 6-character join code|No room found for that code|Room name is required)/i, "$1");
    return withoutAdminLabel(text);
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
    return localDayKey(new Date());
  }
  function roomTypeMeta(type) {
    const id = String(type || "home").toLowerCase();
    return GROUP_TYPES.find((t) => t.id === id) || GROUP_TYPES[0];
  }
  function isTripRoom(room) {
    return !!(room && String(room.type || "").toLowerCase() === "trip");
  }
  function periodBounds(room, month) {
    const r = room || periodRoom;
    if (isTripRoom(r)) {
      const created = r.created_at ? localDayKey(r.created_at) : "";
      const start = r.start_date || created || todayISO();
      const end = r.end_date || todayISO();
      return { start, end, kind: "trip" };
    }
    const key = month || getSelectedMonth();
    const b = monthBounds(key);
    return { start: b.start, end: b.end, kind: "month", month: key };
  }
  function periodCacheKey(room, month) {
    const p = periodBounds(room, month);
    return p.kind === "trip" ? ("trip:" + p.start + ":" + p.end) : (p.month || month || getSelectedMonth());
  }
  function formatDateRange(start, end) {
    if (!start && !end) return "";
    const a = start ? (friendlyDate(start) || start) : "";
    const b = end ? (friendlyDate(end) || end) : "";
    if (a && b && a === b) return a;
    if (a && b) return a + " – " + b;
    return a || b;
  }
  function rememberRoomMeta(room) {
    try {
      if (!room || !room.id) {
        localStorage.removeItem(ROOM_META_KEY);
        return;
      }
      localStorage.setItem(ROOM_META_KEY, JSON.stringify({
        id: room.id,
        type: room.type || "home",
        name: room.name || "",
        start_date: room.start_date || null,
        end_date: room.end_date || null,
        created_at: room.created_at || null,
      }));
    } catch (e) { /* ignore */ }
  }
  function peekRoomMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(ROOM_META_KEY) || "null");
      if (!raw || !raw.id) return null;
      const active = getActiveRoomId();
      if (active && raw.id !== active) return null;
      return raw;
    } catch (e) { return null; }
  }
  function groupNetLabel(net) {
    return netLabel(Number(net) || 0);
  }
  let periodRoom = null;
  function localDayKey(iso) {
    if (iso == null || iso === "") return "";
    if (iso instanceof Date) {
      if (!Number.isFinite(iso.getTime())) return "";
      return iso.getFullYear() + "-" + String(iso.getMonth() + 1).padStart(2, "0") + "-" + String(iso.getDate()).padStart(2, "0");
    }
    const raw = String(iso).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    // Accept PostgREST/ISO oddities: space instead of T, +00 instead of +00:00.
    const normalized = raw
      .replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2")
      .replace(/([+-]\d{2})$/, "$1:00")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const d = new Date(normalized);
    if (!Number.isFinite(d.getTime())) return raw.slice(0, 10);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function formatDateIN(iso) {
    if (!iso) return "";
    const day = String(iso).slice(0, 10);
    const d = new Date(day + "T00:00:00");
    if (Number.isNaN(d.getTime())) return day;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }
  function syncDateDisplay(input) {
    const vis = input && input.parentElement && input.parentElement.querySelector(".date-display");
    if (!vis) return;
    vis.textContent = input.value ? formatDateIN(input.value) : "Choose a date";
  }
  function enhanceDateFields(root) {
    (root || document).querySelectorAll("input[type='date']").forEach((input) => {
      const refresh = () => syncDateDisplay(input);
      if (input.closest(".date-field")) {
        refresh();
        return;
      }
      const wrap = document.createElement("div");
      wrap.className = "date-field";
      input.parentNode.insertBefore(wrap, input);
      const vis = document.createElement("span");
      vis.className = "date-display";
      vis.setAttribute("aria-hidden", "true");
      wrap.appendChild(vis);
      wrap.appendChild(input);
      input.addEventListener("input", refresh);
      input.addEventListener("change", refresh);
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (desc && desc.set && desc.get) {
        Object.defineProperty(input, "value", {
          configurable: true,
          enumerable: desc.enumerable,
          get() { return desc.get.call(this); },
          set(v) { desc.set.call(this, v); refresh(); },
        });
      }
      refresh();
    });
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
    const prev = getActiveRoomId();
    const next = id || "";
    try {
      if (next) localStorage.setItem(ROOM_KEY, next);
      else {
        localStorage.removeItem(ROOM_KEY);
        localStorage.removeItem(ROOM_META_KEY);
      }
    } catch (e) { /* ignore */ }
    if (prev !== next) clearMemoryAppState();
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
      map.set(m.id, { id: m.id, name: m.display_name || "Member", paid: 0, share: 0, collected: 0, pendingIn: 0, pendingOut: 0, sent: 0, received: 0, net: 0, avatar_url: m.avatar_url, pendingFrom: [], pendingTo: [], receivedFrom: [], sentTo: [] });
    });
    const ensure = (id) => {
      if (!map.has(id)) map.set(id, { id, name: "Member", paid: 0, share: 0, collected: 0, pendingIn: 0, pendingOut: 0, sent: 0, received: 0, net: 0, pendingFrom: [], pendingTo: [], receivedFrom: [], sentTo: [] });
      return map.get(id);
    };
    const addPending = (list, id, name, cents) => {
      const row = list.find((x) => x.id === id);
      if (row) row.amount += cents;
      else list.push({ id, name, amount: cents });
    };
    const settlementConfirmed = (s) => {
      const st = String(s && s.status || "").toLowerCase();
      if (st === "voided" || st === "void" || (s && s.voided_at)) return false;
      if (st === "pending" || st === "cancelled" || st === "canceled" || st === "declined" || st === "rejected") return false;
      if (st === "confirmed" || st === "received" || st === "completed") return true;
      if (s && s.confirmed_at) return true;
      // Legacy rows with no status were treated as confirmed payments.
      return !st;
    };
    const expenseById = new Map((expenses || []).filter((e) => e && e.id).map((e) => [e.id, e]));
    (expenses || []).forEach((e) => {
      if (!e || !e.paid_by) return;
      ensure(e.paid_by).paid += toCents(e.amount);
    });
    (splits || []).forEach((s) => {
      if (!s) return;
      const cents = toCents(s.share_amount);
      const exp = expenseById.get(s.expense_id);
      if (s.status === "accepted") {
        if (s.user_id) ensure(s.user_id).share += cents;
        if (exp && exp.paid_by) ensure(exp.paid_by).collected += cents;
      } else if (s.status === "pending") {
        if (exp && exp.paid_by && exp.paid_by !== s.user_id) {
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
      const cents = toCents(s.amount);
      const from = ensure(s.from_user);
      const to = ensure(s.to_user);
      from.sent += cents;
      to.received += cents;
      addPending(from.sentTo, to.id, to.name, cents);
      addPending(to.receivedFrom, from.id, from.name, cents);
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
    // Only confirmed settlements. Name who paid so this is not mistaken for a pending share.
    const receivedFrom = row.receivedFrom || [];
    const sentTo = row.sentTo || [];
    if ((row.receivedAmt || 0) > 0.004) {
      if (receivedFrom.length === 1) {
        parts.push("These balances already include the " + formatMoney(fromCents(receivedFrom[0].amount)) + " " + receivedFrom[0].name + " paid you");
      } else if (receivedFrom.length) {
        parts.push("These balances already include the " + formatMoney(row.receivedAmt) + " you've received from " + andNames(receivedFrom.map((p) => p.name)));
      } else {
        parts.push("These balances already include the " + formatMoney(row.receivedAmt) + " you've received");
      }
    }
    if ((row.sentAmt || 0) > 0.004) {
      if (sentTo.length === 1) {
        parts.push("These balances already include the " + formatMoney(fromCents(sentTo[0].amount)) + " you paid " + sentTo[0].name);
      } else if (sentTo.length) {
        parts.push("These balances already include the " + formatMoney(row.sentAmt) + " you paid " + andNames(sentTo.map((p) => p.name)));
      } else {
        parts.push("These balances already include the " + formatMoney(row.sentAmt) + " you paid roommates");
      }
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
  function shareStatCaption(netAmt) {
    const n = Number(netAmt) || 0;
    if (Math.abs(n) < 0.005) return { label: "Balance", value: "Settled up", cls: "is-settled" };
    if (n > 0) return { label: "To get", value: formatMoney(n), cls: "is-good" };
    return { label: "You owe", value: formatMoney(Math.abs(n)), cls: "is-bad" };
  }

  function settlementConfirmed(s) {
    const st = String(s && s.status || "").toLowerCase();
    if (st === "voided" || st === "void" || (s && s.voided_at)) return false;
    if (st === "pending" || st === "cancelled" || st === "canceled" || st === "declined" || st === "rejected") return false;
    if (st === "confirmed" || st === "received" || st === "completed") return true;
    if (s && s.confirmed_at) return true;
    return !st;
  }

  // Pairwise debts: for each pair, accepted shares on each other's bills,
  // adjusted only by confirmed settlements between those two people.
  // An overpayment shows as the receiver owing the extra back. No min-cash-flow.
  function settleSuggestions(balances, expenses, splits, settlements) {
    const people = balances || [];
    const byId = new Map(people.map((b) => [b.id, b]));
    const ids = people.map((b) => b && b.id).filter(Boolean);
    const expenseById = new Map((expenses || []).filter((e) => e && e.id).map((e) => [e.id, e]));
    const transfers = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        let bOwesA = 0;
        (splits || []).forEach((s) => {
          if (!s || s.status !== "accepted") return;
          const exp = expenseById.get(s.expense_id);
          if (!exp || !exp.paid_by) return;
          const cents = toCents(s.share_amount);
          if (exp.paid_by === a && s.user_id === b) bOwesA += cents;
          else if (exp.paid_by === b && s.user_id === a) bOwesA -= cents;
        });
        (settlements || []).forEach((s) => {
          if (!settlementConfirmed(s)) return;
          const cents = toCents(s.amount);
          if (s.from_user === b && s.to_user === a) bOwesA -= cents;
          else if (s.from_user === a && s.to_user === b) bOwesA += cents;
        });
        if (Math.abs(bOwesA) < 1) continue;
        const personA = byId.get(a) || { id: a, name: "Member" };
        const personB = byId.get(b) || { id: b, name: "Member" };
        if (bOwesA > 0) transfers.push({ from: personB, to: personA, amount: fromCents(bOwesA) });
        else transfers.push({ from: personA, to: personB, amount: fromCents(-bOwesA) });
      }
    }
    return cancelDebtCycles(transfers);
  }

  /* Start from pairwise debts, then repeatedly subtract the smallest edge
     from every edge in a directed cycle. Never invent a new pair. */
  function cancelDebtCycles(transfers) {
    const edges = [];
    const byKey = new Map();
    (transfers || []).forEach((t) => {
      if (!t || !t.from || !t.to) return;
      const cents = toCents(t.amount);
      if (cents < 1) return;
      const key = String(t.from.id) + ">" + String(t.to.id);
      const prev = byKey.get(key);
      if (prev) prev.cents += cents;
      else {
        const rec = { from: t.from, to: t.to, cents: cents };
        byKey.set(key, rec);
        edges.push(rec);
      }
    });

    function findCycle() {
      const adj = new Map();
      edges.forEach((e) => {
        if (e.cents < 1) return;
        if (!adj.has(e.from.id)) adj.set(e.from.id, []);
        adj.get(e.from.id).push(e);
      });
      const visiting = new Set();
      const visited = new Set();
      let found = null;
      function dfs(id, path) {
        if (found) return;
        visiting.add(id);
        path.push(id);
        (adj.get(id) || []).forEach((e) => {
          if (found || e.cents < 1) return;
          const nid = e.to.id;
          if (visiting.has(nid)) {
            const start = path.indexOf(nid);
            if (start >= 0) found = path.slice(start).concat([nid]);
            return;
          }
          if (!visited.has(nid)) dfs(nid, path);
        });
        if (found) return;
        path.pop();
        visiting.delete(id);
        visited.add(id);
      }
      Array.from(adj.keys()).forEach((id) => {
        if (!found && !visited.has(id)) dfs(id, []);
      });
      return found;
    }

    let guard = 0;
    while (guard < 1000) {
      guard += 1;
      const cycle = findCycle();
      if (!cycle || cycle.length < 3) break;
      const cycEdges = [];
      let ok = true;
      for (let i = 0; i < cycle.length - 1; i += 1) {
        const e = byKey.get(cycle[i] + ">" + cycle[i + 1]);
        if (!e || e.cents < 1) { ok = false; break; }
        cycEdges.push(e);
      }
      if (!ok || !cycEdges.length) break;
      const min = Math.min.apply(null, cycEdges.map((e) => e.cents));
      if (min < 1) break;
      cycEdges.forEach((e) => { e.cents -= min; });
    }

    return edges
      .filter((e) => e.cents >= 1)
      .map((e) => ({ from: e.from, to: e.to, amount: fromCents(e.cents) }))
      .sort((a, b) => (b.amount - a.amount) || String(a.from && a.from.name).localeCompare(String(b.from && b.from.name)));
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

  async function loadMonthData(roomId, month, room) {
    const boundRoom = (room && room.id) ? room : (periodRoom && periodRoom.id === roomId ? periodRoom : { id: roomId });
    const { start, end } = periodBounds(boundRoom, month);
    const [exRes, setRes] = await Promise.all([
      client().from("room_expenses").select("id, room_id, paid_by, created_by, amount, description, category, date, created_at, receipt_path, original_amount, original_currency, fx_rate, tax_amount, tip_amount").eq("room_id", roomId).gte("date", start).lte("date", end).order("date", { ascending: false }),
      client().from("settlements").select("id, room_id, from_user, to_user, amount, date, note, created_by, created_at, status, confirmed_at, confirmed_by, rejected_at, rejected_by, voided_at, voided_by, proof_path").eq("room_id", roomId).gte("date", start).lte("date", end).order("date", { ascending: false }),
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

  function myTransfers(balances, userId, expenses, splits, settlements) {
    return settleSuggestions(balances || [], expenses, splits, settlements).filter((t) => t && t.from && t.to && (t.from.id === userId || t.to.id === userId));
  }
  function pendingSettlementFor(settlements, fromId, toId, amount) {
    const list = (settlements || []).filter((s) => s && s.status === "pending" && s.from_user === fromId && s.to_user === toId);
    if (!list.length) return null;
    if (amount != null && amount !== "") {
      const exact = list.find((s) => Math.abs(Number(s.amount) - Number(amount)) < 0.02);
      if (exact) return exact;
    }
    return list[0];
  }
  function oweRowHtml(t, userId, members) {
    if (!t || !t.from || !t.to) return "";
    const mine = t.from.id === userId;
    const other = mine ? t.to : t.from;
    const rec = memberRecord(other.id || other, members);
    const name = displayName(rec.id || other.id, members) || other.name || other.display_name || "Member";
    const role = mine ? "you owe" : "owes you";
    const cls = mine ? "neg" : "pos";
    return `<div class="suggest">
      <div class="suggest-who">
        ${avatarHtml(rec, "sm")}
        <div class="suggest-copy">
          <div class="suggest-name">${escapeHtml(name)}</div>
          <div class="suggest-role">${escapeHtml(role)}</div>
        </div>
      </div>
      <strong class="suggest-amt ${cls}">${escapeHtml(formatMoney(t.amount))}</strong>
    </div>`;
  }

  function isAdmin(room) {
    const role = room && room.role;
    return role === "owner" || role === "admin";
  }
  function isOwner(room) { return !!(room && room.role === "owner"); }
  function roleLabel(role) {
    if (role === "owner") return "Owner";
    if (role === "admin") return "";
    return "Member";
  }
  function roomCategories(room) {
    if (room && Array.isArray(room.categories) && room.categories.length) {
      return uniqueCats(room.categories);
    }
    return CATEGORIES.slice();
  }
  function pickerCategories(room) {
    return uniqueCats(roomCategories(room).concat(CATEGORIES));
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
    if (key === "forced") return "Accepted";
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
  function firstName(name) {
    const s = String(name == null ? "" : name).trim();
    if (!s) return "Someone";
    const token = s.split(/\s+/)[0];
    return token || "Someone";
  }
  function relativeTime(iso) {
    if (!iso) return "";
    const thenDate = new Date(iso);
    const then = thenDate.getTime();
    if (!Number.isFinite(then)) return "";
    const sec = Math.round((Date.now() - then) / 1000);
    if (sec < 45) return "Just now";
    if (sec < 90) return "1 min ago";
    if (sec < 3600) return Math.floor(sec / 60) + " min ago";
    if (sec < 5400) return "1 hour ago";
    if (sec < 86400) return Math.floor(sec / 3600) + " hours ago";
    const time = thenDate.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    const day = localDayKey(thenDate);
    const today = todayISO();
    if (day === today) return time;
    const y = new Date(today + "T00:00:00");
    y.setDate(y.getDate() - 1);
    const yest = localDayKey(y);
    if (day === yest) return "Yesterday " + time;
    return friendlyDate(day) + " " + time;
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
  function categoryAvatarHtml(name, size) {
    const color = colorForCategory(name);
    const klass = size ? "cat-avatar cat-avatar-" + size : "cat-avatar";
    return `<span class="${klass}" style="--cat:${escapeHtml(color)}" aria-hidden="true">${categoryIcon(name)}</span>`;
  }
  function categoryChip(name, opts) {
    const color = colorForCategory(name);
    const label = escapeHtml(name || "Other");
    if (opts && (opts.plain || opts.noIcon)) {
      return `<span class="cat-chip is-plain" style="--cat:${escapeHtml(color)}">${label}</span>`;
    }
    return `<span class="cat-chip" style="--cat:${escapeHtml(color)}"><span class="cat-ico" aria-hidden="true">${categoryIcon(name)}</span>${label}</span>`;
  }
  function infoTip(text) {
    return `<span class="info-tip"><button type="button" class="info-tip-btn" aria-label="What this means" aria-expanded="false"><span aria-hidden="true">i</span></button><span class="info-tip-pop" hidden role="tooltip">${escapeHtml(text)}</span></span>`;
  }
  function closeInfoTip(tip) {
    if (!tip) return;
    tip.classList.remove("is-open");
    const btn = tip.querySelector(".info-tip-btn");
    const pop = tip.querySelector(".info-tip-pop");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (pop) pop.hidden = true;
  }
  function bindInfoTips() {
    if (bindInfoTips._bound) return;
    bindInfoTips._bound = true;
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest && ev.target.closest(".info-tip-btn");
      const tip = btn && btn.closest(".info-tip");
      document.querySelectorAll(".info-tip.is-open").forEach((el) => {
        if (el !== tip) closeInfoTip(el);
      });
      if (tip) {
        ev.preventDefault();
        ev.stopPropagation();
        const open = !tip.classList.contains("is-open");
        if (open) {
          tip.classList.add("is-open");
          const b = tip.querySelector(".info-tip-btn");
          const pop = tip.querySelector(".info-tip-pop");
          if (b) b.setAttribute("aria-expanded", "true");
          if (pop) pop.hidden = false;
        } else closeInfoTip(tip);
        return;
      }
      if (!(ev.target.closest && ev.target.closest(".info-tip-pop"))) {
        document.querySelectorAll(".info-tip.is-open").forEach(closeInfoTip);
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") document.querySelectorAll(".info-tip.is-open").forEach(closeInfoTip);
    });
  }
  function emptyState(opts) {
    const o = opts || {};
    const art = o.art ? `<img class="empty-art" src="${escapeHtml(withBase(o.art))}" width="200" height="200" alt="" />` : "";
    const cta = o.href && o.cta ? `<a class="primary-btn" href="${escapeHtml(o.href)}">${escapeHtml(o.cta)}</a>` : "";
    const secondary = o.secondaryHref && o.secondaryCta ? `<a class="secondary-btn" href="${escapeHtml(o.secondaryHref)}">${escapeHtml(o.secondaryCta)}</a>` : "";
    const actions = (cta || secondary) ? `<div class="btn-row">${cta}${secondary}</div>` : "";
    return `<div class="empty-state card is-outline">
      ${art}
      <h2 class="display-title">${escapeHtml(o.title || "Nothing here yet")}</h2>
      <p>${escapeHtml(o.text || "")}</p>
      ${actions}
    </div>`;
  }
  function memberNetChip(netAmt, compact) {
    if (Math.abs(netAmt) < 0.005) return `<span class="net-chip is-settled">settled</span>`;
    if (netAmt > 0) return `<span class="net-chip is-good">${compact ? "gets" : "gets back"} ${escapeHtml(formatMoney(netAmt))}</span>`;
    return `<span class="net-chip is-bad">owes ${escapeHtml(formatMoney(Math.abs(netAmt)))}</span>`;
  }
  function balanceHeadline(userId, balances, expenses, splits, settlements) {
    const mine = (balances || []).find((b) => b.id === userId);
    const transfers = myTransfers(balances || [], userId, expenses, splits, settlements);
    const lines = transfers.map((t) => {
      const owe = t.from.id === userId;
      const other = owe ? t.to : t.from;
      const otherName = firstName((other && (other.name || other.display_name)) || "Roommate");
      return {
        direction: owe ? "owe" : "owed",
        person: other,
        amount: t.amount,
        text: owe ? ("You owe " + otherName) : (otherName + " owes you"),
        full: owe ? ("You owe " + otherName + " " + formatMoney(t.amount)) : (otherName + " owes you " + formatMoney(t.amount)),
      };
    });
    if (!lines.length) {
      return { text: "You're all settled 🎉", cls: "is-settled", direction: "settled", counterpart: null, amount: 0, lines: [] };
    }
    if (lines.length === 1) {
      const line = lines[0];
      return {
        text: line.full,
        cls: line.direction === "owe" ? "is-owe" : "is-owed",
        direction: line.direction,
        counterpart: line.person,
        amount: line.amount,
        lines,
      };
    }
    const onlyOwe = lines.every((l) => l.direction === "owe");
    const onlyOwed = lines.every((l) => l.direction === "owed");
    const owed = lines.filter((l) => l.direction === "owed");
    return {
      text: lines.map((l) => l.full).join(" · "),
      cls: onlyOwe ? "is-owe" : (onlyOwed ? "is-owed" : "is-mixed"),
      direction: onlyOwe ? "owe" : (onlyOwed ? "owed" : "mixed"),
      counterpart: owed.length === 1 ? owed[0].person : null,
      amount: owed.length === 1 ? owed[0].amount : (lines[0] && lines[0].amount) || 0,
      lines,
    };
  }

  function remindWhatsAppHref(headline, room) {
    const roomName = (room && room.name) || "our room";
    let msg;
    const other = headline && headline.counterpart;
    const otherName = firstName((other && (other.name || other.display_name)) || "there");
    const period = (room && isTripRoom(room)) ? "this trip" : "this month";
    if (headline && headline.direction === "owe" && other) {
      msg = "Hi " + otherName + "! Just a reminder that I owe you " + formatMoney(headline.amount) + " for " + roomName + " on Monthly Budget " + period + ".";
    } else if (headline && (headline.direction === "owed" || headline.direction === "mixed") && other) {
      msg = "Hi " + otherName + "! Just a reminder that you owe me " + formatMoney(headline.amount) + " for " + roomName + " on Monthly Budget " + period + ". Let's settle up when you can.";
    } else if (headline && headline.direction === "settled") {
      msg = "We're all settled up for " + roomName + " on Monthly Budget " + period + " 🎉";
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
    if (!expense || !expense.id) return "";
    const o = opts || {};
    const members = o.members || [];
    const allSplits = o.splits || [];
    const splits = allSplits.filter((s) => s && s.expense_id === expense.id);
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
    const payerName = firstName(displayName(expense.paid_by, members) || payer.display_name || payer.name);
    const subKind = minePaid ? "You paid" : payerName + " paid";
    return `<a class="list-item expense-row" href="${escapeHtml(href)}">
      ${avatarHtml(payer, "md")}
      <div class="expense-copy">
        <div class="item-title">${escapeHtml(title)}${escapeHtml(fx)}</div>
        <div class="item-sub">${escapeHtml(subKind)} · ${escapeHtml(friendlyDate(expense.date))}${escapeHtml(shareBit)}</div>
        ${receipt}
      </div>
      <div class="item-amt">${escapeHtml(formatMoney(expense.amount))}</div>
    </a>`;
  }
  function renderOnboardingTip(host) {
    if (!host) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem("mb-onboard-tips") === "1"; } catch (e) { dismissed = false; }
    if (dismissed) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    host.classList.add("onboard-tip", "is-compact");
    host.innerHTML = `
      <p class="onboard-tip-text">The top line is your balance. Your share counts after you accept it.</p>
      <button type="button" class="text-btn onboard-tip-ok" id="dismiss-tips">Got it</button>
      <button type="button" class="promo-close" id="dismiss-tips-x" aria-label="Dismiss">${ICONS.close}</button>`;
    const hide = () => {
      try { localStorage.setItem("mb-onboard-tips", "1"); } catch (e) { /* ignore */ }
      host.hidden = true;
      host.innerHTML = "";
    };
    host.querySelectorAll("#dismiss-tips, #dismiss-tips-x").forEach((btn) => btn.addEventListener("click", hide));
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

  function pendingWithExpense(requests, expenses) {
    const byId = new Map((expenses || []).filter((e) => e && e.id).map((e) => [e.id, e]));
    return (requests || []).map((r) => {
      if (!r) return null;
      const expense = (r.expense && r.expense.id) ? r.expense : (byId.get(r.expense_id) || null);
      return expense ? { ...r, expense } : null;
    }).filter(Boolean);
  }

  function renderPendingItems(host, requests, members, expenses) {
    if (!host) return;
    const items = pendingWithExpense(requests, expenses);
    if (!items.length) {
      host.innerHTML = `<p class="empty">No pending share requests.</p>`;
      return;
    }
    host.innerHTML = items.map((r) => {
      const e = r.expense;
      if (!e || !e.id) return "";
      const payer = memberRecord(e.paid_by, members);
      return `<article class="pending-card" data-expense-id="${escapeHtml(e.id)}">
        <div>
          <div class="item-title">${escapeHtml(e.description)}</div>
          <div class="item-sub">${categoryChip(e.category)} · ${escapeHtml(friendlyDate(e.date))} · paid by ${personChip(payer, members, "sm")}</div>
          <div class="item-sub">Your share ${escapeHtml(formatMoney(r.share_amount))} ${infoTip("Your share is the part of this expense that you are responsible for.")}</div>
        </div>
        <div class="btn-row compact share-respond">
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

  const MORE_PAGES = ["my-share.html", "settle.html", "room.html", "profile.html", "requests.html", "room-settings.html", "expenses.html", "notifications.html", "invite.html", "members.html", "member.html"];

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
        <div class="brand">
          <a class="brand-logo-link" href="dashboard.html" title="Home">
            <img class="brand-logo" src="${withBase("favicon.svg?v=22")}" width="32" height="32" alt="" />
          </a>
          <p class="brand-text" id="group-current">
            <span class="group-switch-emoji" id="group-switch-emoji" hidden></span>
            <span id="room-name" class="room-name">Monthly Budget</span>
          </p>
          <button type="button" class="icon-btn group-switch-btn" id="group-switch" aria-haspopup="dialog" aria-label="Switch group" title="Switch group">${ICONS.swap}</button>
        </div>
        <nav class="desktop-nav" aria-label="Main">
          ${PAGES.filter((p) => p.id !== "profile" && p.id !== "expenses" && p.id !== "add").map((p) => `<a href="${p.href}" class="${p.href === page || (p.id === "members" && page === "member.html") ? "is-active" : ""}">${escapeHtml(p.label)}${p.id === "requests" ? `<span class="badge" data-pending-badge hidden></span>` : ""}</a>`).join("")}
        </nav>
        <div class="top-actions">
          <a class="top-avatar" href="profile.html" id="header-profile" aria-label="Profile" title="Profile">${avatarHtml({ display_name: (profile && profile.display_name) || "You", avatar_url: profile && profile.avatar_url, id: uid() }, "lg")}</a>
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
        { href: "analytics.html", label: "Analytics", icon: ICONS.chart, id: "analytics.html" },
        { href: "activity.html", label: "Activity", icon: ICONS.activity, id: "activity.html" },
        { href: "personal.html", label: "Personal", icon: ICONS.wallet, id: "personal.html" },
      ];
      bottom.innerHTML = items.map((item) =>
        `<a href="${item.href}" class="${page === item.id || (item.also || []).includes(page) ? "is-active" : ""}">${item.icon}<span>${item.label}</span></a>`
      ).join("") + `<button type="button" id="more-btn" aria-label="More options, including settle up" title="More, including settle up" ${MORE_PAGES.includes(page) ? 'class="is-active"' : ""}>${ICONS.more}<span>More</span></button>`;
    }
    const forceMonth = !!(options && options.keepMonth && (currentPage() === "personal.html" || currentPage() === "add-expense.html"));
    const peeked = !forceMonth ? peekRoomMeta() : null;
    if (month) {
      if (peeked && isTripRoom(peeked)) injectPeriodBar(peeked);
      else injectMonthBar(month);
    }
    bindGroupSwitch(options && options.rooms);
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

  function ensureMonthChrome() {
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
    return bar;
  }

  function injectPeriodBar(room) {
    const bar = ensureMonthChrome();
    const range = formatDateRange((periodBounds(room).start), periodBounds(room).end);
    bar.hidden = false;
    bar.className = "month-bar is-trip";
    bar.innerHTML = `
      <div class="month-current-wrap trip-period">
        <span class="month-current" id="month-open">Whole trip</span>
        ${range ? `<span class="month-range">${escapeHtml(range)}</span>` : ""}
      </div>`;
  }

  function paintPeriodChrome(room, opts) {
    opts = opts || {};
    const bar = $("month-picker") || document.querySelector("main > .month-bar");
    if (!bar) return;
    if (!room) {
      bar.hidden = true;
      return;
    }
    if (opts.keepMonth) {
      if (bar.classList.contains("is-trip") || !bar.querySelector("#month-input")) injectMonthBar(getSelectedMonth());
      bar.hidden = false;
      return;
    }
    if (isTripRoom(room)) injectPeriodBar(room);
    else if (bar.classList.contains("is-trip") || !bar.querySelector("#month-input")) injectMonthBar(getSelectedMonth());
    bar.hidden = false;
  }

  let lastGroupRooms = [];
  function bindGroupSwitch(rooms) {
    const btn = $("group-switch");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => openGroupSwitcher(lastGroupRooms));
  }
  function paintGroupSwitch(room) {
    const nameEl = $("room-name");
    const emojiEl = $("group-switch-emoji");
    const kicker = $("group-switch-kicker");
    const btn = $("group-switch");
    const meta = roomTypeMeta(room && room.type);
    if (nameEl) nameEl.textContent = room ? room.name : "Monthly Budget";
    if (emojiEl) {
      emojiEl.textContent = room ? meta.emoji : "";
      emojiEl.hidden = !room;
    }
    if (kicker) kicker.textContent = room ? meta.label : "Monthly Budget";
    if (btn) btn.setAttribute("aria-label", room ? ("Switch group, currently " + room.name) : "Create or switch group");
  }
  function openGroupSwitcher(rooms) {
    closeActionSheet();
    closeMoreSheet({ skipHistory: true });
    hideFabMenu();
    const list = (rooms || lastGroupRooms || []).filter((r) => r && !r.archived_at);
    const active = getActiveRoomId();
    const rows = list.length ? list.map((r) => {
      const meta = roomTypeMeta(r.type);
      const net = groupNetLabel(r.net);
      const current = r.id === active;
      const range = isTripRoom(r) ? formatDateRange(r.start_date, r.end_date) : "";
      const sub = [meta.label, range, current ? "Current" : ""].filter(Boolean).join(" · ");
      return `<button type="button" class="sheet-row group-switch-row${current ? " is-current" : ""}" data-group-id="${escapeHtml(r.id)}">
        <span class="group-switch-emoji" aria-hidden="true">${meta.emoji}</span>
        <span class="sheet-label">
          <span class="group-row-name">${escapeHtml(r.name || "Group")}</span>
          <span class="group-row-sub">${escapeHtml(sub)}</span>
        </span>
        <span class="group-row-net ${net.cls}">${escapeHtml(net.text)}</span>
      </button>`;
    }).join("") : `<p class="sheet-message">You are not in a group yet.</p>`;
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.id = "action-sheet";
    back.innerHTML = `<div class="sheet action-sheet group-sheet is-confirm" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title">
      <header class="sheet-head">
        <p class="sheet-title" id="action-sheet-title">Your groups</p>
        <button type="button" class="sheet-close" id="action-sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="sheet-body">
        <nav class="sheet-list">${rows}</nav>
        <div class="sheet-footer-actions">
          <button type="button" class="primary-btn" id="create-group-btn">Create group</button>
        </div>
      </div>
    </div>`;
    const finish = () => closeActionSheet();
    back.addEventListener("click", (e) => { if (e.target === back) finish(); });
    document.body.appendChild(back);
    bindSheetViewport();
    const closeBtn = $("action-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", finish);
    back.querySelectorAll("[data-group-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-group-id");
        const room = list.find((r) => r.id === id);
        finish();
        if (!id || id === active) return;
        setActiveRoomId(id);
        if (room) rememberRoomMeta(room);
        location.reload();
      });
    });
    const createBtn = $("create-group-btn");
    if (createBtn) createBtn.addEventListener("click", () => {
      finish();
      openCreateGroupSheet();
    });
    window.addEventListener("keydown", onActionSheetKeydown);
    try { (closeBtn || createBtn || back).focus(); } catch (err) { /* ignore */ }
    return back;
  }
  function typeOptionsHtml(selected) {
    const cur = selected || "home";
    return GROUP_TYPES.map((t) =>
      `<button type="button" class="group-type-opt${t.id === cur ? " is-active" : ""}" data-type="${t.id}" aria-pressed="${t.id === cur ? "true" : "false"}">
        <span aria-hidden="true">${t.emoji}</span>
        <span>${escapeHtml(t.label)}</span>
      </button>`
    ).join("");
  }
  function openCreateGroupSheet(opts) {
    opts = opts || {};
    closeActionSheet();
    hideFabMenu();
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.id = "action-sheet";
    back.innerHTML = `<div class="sheet action-sheet group-sheet is-confirm" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title">
      <header class="sheet-head">
        <p class="sheet-title" id="action-sheet-title">Create group</p>
        <button type="button" class="sheet-close" id="action-sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="sheet-body">
        <form id="create-group-form" class="create-group-form">
          <label class="field"><span>Name</span>
            <input type="text" id="create-group-name" maxlength="80" required placeholder="e.g. Home, Goa trip, College friends" />
          </label>
          <div class="field">
            <span>Type</span>
            <div class="group-type-grid" id="create-group-types">${typeOptionsHtml("home")}</div>
            <input type="hidden" id="create-group-type" value="home" />
          </div>
          <div id="create-group-dates" class="filters" hidden>
            <label class="field"><span>Start</span><input type="date" id="create-group-start" /></label>
            <label class="field"><span>End</span><input type="date" id="create-group-end" /></label>
          </div>
          <p class="form-error" id="create-group-error" hidden></p>
          <button type="submit" class="primary-btn">Create group</button>
        </form>
      </div>
    </div>`;
    const finish = () => closeActionSheet();
    back.addEventListener("click", (e) => { if (e.target === back) finish(); });
    document.body.appendChild(back);
    bindSheetViewport();
    const closeBtn = $("action-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", finish);
    const typeInput = $("create-group-type");
    const dates = $("create-group-dates");
    back.querySelectorAll("#create-group-types [data-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        typeInput.value = btn.getAttribute("data-type");
        back.querySelectorAll("#create-group-types [data-type]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        dates.hidden = typeInput.value !== "trip";
      });
    });
    $("create-group-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("create-group-name").value.trim();
      const typ = typeInput.value || "home";
      const err = $("create-group-error");
      if (err) { err.hidden = true; err.textContent = ""; }
      if (!name) {
        if (err) { err.hidden = false; err.textContent = "Give this group a name."; }
        return;
      }
      try {
        const { data, error } = await client().rpc("create_room", {
          p_name: name,
          p_type: typ,
          p_start_date: typ === "trip" ? ($("create-group-start").value || null) : null,
          p_end_date: typ === "trip" ? ($("create-group-end").value || null) : null,
        });
        if (error) throw error;
        if (data && data.id) {
          setActiveRoomId(data.id);
          rememberRoomMeta(data);
        }
        finish();
        location.href = "dashboard.html";
      } catch (ex) {
        if (err) { err.hidden = false; err.textContent = errorMessage(ex); }
        else showToast(errorMessage(ex), "error");
      }
    });
    window.addEventListener("keydown", onActionSheetKeydown);
    try { ($("create-group-name") || closeBtn || back).focus(); } catch (e) { /* ignore */ }
    return back;
  }

  let moreSheetPushed = false;
  function moreRow(href, icon, label, badgeAttr, tint) {
    return `<a class="sheet-row" href="${href}">
      <span class="sheet-icon ${tint || "is-lime"}" aria-hidden="true">${icon}</span>
      <span class="sheet-label">${label}</span>
      ${badgeAttr ? `<span class="badge" ${badgeAttr} hidden></span>` : ""}
      <span class="sheet-chevron" aria-hidden="true">${ICONS.chevron}</span>
    </a>`;
  }
  function moreAction(id, icon, label, tint) {
    return `<button type="button" class="sheet-row" id="${id}">
      <span class="sheet-icon ${tint || "is-lime"}" aria-hidden="true">${icon}</span>
      <span class="sheet-label">${label}</span>
      <span class="sheet-chevron" aria-hidden="true">${ICONS.chevron}</span>
    </button>`;
  }
  function moreSection(title, rows) {
    return `<section class="sheet-section">
      <h3 class="sheet-section-label">${title}</h3>
      <nav class="sheet-list">${rows}</nav>
    </section>`;
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
      <div class="sheet-body">
        ${moreSection("Money", [
          moreRow("my-share.html", ICONS.wallet, "My share", null, "is-lime"),
          moreRow("settle.html", ICONS.arrowIn, "Settle up", null, "is-forest"),
          moreRow("requests.html", ICONS.list, "Share requests", "data-pending-badge", "is-mint"),
          moreRow("expenses.html", ICONS.list, "All expenses", null, "is-lime"),
        ].join(""))}
        ${moreSection("Room", [
          moreAction("more-switch-group", ICONS.swap, "Switch group", "is-lime"),
          moreRow("members.html", ICONS.users, "Members", null, "is-forest"),
          moreRow("room.html", ICONS.home, "Room &amp; invite", null, "is-lime"),
          moreRow("room-settings.html", ICONS.gear, "Room settings", null, "is-mint"),
        ].join(""))}
        ${moreSection("You", [
          moreRow("profile.html", ICONS.user, "Profile", null, "is-forest"),
          moreRow("notifications.html", ICONS.bell, "Notifications", "data-notif-badge", "is-lime"),
        ].join(""))}
      </div>
    </div>`;
    back.addEventListener("click", (e) => { if (e.target === back) closeMoreSheet(); });
    document.body.appendChild(back);
    bindSheetViewport();
    document.body.classList.add("more-sheet-open");
    const switchBtn = $("more-switch-group");
    if (switchBtn) switchBtn.addEventListener("click", () => openGroupSwitcher(lastGroupRooms));
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
    if (el) {
      el.remove();
      unbindSheetViewport();
    }
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


  let sheetViewportBound = 0;
  function syncSheetViewport() {
    const vv = window.visualViewport;
    const layoutH = window.innerHeight || document.documentElement.clientHeight || 0;
    const height = vv && vv.height ? vv.height : layoutH;
    const offsetTop = vv && vv.offsetTop ? vv.offsetTop : 0;
    const root = document.documentElement;
    root.style.setProperty("--sheet-vvh", Math.max(160, Math.round(height)) + "px");
    root.style.setProperty("--sheet-vv-top", Math.max(0, Math.round(offsetTop)) + "px");
  }
  function bindSheetViewport() {
    sheetViewportBound += 1;
    syncSheetViewport();
    if (sheetViewportBound !== 1) return;
    window.addEventListener("resize", syncSheetViewport);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", syncSheetViewport);
      window.visualViewport.addEventListener("scroll", syncSheetViewport);
    }
  }
  function unbindSheetViewport() {
    if (sheetViewportBound <= 0) return;
    sheetViewportBound -= 1;
    if (sheetViewportBound > 0) return;
    window.removeEventListener("resize", syncSheetViewport);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener("resize", syncSheetViewport);
      window.visualViewport.removeEventListener("scroll", syncSheetViewport);
    }
    const root = document.documentElement;
    root.style.removeProperty("--sheet-vvh");
    root.style.removeProperty("--sheet-vv-top");
  }

  let actionSheetOnClose = null;
  function closeActionSheet() {
    const cb = actionSheetOnClose;
    actionSheetOnClose = null;
    const el = $("action-sheet");
    if (el) {
      el.remove();
      unbindSheetViewport();
    }
    window.removeEventListener("keydown", onActionSheetKeydown);
    if (typeof cb === "function") cb();
  }
  function onActionSheetKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeActionSheet();
    }
  }

  function fillCategorySelect(selectEl, list, selected) {
    if (!selectEl) return;
    const opts = uniqueCats(list || []);
    if (selected && !opts.includes(selected)) opts.push(selected);
    selectEl.innerHTML = opts.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    if (selected) selectEl.value = selected;
    else if (opts.length && !selectEl.value) selectEl.value = opts[0];
    syncCategoryPicker(selectEl);
  }
  function syncCategoryPicker(selectEl) {
    if (!selectEl) return;
    const field = selectEl.closest ? selectEl.closest(".field") : selectEl.parentElement;
    const btn = field && field.querySelector(".cat-picker-btn");
    if (!btn) return;
    const val = selectEl.value || "";
    const ico = btn.querySelector(".cat-picker-ico");
    const label = btn.querySelector(".cat-picker-label");
    if (ico) ico.textContent = val ? categoryIcon(val) : "";
    if (label) label.textContent = val || "Choose a category";
    btn.classList.toggle("is-empty", !val);
    if (val) btn.style.setProperty("--cat", colorForCategory(val));
    else btn.style.removeProperty("--cat");
  }
  function openCategoryPicker(opts) {
    opts = opts || {};
    closeActionSheet();
    const cats = uniqueCats(opts.categories || []);
    const selected = opts.value || "";
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.id = "action-sheet";
    back.innerHTML = `<div class="sheet action-sheet cat-sheet" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title">
      <header class="sheet-head">
        <p class="sheet-title" id="action-sheet-title">${escapeHtml(opts.title || "Category")}</p>
        <button type="button" class="sheet-close" id="action-sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="sheet-body">
        <label class="field cat-sheet-search-field">
          <span class="sr-only">Search categories</span>
          <input type="search" id="cat-sheet-search" class="search-box" placeholder="Search categories" autocomplete="off" />
        </label>
        <div class="cat-grid" id="cat-sheet-grid"></div>
      </div>
    </div>`;
    const finish = () => closeActionSheet();
    back.addEventListener("click", (e) => { if (e.target === back) finish(); });
    document.body.appendChild(back);
    bindSheetViewport();
    const closeBtn = $("action-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", finish);
    const grid = $("cat-sheet-grid");
    const search = $("cat-sheet-search");
    const paint = () => {
      const q = ((search && search.value) || "").trim().toLowerCase();
      const filtered = cats.filter((c) => !q || c.toLowerCase().includes(q));
      if (!filtered.length) {
        grid.innerHTML = `<p class="cat-grid-empty">No categories match.</p>`;
        return;
      }
      grid.innerHTML = filtered.map((c) => {
        const on = c === selected ? " is-selected" : "";
        return `<button type="button" class="cat-grid-item${on}" data-cat="${escapeHtml(c)}" style="--cat:${escapeHtml(colorForCategory(c))}">
          <span class="cat-ico" aria-hidden="true">${categoryIcon(c)}</span>
          <span class="cat-grid-name">${escapeHtml(c)}</span>
        </button>`;
      }).join("");
      grid.querySelectorAll("[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-cat");
          finish();
          if (typeof opts.onSelect === "function") opts.onSelect(name);
        });
      });
    };
    if (search) search.addEventListener("input", paint);
    paint();
    window.addEventListener("keydown", onActionSheetKeydown);
    // Do not focus the search box: on Android that opens the keyboard and covers the list.
    try { (closeBtn || back).focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    return back;
  }
  function bindCategoryPicker(selectEl) {
    if (!selectEl || selectEl.dataset.catPicker === "1") return;
    selectEl.dataset.catPicker = "1";
    selectEl.classList.add("cat-select-hidden");
    const field = selectEl.closest ? (selectEl.closest(".field") || selectEl.parentElement) : selectEl.parentElement;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cat-picker-btn";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.innerHTML = `<span class="cat-picker-ico cat-ico" aria-hidden="true"></span><span class="cat-picker-label"></span><span class="cat-picker-chevron" aria-hidden="true">${ICONS.chevron}</span>`;
    selectEl.insertAdjacentElement("afterend", btn);
    btn.addEventListener("click", () => {
      openCategoryPicker({
        title: "Category",
        categories: [...selectEl.options].map((o) => o.value).filter(Boolean),
        value: selectEl.value,
        onSelect: (name) => {
          if (![...selectEl.options].some((o) => o.value === name)) {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            selectEl.appendChild(opt);
          }
          selectEl.value = name;
          selectEl.dispatchEvent(new Event("input", { bubbles: true }));
          selectEl.dispatchEvent(new Event("change", { bubbles: true }));
          syncCategoryPicker(selectEl);
        }
      });
    });
    selectEl.addEventListener("change", () => syncCategoryPicker(selectEl));
    try {
      const mo = new MutationObserver(() => syncCategoryPicker(selectEl));
      mo.observe(selectEl, { childList: true, subtree: true });
    } catch (err) { /* ignore */ }
    syncCategoryPicker(selectEl);
  }

  function openActionSheet(opts) {
    opts = opts || {};
    closeActionSheet();
    actionSheetOnClose = typeof opts.onClose === "function" ? opts.onClose : null;
    const items = (opts.items || []).map((it, i) => {
      if (!it || !it.label) return "";
      return `<button type="button" class="sheet-row${it.danger ? " is-danger" : ""}" data-action-idx="${i}">
        <span class="sheet-label">${escapeHtml(it.label)}</span>
      </button>`;
    }).join("");
    const message = opts.message
      ? `<p class="sheet-message" id="action-sheet-desc">${escapeHtml(opts.message)}</p>`
      : "";
    const described = message ? ' aria-describedby="action-sheet-desc"' : "";
    const back = document.createElement("div");
    back.className = "sheet-backdrop";
    back.id = "action-sheet";
    back.innerHTML = `<div class="sheet action-sheet${opts.confirm ? " is-confirm" : ""}" role="dialog" aria-modal="true" aria-labelledby="action-sheet-title"${described}>
      <header class="sheet-head">
        <p class="sheet-title" id="action-sheet-title">${escapeHtml(opts.title || "Actions")}</p>
        <button type="button" class="sheet-close" id="action-sheet-close" aria-label="Close">${ICONS.close}</button>
      </header>
      <div class="sheet-body">
        ${message}
        <nav class="sheet-list">${items}</nav>
      </div>
    </div>`;
    const finish = () => closeActionSheet();
    back.addEventListener("click", (e) => { if (e.target === back) finish(); });
    document.body.appendChild(back);
    bindSheetViewport();
    const closeBtn = $("action-sheet-close");
    if (closeBtn) closeBtn.addEventListener("click", finish);
    back.querySelectorAll("[data-action-idx]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-action-idx"));
        const item = (opts.items || [])[idx];
        actionSheetOnClose = null;
        finish();
        if (item && typeof item.onSelect === "function") item.onSelect();
      });
    });
    window.addEventListener("keydown", onActionSheetKeydown);
    try { (closeBtn || back.querySelector("[data-action-idx]") || back).focus(); } catch (err) { /* ignore */ }
    return back;
  }

  function confirmAction(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => { if (settled) return; settled = true; resolve(!!val); };
      openActionSheet({
        title: opts.title || "Are you sure?",
        message: opts.message || "",
        confirm: true,
        onClose: () => done(false),
        items: [
          { label: opts.confirmLabel || "Confirm", danger: opts.danger !== false, onSelect: () => done(true) },
          { label: opts.cancelLabel || "Keep it", onSelect: () => done(false) },
        ],
      });
    });
  }

  const UNDO_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  function canUndoSettlement(s, uid, roomOrAdmin) {
    if (!s || !uid) return false;
    const st = String(s.status || "").toLowerCase();
    if (st !== "confirmed") return false;
    const isMgr = typeof roomOrAdmin === "boolean" ? roomOrAdmin : isAdmin(roomOrAdmin);
    if (s.from_user !== uid && !isMgr) return false;
    const start = s.confirmed_at || s.created_at || s.date;
    if (!start) return true;
    const t = new Date(start).getTime();
    if (!Number.isFinite(t)) return true;
    return (Date.now() - t) <= UNDO_WINDOW_MS;
  }

  async function voidSettlement(id) {
    const { data, error } = await client().rpc("void_settlement", { p_settlement_id: id });
    if (error) throw error;
    return data;
  }

  async function promptUndoSettlement(s, members) {
    if (!s || !s.id) return false;
    const amt = formatMoney(s.amount);
    const fromRec = members ? memberRecord(s.from_user, members) : null;
    const toRec = members ? memberRecord(s.to_user, members) : null;
    const fromName = firstName((fromRec && (fromRec.display_name || fromRec.name)) || "a roommate");
    const toName = firstName((toRec && (toRec.display_name || toRec.name)) || "a roommate");
    const ok = await confirmAction({
      title: "Undo this payment?",
      message: "The " + amt + " payment from " + fromName + " to " + toName + " will no longer count toward balances.",
      confirmLabel: "Undo payment",
      cancelLabel: "Keep it",
      danger: true,
    });
    if (!ok) return false;
    await voidSettlement(s.id);
    showToast("Payment undone", "ok");
    return true;
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
  function showToast(message, kind) {
    const text = message || "";
    if (!text) return;
    let el = $("mb-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "mb-toast";
      el.className = "mb-toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.className = "mb-toast" + (kind === "error" ? " is-error" : kind === "ok" ? " is-ok" : "");
    el.hidden = false;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { el.hidden = true; }, kind === "error" ? 6000 : 2800);
  }
  function showError(id, message) {
    const el = $(id);
    const buried = !!(el && el.closest && el.closest("[hidden]"));
    if (!el) {
      showToast(message, "error");
      showPageError(message);
      return;
    }
    el.hidden = false;
    el.textContent = message;
    if (buried) showToast(message, "error");
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

  async function fetchAppStateData() {
    const { data, error } = await client().rpc("get_app_state", {
      p_room_id: getActiveRoomId() || null,
      p_month: getSelectedMonth(),
    });
    if (error) throw error;
    return data;
  }
  function afterBootSession() {
    try { startNotifWatch(); } catch (err) { console.warn(err); }
    try {
      // Re-register on every open while permission is granted, so a device whose
      // registration expired (for example after installing the Android app) heals itself.
      const optedOut = localStorage.getItem("mb-push-opted-out") === "1";
      if (!optedOut && "Notification" in window && Notification.permission === "granted") {
        ensurePushSubscription().catch((err) => console.warn("push re-register failed", err));
      }
    } catch (e) { /* ignore */ }
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
    const month = getSelectedMonth();
    const roomId = getActiveRoomId() || null;
    const memKey = stateCacheKey(uid(), roomId, periodCacheKey(peekRoomMeta() || periodRoom, month));
    if (memoryAppState && memoryAppState.key === memKey && memoryAppState.fresh && memoryAppState.data && (Date.now() - memoryAppState.at) < 2000) {
      const appliedFast = applyAppState(memoryAppState.data);
      paintBootChrome(appliedFast);
      if (mainEl) mainEl.classList.remove("is-loading");
      afterBootSession();
      return buildAppCtx(appliedFast, { fromCache: false, cachedAt: memoryAppState.at });
    }

    maybeMarkReadFromQuery().catch(() => {});
    const pendingJoin = await maybeJoinPendingCode();
    const useCache = !pendingJoin;
    const cachedWrap = useCache ? readCachedState(uid(), getActiveRoomId() || roomId, periodCacheKey(peekRoomMeta() || periodRoom, month)) : null;
    const cachedOk = cachedWrap && cacheMatches(cachedWrap, uid(), getActiveRoomId() || roomId, month) && cachedWrap.state && cachedWrap.state.profile;
    if (cachedOk) {
      profile = cachedWrap.state.profile;
      if (profile.currency && CURRENCIES.some((c) => c.code === profile.currency)) currency = profile.currency;
      const appliedCache = applyAppState(cachedWrap.state);
      paintBootChrome(appliedCache);
      if (mainEl) mainEl.classList.remove("is-loading");
      const age = Date.now() - (cachedWrap.cachedAt || 0);
      if (age > STALE_AFTER_MS) showUpdating(true);
      else showUpdating(false);
      const prevSig = stateSignature(cachedWrap.state);
      const refresh = (async () => {
        try {
          const data = await fetchAppStateData();
          const applied = applyAppState(data);
          writeCachedState(data, uid(), applied.room && applied.room.id, periodCacheKey(applied.room, month));
          paintBootChrome(applied);
          const changed = stateSignature(data) !== prevSig;
          const ctx = buildAppCtx(applied, { fromCache: false, cachedAt: Date.now() });
          ctx._changed = changed;
          try { window.dispatchEvent(new CustomEvent("mb-app-state", { detail: ctx })); } catch (e) { /* ignore */ }
          return ctx;
        } catch (err) {
          console.warn(err);
          return null;
        } finally {
          showUpdating(false);
        }
      })();
      lastWhenFresh = refresh;
      afterBootSession();
      return buildAppCtx(appliedCache, { fromCache: true, cachedAt: cachedWrap.cachedAt, whenFresh: refresh });
    }

    if (mainEl) mainEl.classList.add("is-loading");
    let applied = null;
    try {
      const data = await fetchAppStateData();
      applied = applyAppState(data);
      writeCachedState(data, uid(), applied.room && applied.room.id, periodCacheKey(applied.room, month));
    } catch (err) {
      console.warn(err);
      await loadProfile();
      paintHeaderAvatar(profile);
      const rooms = await loadRooms();
      const room = await resolveActiveRoom(rooms);
      let pending = [];
      let unread = 0;
      if (room) {
        try { await client().rpc("generate_recurring_for_month", { p_room_id: room.id, p_month: getSelectedMonth() }); }
        catch (e2) { console.warn(e2); }
        try { pending = await loadPendingRequests(room.id); } catch (e3) { console.warn(e3); }
      }
      try { unread = await loadUnreadCount(); } catch (e4) { console.warn(e4); }
      applied = { rooms, room, pending, unread, members: [], expenses: [], splits: [], settlements: [] };
    }
    paintBootChrome(applied);
    if (mainEl) mainEl.classList.remove("is-loading");
    showUpdating(false);
    afterBootSession();
    return buildAppCtx(applied, { fromCache: false, cachedAt: Date.now() });
  }
  async function runPage(mainFn, options) {
    try {
      if (options) {
        // Allow runPage({ title }, main) or runPage(main)
      }
      const fn = typeof mainFn === "function" ? mainFn : options;
      const opts = typeof mainFn === "function" ? options : mainFn;
      if (typeof fn !== "function") return;
      // Pages call bootApp themselves. First run may use cache; refresh then reruns.
      await fn();
      const pending = lastWhenFresh;
      lastWhenFresh = null;
      if (pending) {
        const next = await pending;
        if (next && next._changed) await fn();
      }
    } catch (err) {
      console.error(err);
      showPageError(errorMessage(err));
    }
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
      new Notification(title, {
        body: body || "",
        tag: key,
        icon: withBase("icons/icon-192.png"),
        badge: withBase("icons/badge-96.png"),
      });
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
  function subscriptionKeys(sub) {
    if (!sub) return null;
    const json = typeof sub.toJSON === "function" ? sub.toJSON() : sub;
    const keys = (json && json.keys) || {};
    if (!json || !json.endpoint || !keys.p256dh || !keys.auth) return null;
    return { endpoint: json.endpoint, p256dh: keys.p256dh, auth: keys.auth };
  }
  async function upsertCurrentSubscription(sub) {
    const keys = subscriptionKeys(sub);
    if (!keys) throw new Error("This device does not have a complete push subscription.");
    const { error } = await client().rpc("upsert_push_subscription", {
      p_endpoint: keys.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_user_agent: navigator.userAgent,
    });
    if (error) throw error;
    try { localStorage.setItem("mb-push-enabled", "1"); localStorage.removeItem("mb-push-opted-out"); } catch (e) { /* ignore */ }
    return keys;
  }
  // One push registration change at a time: two overlapping subscribe/unsubscribe
  // calls (page boot + Enable tap, or two tabs) used to kill each other's endpoints.
  let pushOp = null;
  function withPushLock(fn) {
    const run = (pushOp || Promise.resolve()).catch(() => {}).then(fn);
    pushOp = run.finally(() => { if (pushOp === run) pushOp = null; });
    return run;
  }
  function subscribePush(opts) { return withPushLock(() => subscribePushInner(opts)); }
  async function subscribePushInner(opts) {
    const force = !!(opts && opts.force);
    if (!vapidPublicKey()) throw new Error("Push is not configured on this site yet.");
    if (!("Notification" in window) || !("PushManager" in window)) throw new Error("This browser does not support phone notifications.");
    if (isIosDevice() && !isStandaloneApp()) {
      throw new Error("On iPhone, add Monthly Budget to your Home Screen first (Share → Add to Home Screen), then open it from there. Push works on iOS 16.4 and later.");
    }
    const permission = await requestBrowserNotify();
    if (permission !== "granted") throw new Error("Notifications are blocked. Allow them in the browser or system settings, then try again.");
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (force && sub) {
      try { await client().rpc("delete_push_subscription", { p_endpoint: sub.endpoint }); } catch (e) { /* ignore */ }
      try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
      sub = null;
    }
    const fresh = async () => reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
    });
    if (!sub) sub = await fresh();
    try {
      await upsertCurrentSubscription(sub);
    } catch (err) {
      // The server knows this registration is dead (the push service said 404/410).
      // Throw it away and register this device again.
      if (!isExpiredPushError(err)) throw err;
      try { await client().rpc("delete_push_subscription", { p_endpoint: sub.endpoint }); } catch (e) { /* ignore */ }
      try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
      sub = await fresh();
      await upsertCurrentSubscription(sub);
    }
    return sub;
  }
  function isExpiredPushError(err) {
    const code = err && (err.code || (err.cause && err.cause.code));
    const msg = String((err && (err.message || err.details)) || "");
    return code === "P0410" || code === "PT410" || msg.indexOf("push_endpoint_expired") >= 0;
  }
  async function pushStatus() {
    const supported = ("Notification" in window) && ("PushManager" in window) && ("serviceWorker" in navigator);
    if (!supported) return { supported: false, permission: "unsupported", subscribed: false };
    const permission = Notification.permission;
    let subscribed = false;
    if (permission === "granted") {
      try {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))]);
        const sub = reg ? await reg.pushManager.getSubscription() : null;
        subscribed = !!(sub && subscriptionKeys(sub));
      } catch (e) { subscribed = false; }
    }
    return { supported: true, permission, subscribed };
  }
  function ensurePushSubscription() {
    return withPushLock(async () => {
      if (!("Notification" in window) || Notification.permission !== "granted") {
        return subscribePushInner();
      }
      const existing = await getPushSubscription().catch(() => null);
      if (existing && subscriptionKeys(existing)) {
        try {
          await upsertCurrentSubscription(existing);
          return existing;
        } catch (err) {
          // Only throw the registration away when the server says it is dead;
          // a network hiccup must not unsubscribe a working device.
          if (!isExpiredPushError(err)) throw err;
          return subscribePushInner({ force: true });
        }
      }
      return subscribePushInner();
    });
  }
  async function unsubscribePush() {
    const sub = await getPushSubscription();
    if (sub) {
      try { await client().rpc("delete_push_subscription", { p_endpoint: sub.endpoint }); } catch (e) { /* ignore */ }
      try { await sub.unsubscribe(); } catch (e2) { /* ignore */ }
    } else {
      try { await client().rpc("delete_push_subscription", { p_endpoint: null }); } catch (e) { /* ignore */ }
    }
    try { localStorage.removeItem("mb-push-enabled"); localStorage.setItem("mb-push-opted-out", "1"); } catch (e) { /* ignore */ }
  }
  async function sendTestPush() {
    const sub = await ensurePushSubscription();
    const keys = subscriptionKeys(sub);
    let inserted = null;
    try {
      const rec = await client().rpc("send_test_notification");
      if (rec.error) throw rec.error;
      inserted = rec.data;
    } catch (err) { /* still try the direct push so the phone can be tested */ }
    const payload = {
      test: true,
      endpoint: keys && keys.endpoint,
      record: {
        id: inserted && inserted.id,
        user_id: uid(),
        type: "push_test",
        title: "Test notification",
        body: "If you can see this, phone notifications are working. The phone uses its default sound.",
        link: "notifications.html",
      },
    };
    let data = null, fnErr = null;
    try {
      const res = await client().functions.invoke("send-push", { body: payload });
      data = res.data;
      fnErr = res.error;
    } catch (err) {
      fnErr = err;
    }
    if (fnErr) {
      const msg = errorMessage(fnErr);
      const err = new Error(msg || "Could not reach the push service.");
      err.cause = fnErr;
      err.result = data;
      throw err;
    }
    if (!data || data.ok === false || !data.sent) {
      const detail = (data && (data.error || (data.results && data.results.map((r) => r.message || r.status).join("; ")))) || "The push service did not accept the message.";
      const err = new Error(detail);
      err.result = data;
      throw err;
    }
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


  const STATE_KEY_PREFIX = "monthly-budget-app-state:";
  const STATE_KEY = "monthly-budget-app-state";
  const STALE_AFTER_MS = 3 * 60 * 1000;
  let memoryAppState = null;
  let lastWhenFresh = null;
  const EYE_ON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3l18 18M10.5 10.7A3 3 0 0 0 13.3 13.5M9.9 5.1A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-4.2 4.8M6.7 6.7C3.9 8.6 2 12 2 12a18 18 0 0 0 6.1 5.9C9.3 18.6 10.6 19 12 19c.6 0 1.1 0 1.7-.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function stateCacheKey(userId, roomId, month) {
    return STATE_KEY_PREFIX + (userId || "anon") + ":" + (roomId || "none") + ":" + (month || "");
  }
  function clearMemoryAppState() {
    memoryAppState = null;
    lastWhenFresh = null;
  }
  function readCachedState(userId, roomId, month) {
    const uidVal = userId || uid() || "";
    const roomVal = roomId || getActiveRoomId() || "";
    const monthVal = month || getSelectedMonth();
    const keys = [];
    if (uidVal) keys.push(stateCacheKey(uidVal, roomVal, monthVal));
    keys.push(STATE_KEY);
    for (let i = 0; i < keys.length; i++) {
      try {
        const wrap = JSON.parse(localStorage.getItem(keys[i]) || "null");
        if (wrap && wrap.state) return wrap;
      } catch (e) { /* try next */ }
    }
    return null;
  }
  function writeCachedState(state, userId, roomId, month) {
    const wrap = { state: state, cachedAt: Date.now(), userId: userId || uid() || "", roomId: roomId || (state && state.room_id) || getActiveRoomId() || "", month: month || getSelectedMonth() };
    const key = stateCacheKey(wrap.userId, wrap.roomId, wrap.month);
    const payload = JSON.stringify(wrap);
    try {
      localStorage.setItem(key, payload);
      try { localStorage.removeItem(STATE_KEY); } catch (e2) { /* ignore */ }
      memoryAppState = { key, data: state, at: wrap.cachedAt, fresh: true };
    } catch (e) {
      tryWriteStateIdb(key, payload);
    }
  }
  function tryWriteStateIdb(key, payload) {
    try {
      if (!("indexedDB" in window)) return;
      const req = indexedDB.open("monthly-budget", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("app-state")) db.createObjectStore("app-state");
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction("app-state", "readwrite");
          tx.objectStore("app-state").put(payload, key);
        } catch (e) { /* ignore */ }
      };
    } catch (e) { /* ignore */ }
  }
  function clearCachedState() {
    clearMemoryAppState();
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k === STATE_KEY || k.indexOf(STATE_KEY_PREFIX) === 0)) drop.push(k);
      }
      drop.forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    try {
      if ("indexedDB" in window) indexedDB.deleteDatabase("monthly-budget");
    } catch (e) { /* ignore */ }
  }
  function showUpdating(show) {
    let el = document.getElementById("mb-updating");
    if (!el) {
      el = document.createElement("div");
      el.id = "mb-updating";
      el.className = "mb-updating";
      el.setAttribute("role", "status");
      el.textContent = "Updating…";
      const chrome = document.querySelector(".app-chrome") || document.getElementById("topbar") || document.body;
      if (chrome && chrome.parentNode && chrome !== document.body) chrome.parentNode.insertBefore(el, chrome.nextSibling);
      else document.body.insertBefore(el, document.body.firstChild);
    }
    el.hidden = !show;
  }
  function cacheMatches(wrap, userId, roomId, month) {
    if (!wrap || !wrap.state) return false;
    const st = wrap.state;
    if (userId && st.profile && st.profile.id && st.profile.id !== userId) return false;
    if (roomId && st.room_id && st.room_id !== roomId) return false;
    return true;
  }
  function stateSignature(data) {
    if (!data) return "";
    try {
      return JSON.stringify({
        room_id: data.room_id, unread: data.unread,
        expenses: data.expenses, splits: data.splits, settlements: data.settlements,
        pending: data.pending, members: data.members, invites: data.invites,
        join_requests: data.join_requests,
      });
    } catch (e) { return String(Date.now()); }
  }
  function buildAppCtx(applied, extra) {
    extra = extra || {};
    return {
      sb: client(),
      session,
      profile,
      rooms: applied && applied.rooms,
      room: applied && applied.room,
      month: getSelectedMonth(),
      uid: uid(),
      pending: (applied && applied.pending) || [],
      unread: (applied && applied.unread) || 0,
      isAdmin: isAdmin(applied && applied.room),
      isOwner: isOwner(applied && applied.room),
      members: applied && applied.members,
      expenses: applied && applied.expenses,
      splits: applied && applied.splits,
      settlements: applied && applied.settlements,
      invites: applied && applied.invites,
      joinRequests: applied && applied.joinRequests,
      categoryBudgets: applied && applied.categoryBudgets,
      presets: applied && applied.presets,
      spendByMonth: applied && applied.spendByMonth,
      fromCache: !!extra.fromCache,
      cachedAt: extra.cachedAt || null,
      whenFresh: extra.whenFresh || null,
    };
  }
  function paintBootChrome(applied) {
    const rooms = (applied && applied.rooms) || [];
    const room = applied && applied.room;
    const pending = (applied && applied.pending) || [];
    const unread = (applied && applied.unread) || 0;
    periodRoom = room || null;
    lastGroupRooms = rooms.slice();
    paintGroupSwitch(room);
    rememberRoomMeta(room);
    paintPeriodChrome(room, { keepMonth: currentPage() === "personal.html" || (currentPage() === "add-expense.html" && /(?:^|[?&])(?:mode|kind)=personal/.test(location.search)) });
    if (room && room.currency && CURRENCIES.some((c) => c.code === room.currency)) currency = room.currency;
    setPendingBadge(pending.length || 0);
    setNotifBadge(unread || 0);
    paintHeaderAvatar(profile);
  }
  function patchProfile(partial) {
    if (!partial) return profile;
    profile = Object.assign({}, profile || {}, partial);
    if (partial.currency && CURRENCIES.some((c) => c.code === partial.currency)) currency = partial.currency;
    const cached = readCachedState();
    if (cached && cached.state) {
      if (cached.state.profile) cached.state.profile = Object.assign({}, cached.state.profile, partial);
      if (Array.isArray(cached.state.members) && profile.id) {
        cached.state.members = cached.state.members.map((m) => (m && m.id === profile.id) ? Object.assign({}, m, partial) : m);
      }
      writeCachedState(cached.state);
    }
    paintHeaderAvatar(profile);
    return profile;
  }
  function initials(name) {
    const s = String(name || "?").trim();
    return (s.slice(0, 1) || "?").toUpperCase();
  }
  function bustAvatarUrl(url) {
    if (!url) return "";
    const u = String(url);
    if (/[?&]v=/.test(u)) return u;
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "v=1";
  }
  function avatarUrlOf(person) {
    return bustAvatarUrl(person && (person.avatar_url || person.actor_avatar) ? (person.avatar_url || person.actor_avatar) : "");
  }
  function avatarHue(id) {
    const s = String(id || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return Math.abs(h) % 360;
  }
  const AVATAR_PALETTE = [
    { bg: "#2B2C29", fg: "#9FE870" },
    { bg: "#4A4B48", fg: "#FFFFFF" },
    { bg: "#1F3A5C", fg: "#D6E8FF" },
    { bg: "#4A2C5A", fg: "#F3D9FF" },
    { bg: "#3D2A1A", fg: "#FFD7B0" },
    { bg: "#1F3D38", fg: "#B8F0E4" },
    { bg: "#3A2A16", fg: "#F5D76E" },
    { bg: "#2C2C4A", fg: "#C9C9FF" },
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
  const AVATAR_SIZE = {
    xs: "xs", sm: "sm", md: "md", lg: "lg", xl: "xl",
    "avatar-xs": "xs", "sm": "sm", "md": "md",
    "avatar-lg": "lg", "avatar-xl": "xl",
    "avatar-row": "md", row: "md",
  };
  function avatarSize(size) {
    const raw = String(size || "md").trim();
    if (AVATAR_SIZE[raw]) return AVATAR_SIZE[raw];
    const m = raw.match(/avatar-(xs|sm|md|lg|xl|row)/);
    if (m) return m[1] === "row" ? "md" : m[1];
    return "md";
  }
  function avatarHtml(person, size) {
    const p = person || {};
    const name = p.display_name || p.name || p.actor_name || "?";
    const url = avatarUrlOf(p);
    const key = avatarSize(size);
    const klass = "avatar avatar-" + key;
    const sw = avatarSwatch(p.id || p.user_id || p.actor_id || name);
    const style = `--avatar-bg:${sw.bg};--avatar-fg:${sw.fg};background:${sw.bg};color:${sw.fg}`;
    if (url) {
      return `<span class="${klass}" style="${style}"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" /></span>`;
    }
    return `<span class="avatar-fallback ${klass}" style="${style}">${escapeHtml(initials(name))}</span>`;
  }
  function personChip(personOrId, members, size) {
    const p = (personOrId && typeof personOrId === "object")
      ? personOrId
      : memberRecord(personOrId, members);
    const id = p.id || p.user_id;
    const name = (id && members) ? displayName(id, members) : (p.display_name || p.name || p.actor_name || "Member");
    const key = avatarSize(size || "sm");
    return `<span class="person person-${key}">${avatarHtml(p, key)}<span class="person-name">${escapeHtml(name)}</span></span>`;
  }
  function paintHeaderAvatar(p) {
    const el = document.getElementById("header-profile");
    if (!el) return;
    const person = p || profile;
    if (!person) return;
    el.innerHTML = avatarHtml(person, "lg");
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
  function compressImage(file, size, quality, opts) {
    size = size || 512;
    quality = quality == null ? 0.82 : quality;
    const fit = !!(opts && (opts.fit === true || opts.fit === "contain"));
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error("No image selected."));
      const type = (file.type || "").toLowerCase();
      if (type && !type.startsWith("image/")) return reject(new Error("Please choose a photo (JPEG, PNG, or WebP)."));
      function toJpeg(source, width, height) {
        const canvas = document.createElement("canvas");
        const ctxSetup = () => {
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject(new Error("Could not compress the image.")), null;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          return ctx;
        };
        if (fit) {
          const scale = Math.min(1, size / Math.max(width, height, 1));
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = ctxSetup();
          if (!ctx) return;
          ctx.drawImage(source, 0, 0, width, height, 0, 0, canvas.width, canvas.height);
        } else {
          const side = Math.min(width, height) || size;
          const sx = (width - side) / 2;
          const sy = (height - side) / 2;
          canvas.width = size;
          canvas.height = size;
          const ctx = ctxSetup();
          if (!ctx) return;
          ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
        }
        const done = (blob) => {
          if (!blob) return reject(new Error("Could not compress the image."));
          resolve(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
        };
        if (canvas.toBlob) canvas.toBlob(done, "image/jpeg", quality);
        else {
          const bin = atob(canvas.toDataURL("image/jpeg", quality).split(",")[1] || "");
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          done(new Blob([bytes], { type: "image/jpeg" }));
        }
      }
      const failRead = () => reject(new Error("That photo format isn't supported. Please choose a JPEG or PNG."));
      if (typeof createImageBitmap === "function") {
        const opts = { imageOrientation: "from-image" };
        Promise.resolve()
          .then(() => createImageBitmap(file, opts).catch(() => createImageBitmap(file)))
          .then((bitmap) => {
            try { toJpeg(bitmap, bitmap.width, bitmap.height); }
            finally { try { bitmap.close(); } catch (e) { /* ignore */ } }
          })
          .catch(() => loadViaImage());
        return;
      }
      function loadViaImage() {
        const img = new Image();
        const url = URL.createObjectURL(file);
        const timer = setTimeout(() => { URL.revokeObjectURL(url); failRead(); }, 20000);
        img.onload = () => {
          clearTimeout(timer);
          try { toJpeg(img, img.naturalWidth || img.width, img.naturalHeight || img.height); }
          finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { clearTimeout(timer); URL.revokeObjectURL(url); failRead(); };
        img.src = url;
      }
      loadViaImage();
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
    const skipFab = ["add-expense.html", "login.html", "signup.html", "reset-password.html", "invite.html", "index.html", ""];
    if (skipFab.includes(page)) return;
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

  function proofThumbHtml(url, alt) {
    if (!url) return "";
    return `<button type="button" class="receipt-thumb-btn" data-proof-src="${escapeHtml(url)}" aria-label="${escapeHtml(alt || "View screenshot")}"><img class="receipt-thumb" src="${escapeHtml(url)}" alt="${escapeHtml(alt || "Payment screenshot")}" /></button>`;
  }
  function openProofLightbox(url) {
    if (!url) return;
    let box = $("proof-lightbox");
    if (!box) {
      box = document.createElement("div");
      box.id = "proof-lightbox";
      box.className = "proof-lightbox";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Payment screenshot");
      box.innerHTML = '<button type="button" class="proof-lightbox-close" aria-label="Close">×</button><img alt="Payment screenshot" />';
      document.body.appendChild(box);
      const close = () => { box.hidden = true; document.body.classList.remove("lightbox-open"); };
      box.addEventListener("click", (ev) => {
        if (ev.target === box || ev.target.closest(".proof-lightbox-close")) close();
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && box && !box.hidden) close();
      });
    }
    const img = box.querySelector("img");
    img.src = url;
    box.hidden = false;
    document.body.classList.add("lightbox-open");
  }
  function bindProofLightbox() {
    if (bindProofLightbox._bound) return;
    bindProofLightbox._bound = true;
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-proof-src]");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      openProofLightbox(btn.getAttribute("data-proof-src"));
    });
  }


  function decorateRequiredFields(root) {
    const scope = root || document;
    scope.querySelectorAll("label.field").forEach((lab) => {
      const control = lab.querySelector("input, select, textarea");
      const span = lab.querySelector(":scope > span");
      if (!span) return;
      const needed = lab.hasAttribute("data-required") || (control && control.required && !control.disabled);
      let mark = span.querySelector(".req");
      if (needed) {
        if (!mark) {
          mark = document.createElement("span");
          mark.className = "req";
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = "*";
          span.appendChild(document.createTextNode(" "));
          span.appendChild(mark);
        }
        mark.hidden = false;
      } else if (mark) {
        mark.hidden = true;
      }
    });
  }

  function setFieldError(el, message) {
    if (typeof el === "string") el = $(el);
    if (!el) return;
    const field = el.closest ? (el.closest(".field") || el.closest("#split-box") || el.parentElement) : null;
    let host = null;
    if (el.classList && el.classList.contains("field-error")) host = el;
    else if (field) {
      host = field.querySelector(":scope > .field-error");
      if (!host && field.id === "split-box") host = document.getElementById("split-error");
      if (!host) {
        host = document.createElement("p");
        host.className = "field-error";
        host.setAttribute("role", "alert");
        field.appendChild(host);
      }
    }
    if (field && field.classList) field.classList.toggle("is-invalid", !!message);
    if (message) el.setAttribute("aria-invalid", "true");
    else el.removeAttribute("aria-invalid");
    if (host) {
      host.hidden = !message;
      host.textContent = message || "";
    }
  }

  function clearFormErrors(form) {
    if (!form) return;
    form.querySelectorAll(".field.is-invalid, #split-box.is-invalid").forEach((f) => f.classList.remove("is-invalid"));
    form.querySelectorAll(".field-error").forEach((p) => { p.hidden = true; p.textContent = ""; });
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
  }

  function applyFormErrors(form, errors, opts) {
    const o = opts || {};
    clearFormErrors(form);
    const list = (errors || []).filter((e) => e && e.message && e.el);
    list.forEach((e) => setFieldError(e.el, e.message));
    let first = list[0] && (typeof list[0].el === "string" ? $(list[0].el) : list[0].el);
    if (first && first.classList && first.classList.contains("cat-select-hidden")) {
      const btn = first.parentElement && first.parentElement.querySelector(".cat-picker-btn");
      if (btn) first = btn;
    }
    if (o.focus !== false && first && typeof first.focus === "function") {
      try {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first.focus({ preventScroll: true });
      } catch (err) {
        try { first.focus(); } catch (e2) { /* ignore */ }
      }
    }
    const btn = o.button || (form && form.querySelector('button[type="submit"]'));
    if (btn && o.disable !== false) btn.disabled = list.length > 0;
    return list.length === 0;
  }

  function bindFormValidation(form, collectErrors, opts) {
    if (!form || typeof collectErrors !== "function") return () => true;
    form.setAttribute("novalidate", "");
    decorateRequiredFields(form);
    const button = (opts && opts.button) || form.querySelector('button[type="submit"]');
    let attempted = !!(opts && opts.immediate);
    const sync = (focus) => {
      const errors = collectErrors() || [];
      const invalid = errors.some((e) => e && e.message);
      if (button && (!opts || opts.disable !== false)) button.disabled = invalid;
      if (attempted) applyFormErrors(form, errors, { button, focus: !!focus, disable: opts && opts.disable });
      else clearFormErrors(form);
      if (button && (!opts || opts.disable !== false)) button.disabled = invalid;
      return !invalid;
    };
    form.addEventListener("input", () => sync(false));
    form.addEventListener("change", () => sync(false));
    form.addEventListener("submit", (ev) => {
      attempted = true;
      if (!sync(true)) ev.preventDefault();
    }, true);
    sync(false);
    return (focus) => { attempted = true; return sync(!!focus); };
  }

  window.MB = {
    CATEGORIES, PERSONAL_EXPENSE_CATS, INCOME_CATS, CAT_COLORS, CAT_COLOR_TOKENS, CAT_ICONS, CURRENCIES, MONTHS, ICONS,
    $, escapeHtml, errorMessage, formatMoney, equalSplits,
    getSelectedMonth, setSelectedMonth, monthLabel, monthBounds, todayISO, localDayKey,
    GROUP_TYPES, roomTypeMeta, isTripRoom, periodBounds, formatDateRange, openGroupSwitcher, openCreateGroupSheet, paintGroupSwitch, groupNetLabel,
    client, uid, currentPage, configured,
    getActiveRoomId, setActiveRoomId,
    loadRooms, loadMembers, loadMonthData, loadProfile, resolveActiveRoom,
    memberBalances, settleSuggestions, cancelDebtCycles, myTransfers, pendingSettlementFor, oweRowHtml, displayName, netLabel,
    acceptedSplits, splitStatusLabel, splitStatusKey, splitStatusSummary, statusChip,
    friendlyDate, firstName, relativeTime, formatDateIN, enhanceDateFields, daysLeftInMonth, categoryIcon, categoryAvatarHtml, categoryChip, infoTip, bindInfoTips, closeInfoTip, emptyState, openActionSheet, closeActionSheet, confirmAction, canUndoSettlement, voidSettlement, promptUndoSettlement,
    memberNetChip, balanceHeadline, remindWhatsAppHref, monthSpendSentence, expenseRowHtml, balanceFootnote, paintBalanceNote, personChip, memberRecord, avatarHue, avatarSwatch, avatarSize, avatarHtml,
    renderOnboardingTip,
    loadPendingRequests, respondToShare, pendingWithExpense, renderPendingItems, setPendingBadge, balanceFootnote, shareStatCaption,
    decorateRequiredFields, setFieldError, clearFormErrors, applyFormErrors, bindFormValidation,
    isAdmin, isOwner, roleLabel, roomCategories, pickerCategories, loadUnreadCount, setNotifBadge,
    withoutAdminLabel, fillCategorySelect, bindCategoryPicker, syncCategoryPicker, openCategoryPicker,
    colorForCategory, monthKeysBack, shiftMonth, loadRoomExpensesRange, loadPersonalRange,
    loadRoomCategoryBudgets, maybeBrowserNotify, requestBrowserNotify,
    isIosDevice, isStandaloneApp, pushStatus, subscribePush, unsubscribePush, sendTestPush, getPushSubscription, ensurePushSubscription,
    invitePageUrl, inviteShareText, whatsappShareHref, copyInviteMessage, shareInvite, safeNextPath,
    avatarHtml, paintHeaderAvatar, enhancePasswordFields, bindPasswordRules, itemizedSplits, fetchFxRate, proofThumbHtml, openProofLightbox, bindProofLightbox,
    compressImage, signedReceiptUrl, loadChartJs, whenVisible, cssToken, initials,
    bootAuthPage, bootApp, runPage, clearCachedState, showError, hideError, showPageError, showToast, patchProfile, bustAvatarUrl, setTheme, currentTheme, siteBase, withBase, originUrl,
    get profile() { return profile; },
    setCurrency(code) { currency = code; },
    get currency() { return currency; },
  };

  document.addEventListener("DOMContentLoaded", () => { enhancePasswordFields(); enhanceDateFields(); bindProofLightbox(); bindInfoTips(); decorateRequiredFields(); });
  if (document.readyState !== "loading") { enhancePasswordFields(); enhanceDateFields(); bindProofLightbox(); bindInfoTips(); decorateRequiredFields(); }
})();
