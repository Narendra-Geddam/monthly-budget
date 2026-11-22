/* Monthly Budget service worker: versioned cache + web push. */
const SHELL_CACHE = "mb-shell-v14";
const BASE = (self.location.pathname || "").replace(/\/sw\.js$/, "");
const SHELL_FILES = [
  "dashboard.html",
  "activity.html",
  "login.html",
  "styles.css",
  "js/common.js",
  "js/dashboard.js",
  "js/activity.js",
  "vendor/supabase.min.js",
  "vendor/chart.umd.min.js",
  "config.js",
  "manifest.json",
  "favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-192-maskable.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png",
  "icons/og.png",
];
const SHELL = SHELL_FILES.map((p) => (BASE || "") + "/" + p);

function withBase(path) {
  if (!path) return (BASE || "") + "/dashboard.html";
  if (/^https?:/i.test(path)) return path;
  return (BASE || "") + "/" + String(path).replace(/^\/+/, "");
}

function isHtmlOrJs(pathname) {
  return pathname === "/" || pathname === BASE || pathname === BASE + "/" ||
    pathname.endsWith(".html") || pathname.endsWith(".js") || pathname.endsWith("/sw.js");
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL_CACHE && k.startsWith("mb-shell-")).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/.netlify/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    if (isHtmlOrJs(url.pathname)) {
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        throw err;
      }
    }
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    if (cached) {
      network.catch(() => {});
      return cached;
    }
    return network;
  })());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    try { payload = { title: "Monthly Budget", body: event.data.text() }; } catch (e2) { payload = {}; }
  }
  const title = payload.title || "Monthly Budget";
  const n = payload.id || payload.notification_id || "";
  let url = payload.url || payload.link || "dashboard.html";
  if (!/^https?:/i.test(url)) url = withBase(url);
  if (n && url.indexOf("n=") === -1) {
    url += (url.indexOf("?") >= 0 ? "&" : "?") + "n=" + encodeURIComponent(n);
  }
  const opts = {
    body: payload.body || "",
    icon: payload.icon && /^https?:/i.test(payload.icon) ? payload.icon : withBase("icons/icon-192.png"),
    badge: payload.badge && /^https?:/i.test(payload.badge) ? payload.badge : withBase("icons/icon-192.png"),
    tag: payload.tag || (n ? "mb-" + n : "monthly-budget"),
    renotify: true,
    vibrate: payload.vibrate || [120, 60, 120],
    data: { url: url, id: n, receivedAt: Date.now() },
  };
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clients.forEach((c) => {
      try { c.postMessage({ type: "mb-push-received", payload: { title, body: opts.body, url, id: n } }); } catch (e) {}
    });
    await self.registration.showNotification(title, opts);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || withBase("dashboard.html");
  const abs = new URL(url, self.location.origin).href;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of list) {
      const same = client.url && new URL(client.url).origin === self.location.origin;
      if (same && "focus" in client) {
        await client.focus();
        try { client.navigate && await client.navigate(abs); } catch (e) {}
        try { client.postMessage({ type: "mb-open", url: abs }); } catch (e2) {}
        return;
      }
    }
    await self.clients.openWindow(abs);
  })());
});
