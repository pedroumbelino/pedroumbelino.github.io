// LevantaCAD: funciona sem rede. As páginas vêm da rede quando há ligação (para receber atualizações) e da cópia guardada quando não há.
const CACHE="levantacad-v3", FILES=["./","./index.html","./desktop.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./icon-192-maskable.png","./icon-512-maskable.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{const r=e.request; if(r.method!=="GET")return;
 if(r.mode==="navigate"){e.respondWith(fetch(r).then(res=>{const c=res.clone(); caches.open(CACHE).then(x=>x.put(r,c)); return res}).catch(()=>caches.match(r).then(m=>m||caches.match("./index.html")))); return}
 e.respondWith(caches.match(r).then(m=>m||fetch(r)))});
