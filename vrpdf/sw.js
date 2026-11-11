// VR PDF: funciona sem rede. A página vem da rede quando há ligação (para receber atualizações) e da cópia guardada quando não há.
const CACHE = "vrpdf-v1";
const CORE = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "./icon-192-maskable.png", "./icon-512-maskable.png", "./lib/pdf.min.mjs", "./lib/pdf.worker.min.mjs", "./lib/pdf-lib.min.js",
  "./lib/standard_fonts/LiberationSans-Regular.ttf", "./lib/standard_fonts/LiberationSans-Bold.ttf",
  "./lib/standard_fonts/FoxitSerif.pfb", "./lib/standard_fonts/FoxitFixed.pfb", "./lib/standard_fonts/FoxitSymbol.pfb",
  "./lib/standard_fonts/FoxitDingbats.pfb"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request; if (r.method !== "GET" || !r.url.startsWith(self.location.origin)) return;
  const fresh = r.mode === "navigate" || /\/(app\.js|index\.html)$/.test(new URL(r.url).pathname);
  if (fresh) { // rede primeiro (atualizações), cópia guardada sem rede
    e.respondWith(fetch(r).then((res) => { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); return res; })
      .catch(() => caches.match(r).then((m) => m || caches.match("./index.html")))); return;
  }
  // bibliotecas e tipos de letra: cópia guardada primeiro, e guarda o que vier da rede
  e.respondWith(caches.match(r).then((m) => m || fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)); } return res; })));
});
