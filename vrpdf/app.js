// VR PDF (versão web) — Ventura Rodrigues
// Visualização com pdf.js, desenho em SVG por cima das páginas, gravação final com pdf-lib.
// Coordenadas dos objetos: espaço "U" = pontos PDF da página sem rotação, origem no canto superior esquerdo.
import * as pdfjsLib from "./lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "./lib/pdf.worker.min.mjs";
const { PDFDocument, StandardFonts, rgb, degrees, LineCapStyle, BlendMode } = window.PDFLib;

const VERSION = "1.0.0";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PT = 96 / 72; // 100 % = tamanho real
const COLORS = ["#C8302B", "#E8742C", "#F2C200", "#1F7A4D", "#2563EB", "#7C3AED", "#111111", "#6B7280", "#FFFFFF"];
const MARK_COLORS = ["#FFE14D", "#7CE38B", "#7CC4FF", "#FF9AD5", "#FFB347"];
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ estado
const S = {
  name: "", bytes: null, pdf: null, pages: [], uids: [], objs: {}, images: {},
  zoom: 1, fit: "width", tool: "select", lastTool: null, sel: new Set(), undo: [], redo: [], dirty: false,
  cur: 0, pageSel: new Set(),
  style: { stroke: "#C8302B", width: 2, fill: null, opacity: 1, dash: false, textColor: "#111111", size: 12,
           bold: false, mark: "#FFE14D" },
  stamp: null, signature: null, imageSrc: null,
};

// ------------------------------------------------------------------ utilitários de interface
function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), ms);
}
function busy(on, text = "A processar…") { $("#busyText").textContent = text; $("#busy").classList.toggle("on", on); }
function cmd(html) { $("#cmdText").innerHTML = html; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function modal(html, onReady) {
  $("#dlg").innerHTML = html; $("#modal").classList.add("on");
  const close = () => $("#modal").classList.remove("on");
  $$("[data-close]", $("#dlg")).forEach((b) => b.addEventListener("click", close));
  onReady && onReady($("#dlg"), close);
  return close;
}
$("#modal").addEventListener("pointerdown", (e) => { if (e.target.id === "modal") $("#modal").classList.remove("on"); });
const pxpt = () => S.zoom * PT;

// ------------------------------------------------------------------ transformações U <-> V (vista sem zoom, já rodada)
function U2V(pg, x, y) {
  const { W, H, rot } = pg;
  switch (rot) {
    case 90: return [H - y, x];
    case 180: return [W - x, H - y];
    case 270: return [y, W - x];
    default: return [x, y];
  }
}
function V2U(pg, x, y) {
  const { W, H, rot } = pg;
  switch (rot) {
    case 90: return [y, H - x];
    case 180: return [W - x, H - y];
    case 270: return [W - y, x];
    default: return [x, y];
  }
}
const vdims = (pg) => (pg.rot % 180 ? [pg.H, pg.W] : [pg.W, pg.H]);

// ------------------------------------------------------------------ geometria dos objetos (em U)
const BOX = new Set(["rect", "ellipse", "cloud", "marker", "whiteout"]);
const CLOSED = new Set(["rect", "ellipse", "cloud"]);
function segs(o) {
  const s = [];
  if (o.t === "line" || o.t === "arrow") { s.push(["M", o.p1], ["L", o.p2]); }
  else if (o.t === "polyline") { o.pts.forEach((p, i) => s.push([i ? "L" : "M", p])); }
  else if (o.t === "ink") {
    const p = o.pts; s.push(["M", p[0]]);
    for (let i = 1; i < p.length - 1; i++) s.push(["Q", p[i], [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]]);
    if (p.length > 1) s.push(["L", p[p.length - 1]]);
  } else if (o.t === "rect" || o.t === "marker" || o.t === "whiteout") {
    const { x, y, w, h } = o; s.push(["M", [x, y]], ["L", [x + w, y]], ["L", [x + w, y + h]], ["L", [x, y + h]], ["Z"]);
  } else if (o.t === "ellipse") {
    const k = 0.5522847498, rx = o.w / 2, ry = o.h / 2, cx = o.x + rx, cy = o.y + ry;
    s.push(["M", [cx + rx, cy]],
      ["C", [cx + rx, cy + k * ry], [cx + k * rx, cy + ry], [cx, cy + ry]],
      ["C", [cx - k * rx, cy + ry], [cx - rx, cy + k * ry], [cx - rx, cy]],
      ["C", [cx - rx, cy - k * ry], [cx - k * rx, cy - ry], [cx, cy - ry]],
      ["C", [cx + k * rx, cy - ry], [cx + rx, cy - k * ry], [cx + rx, cy]], ["Z"]);
  } else if (o.t === "cloud") {
    const { x, y, w, h } = o, r = Math.max(5, Math.min(14, Math.min(w, h) / 4));
    const pts = [];
    const edge = (ax, ay, bx, by) => { const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / (2 * r))); for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n]); };
    edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
    pts.push(pts[0]);
    const cx = x + w / 2, cy = y + h / 2;
    s.push(["M", pts[0]]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let nx = mx - cx, ny = my - cy; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.75;
      s.push(["Q", [mx + nx * d, my + ny * d], b]);
    }
    s.push(["Z"]);
  }
  return s;
}
function arrowHead(o) {
  const [x1, y1] = o.p1, [x2, y2] = o.p2, L = Math.max(7, o.width * 4.5), ang = Math.atan2(y2 - y1, x2 - x1), sp = 0.42;
  return [["M", o.p2], ["L", [x2 - L * Math.cos(ang - sp), y2 - L * Math.sin(ang - sp)]],
          ["L", [x2 - L * Math.cos(ang + sp), y2 - L * Math.sin(ang + sp)]], ["Z"]];
}
function dOf(sg, map = (p) => p) {
  const f = (p) => { const q = map(p); return `${+q[0].toFixed(2)} ${+q[1].toFixed(2)}`; };
  return sg.map((c) => c[0] === "Z" ? "Z" : c[0] + c.slice(1).map(f).join(" ")).join(" ");
}
// caixa local de texto/imagem: âncora (canto sup. esq.), w, h, ângulo a (graus, sentido horário em U)
function boxCorners(o) {
  const a = (o.a || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), [x, y] = o.p;
  const P = (lx, ly) => [x + lx * c - ly * s, y + lx * s + ly * c];
  return [P(0, 0), P(o.w, 0), P(o.w, o.h), P(0, o.h)];
}
function ptsOf(o) {
  if (o.t === "line" || o.t === "arrow") return [o.p1, o.p2];
  if (o.t === "polyline" || o.t === "ink") return o.pts;
  if (BOX.has(o.t)) return [[o.x, o.y], [o.x + o.w, o.y + o.h]];
  return boxCorners(o);
}
function vbbox(pg, o) {
  const ps = ptsOf(o).map((p) => U2V(pg, p[0], p[1]));
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  const pad = o.t === "line" || o.t === "arrow" || o.t === "polyline" || o.t === "ink" ? (o.width || 1) / 2 + 2 : 0;
  return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
}
function translate(o, dx, dy) {
  const m = (p) => [p[0] + dx, p[1] + dy];
  if (o.p1) { o.p1 = m(o.p1); o.p2 = m(o.p2); }
  if (o.pts) o.pts = o.pts.map(m);
  if (BOX.has(o.t)) { o.x += dx; o.y += dy; }
  if (o.p) o.p = m(o.p);
}
const measureCtx = document.createElement("canvas").getContext("2d");
function textSize(o) {
  measureCtx.font = `${o.bold ? "bold " : ""}${o.size}px Helvetica, Arial, sans-serif`;
  const lines = o.text.split("\n");
  o.w = Math.max(10, ...lines.map((l) => measureCtx.measureText(l).width)) + 2;
  o.h = lines.length * o.size * 1.2;
}

// ------------------------------------------------------------------ abrir documentos
async function openFiles(files) {
  files = [...files];
  if (!files.length) return;
  if (S.dirty && !confirm("O documento atual tem alterações que ainda não guardaste em PDF. Abrir outro na mesma?")) return;
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const imgs = files.filter((f) => f.type.startsWith("image/"));
  busy(true, "A abrir…");
  try {
    let bytes, name;
    if (pdfs.length) {
      bytes = new Uint8Array(await pdfs[0].arrayBuffer()); name = pdfs[0].name.replace(/\.pdf$/i, "");
      if (pdfs.length > 1 || imgs.length) {
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const f of pdfs.slice(1)) await appendPdf(doc, new Uint8Array(await f.arrayBuffer()));
        for (const f of imgs) await appendImage(doc, f);
        bytes = await doc.save();
      }
    } else {
      const doc = await PDFDocument.create();
      for (const f of imgs) await appendImage(doc, f);
      bytes = await doc.save(); name = imgs.length === 1 ? imgs[0].name.replace(/\.[^.]+$/, "") : "Fotografias";
    }
    S.objs = {}; S.images = {}; S.undo = []; S.redo = []; S.sel.clear();
    await loadBytes(bytes, null);
    S.name = name; S.dirty = false; $("#docName").textContent = name;
    S.fit = "width"; fitZoom();
    $("#start").classList.add("hidden");
    setTool("select"); updateButtons(); autosave();
    toast(`${S.pages.length} página(s)`);
  } catch (e) {
    console.error(e); alert("Não foi possível abrir o ficheiro.\n\n" + (e.message || e));
  } finally { busy(false); }
}
async function appendPdf(doc, bytes, at = null) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const copied = await doc.copyPages(src, src.getPageIndices());
  copied.forEach((p, k) => (at == null ? doc.addPage(p) : doc.insertPage(at + k, p)));
  return copied.length;
}
async function imageToJpegBytes(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const max = 2400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height };
}
async function appendImage(doc, file, at = null) {
  const { bytes, w, h } = await imageToJpegBytes(file);
  const img = await doc.embedJpg(bytes);
  const land = w > h, PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89, m = 22;
  const k = Math.min((PW - 2 * m) / w, (PH - 2 * m) / h);
  const page = at == null ? doc.addPage([PW, PH]) : doc.insertPage(at, [PW, PH]);
  page.drawImage(img, { x: (PW - w * k) / 2, y: (PH - h * k) / 2, width: w * k, height: h * k });
}

async function loadBytes(bytes, uids) {
  S.bytes = bytes;
  if (S.pdf) { try { await S.pdf.destroy(); } catch {} }
  const task = pdfjsLib.getDocument({ data: bytes.slice(), cMapUrl: "./lib/cmaps/", cMapPacked: true,
    standardFontDataUrl: "./lib/standard_fonts/", isEvalSupported: false });
  task.onPassword = (cb, reason) => { const pw = prompt(reason === 2 ? "Palavra-passe incorreta. Tenta de novo:" : "Este PDF está protegido. Palavra-passe:"); if (pw == null) task.destroy(); else cb(pw); };
  S.pdf = await task.promise;
  S.pages = [];
  for (let i = 1; i <= S.pdf.numPages; i++) {
    const p = await S.pdf.getPage(i);
    const [x0, y0, x1, y1] = p.view;
    S.pages.push({ x0, y0, x1, y1, W: x1 - x0, H: y1 - y0, rot: ((p.rotate % 360) + 360) % 360, page: p });
  }
  S.uids = uids && uids.length === S.pages.length ? uids : S.pages.map(() => uid());
  S.uids.forEach((u) => (S.objs[u] = S.objs[u] || []));
  S.search = null;
  buildPages(); buildThumbs();
  $("#pageCount").textContent = S.pages.length;
}

// ------------------------------------------------------------------ páginas e renderização
let io = null;
function buildPages() {
  const root = $("#pages"); root.innerHTML = "";
  if (io) io.disconnect();
  io = new IntersectionObserver((ents) => ents.forEach((e) => { e.target._vis = e.isIntersecting; if (e.isIntersecting) queueRender(+e.target.dataset.i); }),
    { root: $("#viewer"), rootMargin: "800px 0px" });
  S.pages.forEach((pg, i) => {
    const d = document.createElement("div"); d.className = "page"; d.dataset.i = i;
    const [vw, vh] = vdims(pg);
    d.innerHTML = `<span class="pn">${i + 1}</span><canvas></canvas><svg class="ov" viewBox="0 0 ${vw} ${vh}" xmlns="http://www.w3.org/2000/svg"></svg>`;
    root.appendChild(d); io.observe(d);
  });
  layoutPages(); S.pages.forEach((_, i) => drawOverlay(i));
}
function layoutPages() {
  const k = pxpt();
  $$(".page").forEach((d) => { const pg = S.pages[+d.dataset.i]; const [vw, vh] = vdims(pg); d.style.width = vw * k + "px"; d.style.height = vh * k + "px"; });
  $("#zoomLab").textContent = Math.round(S.zoom * 100) + " %";
}
const renderQ = new Set(); let rendering = false;
function queueRender(i) { renderQ.add(i); pump(); }
async function pump() {
  if (rendering) return; rendering = true;
  while (renderQ.size) {
    const i = [...renderQ][0]; renderQ.delete(i);
    const d = $(`.page[data-i="${i}"]`); if (!d || !d._vis) continue;
    const pg = S.pages[i]; if (!pg) continue;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    let scale = pxpt() * dpr; const [vw, vh] = vdims(pg);
    const maxPix = 16e6; if (vw * vh * scale * scale > maxPix) scale = Math.sqrt(maxPix / (vw * vh));
    const key = scale.toFixed(3) + "|" + pg.rot;
    const cv = d.querySelector("canvas");
    if (cv._key === key) continue;
    const vp = pg.page.getViewport({ scale, rotation: pg.rot });
    const off = document.createElement("canvas"); off.width = Math.round(vp.width); off.height = Math.round(vp.height);
    try {
      await pg.page.render({ canvasContext: off.getContext("2d"), viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
      cv.width = off.width; cv.height = off.height; cv.getContext("2d").drawImage(off, 0, 0); cv._key = key;
    } catch (e) { console.warn(e); }
  }
  rendering = false;
}
function rerenderVisible() { $$(".page").forEach((d) => { if (d._vis) queueRender(+d.dataset.i); }); }

function setZoom(z, anchor) {
  const v = $("#viewer"); z = Math.max(0.15, Math.min(8, z));
  const ax = anchor ? anchor[0] : v.clientWidth / 2, ay = anchor ? anchor[1] : v.clientHeight / 2;
  const fx = (v.scrollLeft + ax) / Math.max(1, v.scrollWidth), fy = (v.scrollTop + ay) / Math.max(1, v.scrollHeight);
  S.zoom = z; layoutPages();
  v.scrollLeft = fx * v.scrollWidth - ax; v.scrollTop = fy * v.scrollHeight - ay;
  clearTimeout(setZoom._t); setZoom._t = setTimeout(rerenderVisible, 120);
  if (editing) placeEditor();
}
function fitZoom() {
  if (!S.pages.length) return;
  const v = $("#viewer"), maxW = Math.max(...S.pages.map((p) => vdims(p)[0]));
  const pg = S.pages[S.cur] || S.pages[0], [vw, vh] = vdims(pg);
  const zw = (v.clientWidth - 40) / (maxW * PT), zp = Math.min(zw, (v.clientHeight - 40) / (vh * PT));
  S.zoom = Math.max(0.15, S.fit === "page" ? zp : zw); layoutPages(); rerenderVisible();
}
function goPage(i, center) {
  const d = $(`.page[data-i="${i}"]`); if (!d) return;
  const v = $("#viewer");
  if (center) { v.scrollTop = d.offsetTop + center[1] * pxpt() - v.clientHeight / 2; v.scrollLeft = d.offsetLeft + center[0] * pxpt() - v.clientWidth / 2; }
  else v.scrollTop = d.offsetTop - 12;
}
$("#viewer").addEventListener("scroll", () => {
  const v = $("#viewer"), probe = v.scrollTop + Math.min(v.clientHeight * 0.35, 260);
  let cur = 0; for (const d of $$(".page")) { if (d.offsetTop + d.offsetHeight + 9 >= probe) { cur = +d.dataset.i; break; } cur = +d.dataset.i; }
  if (cur !== S.cur) { S.cur = cur; $("#pageNum").value = cur + 1; markThumbs(); }
}, { passive: true });
window.addEventListener("resize", () => { if (S.fit) fitZoom(); });

// ------------------------------------------------------------------ miniaturas
let tio = null;
function buildThumbs() {
  const box = $("#thumbs"); box.innerHTML = "";
  if (tio) tio.disconnect();
  tio = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting && !e.target._done) renderThumb(e.target); }), { root: box, rootMargin: "300px" });
  S.pages.forEach((pg, i) => {
    const t = document.createElement("div"); t.className = "thumb"; t.dataset.i = i; t.draggable = true;
    const [vw, vh] = vdims(pg), k = 120 / Math.max(vw, vh);
    t.innerHTML = `<canvas width="${Math.round(vw * k * 1.5)}" height="${Math.round(vh * k * 1.5)}" style="width:${vw * k}px;height:${vh * k}px"></canvas><span class="n">${i + 1}</span>`;
    t.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) S.pageSel.has(i) ? S.pageSel.delete(i) : S.pageSel.add(i);
      else if (e.shiftKey && S.pageSel.size) { const a = Math.min(...S.pageSel, i), b = Math.max(...S.pageSel, i); for (let k2 = a; k2 <= b; k2++) S.pageSel.add(k2); }
      else { S.pageSel = new Set([i]); goPage(i); }
      markThumbs();
    });
    t.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/vrpdf-page", String(i)); });
    t.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/vrpdf-page")) { e.preventDefault(); t.classList.add("dragover"); } });
    t.addEventListener("dragleave", () => t.classList.remove("dragover"));
    t.addEventListener("drop", (e) => { e.preventDefault(); t.classList.remove("dragover"); const from = +e.dataTransfer.getData("text/vrpdf-page"); if (from !== i) movePage(from, i); });
    box.appendChild(t); tio.observe(t);
  });
  markThumbs();
}
async function renderThumb(t) {
  t._done = true; const i = +t.dataset.i, pg = S.pages[i]; if (!pg) return;
  const c = t.querySelector("canvas"); const [vw] = vdims(pg);
  const vp = pg.page.getViewport({ scale: c.width / vw, rotation: pg.rot });
  try { await pg.page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; drawThumbObjs(t); } catch {}
}
function drawThumbObjs(t) {
  // desenha os objetos por cima da miniatura (versão simplificada via SVG em imagem)
  const i = +t.dataset.i, pg = S.pages[i]; if (!pg || !(S.objs[S.uids[i]] || []).length) return;
  const svg = $(`.page[data-i="${i}"] svg.ov`); if (!svg) return;
  const clone_ = svg.cloneNode(true); clone_.querySelectorAll(".selui,.search").forEach((n) => n.remove());
  const [vw, vh] = vdims(pg); clone_.setAttribute("width", vw); clone_.setAttribute("height", vh);
  const img = new Image(); const c = t.querySelector("canvas");
  img.onload = () => c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone_));
}
function refreshThumb(i) { const t = $(`.thumb[data-i="${i}"]`); if (t) { t._done = false; renderThumb(t); } }
function markThumbs() {
  $$(".thumb").forEach((t) => { const i = +t.dataset.i; t.classList.toggle("cur", i === S.cur); t.classList.toggle("sel", S.pageSel.has(i)); });
}
const selPages = () => (S.pageSel.size ? [...S.pageSel].sort((a, b) => a - b) : [S.cur]);

// ------------------------------------------------------------------ desenho dos objetos (SVG)
function styleAttrs(o) {
  const dash = o.dash ? ` stroke-dasharray="${o.width * 4} ${o.width * 3}"` : "";
  return `stroke="${o.stroke}" stroke-width="${o.width}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${o.opacity ?? 1}"${dash}`;
}
function objSVG(pg, o) {
  const map = (p) => U2V(pg, p[0], p[1]);
  const hitW = Math.max(10 / pxpt(), (o.width || 1) + 6 / pxpt());
  let body = "", hit = "";
  if (o.t === "marker") {
    body = `<path d="${dOf(segs(o), map)}" fill="${o.color}" fill-opacity="0.42" style="mix-blend-mode:multiply"/>`;
  } else if (o.t === "whiteout") {
    body = `<path d="${dOf(segs(o), map)}" fill="${o.fill || "#FFFFFF"}"/>`;
  } else if (o.t === "text") {
    const [ax, ay] = map(o.p), ang = (o.a || 0) + pg.rot;
    const lines = o.text.split("\n").map((l, k) => `<tspan x="${ax}" y="${ay + o.size * 0.8 + k * o.size * 1.2}">${esc(l) || " "}</tspan>`).join("");
    body = `<text transform="rotate(${ang} ${ax} ${ay})" font-family="Helvetica, Arial, sans-serif" font-size="${o.size}" font-weight="${o.bold ? 700 : 400}" fill="${o.color}" fill-opacity="${o.opacity ?? 1}" xml:space="preserve">${lines}</text>`;
    hit = `<rect transform="rotate(${ang} ${ax} ${ay})" x="${ax}" y="${ay}" width="${o.w}" height="${o.h}" fill="transparent"/>`;
  } else if (o.t === "image") {
    const [ax, ay] = map(o.p), ang = (o.a || 0) + pg.rot, src = S.images[o.img] || "";
    body = `<image transform="rotate(${ang} ${ax} ${ay})" x="${ax}" y="${ay}" width="${o.w}" height="${o.h}" href="${src}" preserveAspectRatio="none" opacity="${o.opacity ?? 1}"/>`;
  } else {
    const closed = CLOSED.has(o.t);
    const fill = closed && o.fill ? `fill="${o.fill}" fill-opacity="${Math.min(1, (o.opacity ?? 1))}"` : `fill="none"`;
    const d = dOf(segs(o), map);
    body = `<path d="${d}" ${fill} ${styleAttrs(o)}/>`;
    if (o.t === "arrow") body += `<path d="${dOf(arrowHead(o), map)}" fill="${o.stroke}" fill-opacity="${o.opacity ?? 1}" stroke="none"/>`;
    hit = `<path d="${d}" fill="${closed && o.fill ? "transparent" : "none"}" stroke="transparent" stroke-width="${hitW}"/>`;
  }
  return `<g data-id="${o.id}" class="obj" style="cursor:move">${body}${hit}</g>`;
}
function drawOverlay(i) {
  const svg = $(`.page[data-i="${i}"] svg.ov`); if (!svg) return;
  const pg = S.pages[i], list = S.objs[S.uids[i]] || [];
  let html = list.map((o) => objSVG(pg, o)).join("");
  // pesquisa
  if (S.search) S.search.hits.forEach((h, k) => { if (h.page !== i) return;
    const a = U2V(pg, h.x, h.y), b = U2V(pg, h.x + h.w, h.y + h.h);
    html += `<rect class="search" x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" fill="${k === S.search.i ? "#ff8c00" : "#ffd400"}" fill-opacity=".45" pointer-events="none"/>`; });
  // seleção
  const r = 5.5 / pxpt(), sw = 1.2 / pxpt();
  list.filter((o) => S.sel.has(o.id)).forEach((o) => {
    const b = vbbox(pg, o);
    html += `<g class="selui"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="#2563eb" stroke-width="${sw}" stroke-dasharray="${4 / pxpt()} ${3 / pxpt()}" pointer-events="none"/>`;
    if (S.sel.size === 1) handles(pg, o).forEach((h, k) => {
      html += `<circle data-h="${k}" data-id="${o.id}" cx="${h[0]}" cy="${h[1]}" r="${r}" fill="#fff" stroke="#2563eb" stroke-width="${sw * 1.5}" style="cursor:crosshair"/>`;
    });
    html += "</g>";
  });
  html += `<g class="preview"></g>`;
  svg.innerHTML = html;
}
function handles(pg, o) {
  if (o.t === "line" || o.t === "arrow") return [U2V(pg, ...o.p1), U2V(pg, ...o.p2)];
  if (BOX.has(o.t)) { const b = vbbox(pg, o); return [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]; }
  if (o.t === "text" || o.t === "image") { const c = boxCorners(o)[2]; return [U2V(pg, c[0], c[1])]; }
  return [];
}
function redrawAll() { S.pages.forEach((_, i) => drawOverlay(i)); }
function pageOfObj(id) { for (let i = 0; i < S.uids.length; i++) { const o = (S.objs[S.uids[i]] || []).find((x) => x.id === id); if (o) return [i, o]; } return [-1, null]; }

// ------------------------------------------------------------------ anular / refazer / gravação automática
function snapshot() { return { bytes: S.bytes, uids: S.uids.slice(), objs: JSON.stringify(S.objs) }; }
function pushUndo() { S.undo.push(snapshot()); if (S.undo.length > 60) S.undo.shift(); S.redo = []; S.dirty = true; updateButtons(); }
async function restore(sn) {
  const structural = sn.bytes !== S.bytes;
  S.objs = JSON.parse(sn.objs); S.sel.clear();
  if (structural) await loadBytes(sn.bytes, sn.uids); else { S.uids = sn.uids; redrawAll(); }
  S.uids.forEach((_, i) => refreshThumb(i));
  renderProps(); updateButtons(); autosave();
}
async function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); await restore(S.undo.pop()); S.dirty = true; toast("Anulado"); }
async function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); await restore(S.redo.pop()); S.dirty = true; }
function changed(pages) { (pages || []).forEach((i) => { drawOverlay(i); clearTimeout(changed["t" + i]); changed["t" + i] = setTimeout(() => refreshThumb(i), 400); }); S.dirty = true; updateButtons(); autosave(); }
function updateButtons() {
  const has = !!S.pdf;
  ["#bSave", "#bShare"].forEach((s) => ($(s).disabled = !has));
  $("#bUndo").disabled = !S.undo.length; $("#bRedo").disabled = !S.redo.length;
}

const DB = { db: null };
function idb() {
  if (DB.db) return Promise.resolve(DB.db);
  return new Promise((res, rej) => { const r = indexedDB.open("vrpdf", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(DB.db = r.result); r.onerror = () => rej(r.error); });
}
async function idbPut(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); } catch (e) { console.warn(e); } }
async function idbGet(k) { try { const db = await idb(); return await new Promise((res) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch { return null; } }
function autosave() {
  clearTimeout(autosave._t);
  autosave._t = setTimeout(async () => {
    if (!S.bytes) return;
    await idbPut("session", { name: S.name, bytes: S.bytes, uids: S.uids, objs: S.objs, images: S.images, dirty: S.dirty, ts: Date.now(), pages: S.pages.length });
    $("#saved").textContent = "Guardado neste dispositivo " + new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  }, 900);
}
async function resumeSession(s) {
  busy(true, "A recuperar…");
  try {
    S.objs = s.objs || {}; S.images = s.images || {}; S.undo = []; S.redo = []; S.sel.clear();
    await loadBytes(s.bytes, s.uids); S.name = s.name; S.dirty = !!s.dirty; $("#docName").textContent = s.name;
    $("#start").classList.add("hidden"); S.fit = "width"; fitZoom(); setTool("select"); updateButtons();
  } finally { busy(false); }
}

// ------------------------------------------------------------------ ferramentas
const IC = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const TOOLS = [
  { id: "select", k: "V", n: "Selecionar", i: IC('<path d="m4 3 7 17 2.5-7L21 10.5z"/>'), h: "Clica num objeto para o selecionar, arrasta para mover. Arrasta numa zona vazia para selecionar vários. <b>Delete</b> apaga." },
  { id: "hand", k: "H", n: "Mão", i: IC('<path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4L2.4 16a2 2 0 0 1 2.8-2.8L7 15"/>'), h: "Arrasta para mover a página. Com dois dedos também podes mover e fazer zoom." },
  "-",
  { id: "line", k: "L", n: "Linha", i: IC('<path d="M5 19 19 5"/>'), h: "<b>Linha:</b> arrasta, ou clica no primeiro e no segundo ponto. <b>Shift</b> = ortogonal/45°." },
  { id: "arrow", k: "A", n: "Seta", i: IC('<path d="M5 19 19 5M10 5h9v9"/>'), h: "<b>Seta:</b> do início para a ponta. <b>Shift</b> = ortogonal/45°." },
  { id: "polyline", k: "P", n: "Polilinha", i: IC('<path d="M3 18 9 8l6 7 6-10"/>'), h: "<b>Polilinha:</b> clica em cada vértice. <b>Enter</b> ou duplo clique termina, <b>Esc</b> cancela." },
  { id: "rect", k: "R", n: "Retângulo", i: IC('<rect x="4" y="6" width="16" height="12" rx="1"/>'), h: "<b>Retângulo:</b> arrasta de um canto ao oposto." },
  { id: "ellipse", k: "E", n: "Elipse / círculo", i: IC('<ellipse cx="12" cy="12" rx="9" ry="6.5"/>'), h: "<b>Elipse:</b> arrasta de um canto ao oposto. <b>Shift</b> = círculo a partir do centro." },
  { id: "cloud", k: "N", n: "Nuvem de revisão", i: IC('<path d="M7 18a4 4 0 0 1-.6-8 6 6 0 0 1 11.3-1.5A4.5 4.5 0 0 1 17.5 18z"/>'), h: "<b>Nuvem de revisão:</b> arrasta à volta da zona a assinalar." },
  { id: "ink", k: "F", n: "Desenho livre", i: IC('<path d="M3 17c3-6 5 4 8-2s4-7 6-3 2 5 4 3"/>'), h: "<b>Desenho livre:</b> desenha com o rato, a caneta ou o dedo." },
  "-",
  { id: "text", k: "T", n: "Texto", i: IC('<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'), h: "<b>Texto:</b> clica onde queres escrever. Clica fora (ou Ctrl+Enter) para aplicar. Duplo clique num texto para o editar." },
  { id: "marker", k: "M", n: "Marcador", i: IC('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'), h: "<b>Marcador:</b> arrasta sobre o texto a realçar." },
  { id: "whiteout", k: "W", n: "Tapar", i: IC('<path d="M20 20H9L4 15a2 2 0 0 1 0-2.8L13.2 3a2 2 0 0 1 2.8 0L21 8a2 2 0 0 1 0 2.8L12 20"/>'), h: "<b>Tapar:</b> arrasta para cobrir conteúdo com branco (ou outra cor de preenchimento)." },
  { id: "image", k: "I", n: "Imagem", i: IC('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'), h: "<b>Imagem:</b> clica (ou arrasta um retângulo) onde a imagem deve ficar." },
  { id: "stamp", k: "S", n: "Carimbo", i: IC('<path d="M5 21h14M6 17h12v-3a2 2 0 0 0-2-2h-2V8a2 2 0 1 0-4 0v4H8a2 2 0 0 0-2 2z"/>'), h: "<b>Carimbo:</b> clica onde o queres colocar." },
  { id: "signature", k: "G", n: "Assinatura", i: IC('<path d="M3 17c2.5 0 3-9 6-9s1 7 3.5 7S15 9 17 9s1 5 4 5"/><path d="M3 21h18"/>'), h: "<b>Assinatura:</b> clica ou arrasta um retângulo onde a assinatura deve ficar." },
];
function buildTools() {
  const nav = $("#tools"); nav.innerHTML = "";
  TOOLS.forEach((t) => {
    if (t === "-") { nav.insertAdjacentHTML("beforeend", '<div class="tsep"></div>'); return; }
    const b = document.createElement("button"); b.className = "tool"; b.dataset.tool = t.id; b.title = `${t.n} (${t.k})`;
    b.innerHTML = t.i + `<span class="k">${t.k}</span>`;
    b.addEventListener("click", () => setTool(t.id));
    nav.appendChild(b);
  });
}
async function setTool(id) {
  cancelDraw(); commitEditor();
  if (!S.pdf && id !== "select") { toast("Abre primeiro um PDF."); return; }
  if (id === "image") { const src = await pickImage(); if (!src) return; S.imageSrc = src; }
  if (id === "stamp") { const ok = await stampDialog(); if (!ok) return; }
  if (id === "signature") { const ok = await signatureDialog(); if (!ok) return; }
  if (!["select", "hand"].includes(id)) S.lastTool = id;
  S.tool = id;
  $$(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === id));
  const t = TOOLS.find((x) => x.id === id);
  cmd(t ? t.h + (id !== "select" ? " <b>Esc</b> termina o comando." : "") : "");
  $("#viewer").style.cursor = id === "hand" ? "grab" : id === "select" ? "default" : id === "text" ? "text" : "crosshair";
  if (id !== "select") { S.sel.clear(); redrawAll(); }
  renderProps();
}
function pickImage() {
  return new Promise((res) => {
    const inp = $("#fileImage"); inp.value = "";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return res(null);
      const id = await storeImage(f); res(id);
    };
    inp.click();
    setTimeout(() => { window.addEventListener("focus", function h() { window.removeEventListener("focus", h); setTimeout(() => { if (!inp.files.length) res(null); }, 600); }); }, 0);
  });
}
async function storeImage(fileOrUrl) {
  let url = fileOrUrl;
  if (typeof fileOrUrl !== "string") {
    const isPng = fileOrUrl.type === "image/png";
    const bmp = await createImageBitmap(fileOrUrl);
    const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL(isPng ? "image/png" : "image/jpeg", 0.88);
  }
  const id = uid(); S.images[id] = url; return id;
}
const imgSize = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.onerror = () => r([200, 100]); i.src = src; });

// ------------------------------------------------------------------ interação com o rato / dedo
let draw = null;      // desenho em curso
let drag = null;      // mover / redimensionar / selecionar por caixa
const pointers = new Map(); let gesture = null;

function evPage(e) {
  const d = e.target.closest ? e.target.closest(".page") : null;
  let el = d;
  if (!el) { // procurar a página mais próxima na vertical
    el = $$(".page").find((p) => { const r = p.getBoundingClientRect(); return e.clientY >= r.top - 9 && e.clientY <= r.bottom + 9; });
    if (!el) return null;
  }
  const r = el.getBoundingClientRect(), k = pxpt();
  const i = +el.dataset.i, pg = S.pages[i];
  const vx = (e.clientX - r.left) / k, vy = (e.clientY - r.top) / k;
  return { i, pg, v: [vx, vy], u: V2U(pg, vx, vy) };
}
function ortho(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [a[0] + L * Math.cos(ang), a[1] + L * Math.sin(ang)];
}
const viewer = $("#viewer");
viewer.addEventListener("pointerdown", onDown);
viewer.addEventListener("pointermove", onMove);
viewer.addEventListener("pointerup", onUp);
viewer.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); gesture = null; });
viewer.addEventListener("dblclick", onDbl);
viewer.addEventListener("wheel", (e) => {
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = viewer.getBoundingClientRect(); S.fit = null; setZoom(S.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), [e.clientX - r.left, e.clientY - r.top]); }
}, { passive: false });

function onDown(e) {
  if (!S.pdf || editingTarget(e)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2 && e.pointerType === "touch") {
    // gesto com dois dedos: cancela o desenho e passa a mover/zoom
    cancelDraw(); drag = null;
    const [a, b] = [...pointers.values()];
    gesture = { d: Math.hypot(a.x - b.x, a.y - b.y), z: S.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, sl: viewer.scrollLeft, st: viewer.scrollTop };
    return;
  }
  if (pointers.size > 1) return;
  if (e.button === 1 || S.tool === "hand") {
    drag = { pan: true, x: e.clientX, y: e.clientY, sl: viewer.scrollLeft, st: viewer.scrollTop }; viewer.setPointerCapture(e.pointerId); viewer.style.cursor = "grabbing"; return;
  }
  if (e.button !== 0) return;
  const P = evPage(e); if (!P) { if (S.tool === "select") { S.sel.clear(); redrawAll(); renderProps(); } return; }
  viewer.setPointerCapture(e.pointerId);
  const T = S.tool;
  if (T === "select") return selectDown(e, P);
  if (T === "text") { e.preventDefault(); return openEditor(P.i, P.u, null); }
  if (T === "polyline") {
    if (!draw) draw = { t: "polyline", i: P.i, pts: [P.u] };
    else if (draw.i === P.i) { let u = P.u; if (e.shiftKey) u = V2U(P.pg, ...ortho(U2V(P.pg, ...draw.pts[draw.pts.length - 1]), P.v)); draw.pts.push(u); }
    preview(); return;
  }
  if (draw && draw.click && draw.i === P.i) { finishDraw(P, e); return; }
  draw = { t: T, i: P.i, a: P.u, av: P.v, b: P.u, bv: P.v, moved: false, pts: [P.u], down: true };
  if (T === "stamp" || T === "image" || T === "signature") { draw.place = true; }
  preview();
}
function onMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture && pointers.size >= 2) {
    const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const r = viewer.getBoundingClientRect(); S.fit = null;
    const nz = Math.max(0.15, Math.min(8, gesture.z * d / gesture.d));
    if (Math.abs(nz - S.zoom) > 0.01) setZoom(nz, [cx - r.left, cy - r.top]);
    viewer.scrollLeft -= cx - gesture.cx; viewer.scrollTop -= cy - gesture.cy; gesture.cx = cx; gesture.cy = cy;
    return;
  }
  if (drag && drag.pan) { viewer.scrollLeft = drag.sl - (e.clientX - drag.x); viewer.scrollTop = drag.st - (e.clientY - drag.y); return; }
  if (drag) return selectMove(e);
  if (!draw) return;
  const P = evPage(e); if (!P || P.i !== draw.i) { if (draw.t === "polyline") return; }
  const pg = S.pages[draw.i], r = $(`.page[data-i="${draw.i}"]`).getBoundingClientRect(), k = pxpt();
  let v = [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  const [vw, vh] = vdims(pg); v = [Math.max(0, Math.min(vw, v[0])), Math.max(0, Math.min(vh, v[1]))];
  if (draw.t === "polyline") {
    let vv = v; if (e.shiftKey) vv = ortho(U2V(pg, ...draw.pts[draw.pts.length - 1]), v);
    draw.cursor = V2U(pg, ...vv); preview(); return;
  }
  if ((draw.t === "line" || draw.t === "arrow") && e.shiftKey) v = ortho(draw.av, v);
  draw.bv = v; draw.b = V2U(pg, ...v); draw.shift = e.shiftKey;
  if (Math.hypot(v[0] - draw.av[0], v[1] - draw.av[1]) * k > 4) draw.moved = true;
  if (draw.t === "ink" && draw.down) draw.pts.push(draw.b);
  preview();
}
function onUp(e) {
  pointers.delete(e.pointerId);
  if (gesture) { if (pointers.size < 2) gesture = null; return; }
  if (drag && drag.pan) { drag = null; viewer.style.cursor = S.tool === "hand" ? "grab" : ""; return; }
  if (drag) return selectUp(e);
  if (!draw || draw.t === "polyline") return;
  draw.down = false;
  if (draw.place && !draw.moved) { finishDraw(null, e); return; }
  if (!draw.moved) {
    if (draw.t === "ink") { cancelDraw(); return; }
    draw.click = true; cmd("Clica no segundo ponto. <b>Esc</b> cancela."); return; // modo clique-clique
  }
  finishDraw(null, e);
}
function onDbl(e) {
  if (S.tool === "polyline" && draw) { e.preventDefault(); draw.pts.pop(); finishPolyline(); return; }
  if (S.tool !== "select") return;
  const g = e.target.closest(".obj"); if (!g) return;
  const [i, o] = pageOfObj(g.dataset.id);
  if (o && o.t === "text") openEditor(i, o.p, o);
}
function editingTarget(e) { return e.target.tagName === "TEXTAREA"; }

function preview() {
  if (!draw) return;
  const pg = S.pages[draw.i], g = $(`.page[data-i="${draw.i}"] svg.ov .preview`); if (!g) return;
  const st = S.style, o = makeObj(true); if (!o) { g.innerHTML = ""; return; }
  g.innerHTML = objSVG(pg, o).replace('class="obj"', 'class="pv"');
}
function makeObj(isPreview) {
  const st = S.style, d = draw, t = d.t;
  const base = { id: uid(), t, stroke: st.stroke, width: st.width, opacity: st.opacity, dash: st.dash };
  if (t === "line" || t === "arrow") return { ...base, p1: d.a, p2: d.b };
  if (t === "polyline") { const pts = d.cursor && isPreview ? [...d.pts, d.cursor] : d.pts; return pts.length > 1 ? { ...base, pts } : null; }
  if (t === "ink") return d.pts.length > 1 ? { ...base, pts: d.pts.slice() } : null;
  if (BOX.has(t)) {
    let [x1, y1] = d.a, [x2, y2] = d.b;
    if (t === "ellipse" && d.shift) { const r = Math.hypot(x2 - x1, y2 - y1); x2 = x1 + r; y2 = y1 + r; x1 -= r; y1 -= r; }
    const o = { ...base, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    if (CLOSED.has(t)) o.fill = st.fill;
    if (t === "marker") { o.color = st.mark; }
    if (t === "whiteout") { o.fill = st.fill || "#FFFFFF"; }
    return o;
  }
  if (t === "image" || t === "stamp" || t === "signature") {
    if (isPreview && !d.moved) return null;
    const pg = S.pages[d.i];
    const [x1, y1] = d.av, [x2, y2] = d.bv;
    const p = V2U(pg, Math.min(x1, x2), Math.min(y1, y2));
    return { id: uid(), t: "image", img: null, p, w: Math.abs(x2 - x1) || 1, h: Math.abs(y2 - y1) || 1, a: -pg.rot, opacity: 1, rect: true };
  }
  return null;
}
async function finishDraw(P, e) {
  const d = draw; if (!d) return;
  if (P && d.click) { d.bv = (d.t === "line" || d.t === "arrow") && e.shiftKey ? ortho(d.av, P.v) : P.v; d.b = V2U(S.pages[d.i], ...d.bv); d.moved = true; }
  let o = makeObj(false);
  const i = d.i, pg = S.pages[i];
  if (d.t === "image" || d.t === "stamp" || d.t === "signature") {
    const imgId = d.t === "image" ? S.imageSrc : d.t === "stamp" ? S.stamp : S.signature;
    const [nw, nh] = await imgSize(S.images[imgId]);
    const ratio = nh / nw;
    if (!d.moved) {
      const w = d.t === "stamp" ? 150 : d.t === "signature" ? 150 : Math.min(220, nw * 0.75);
      const h = w * ratio;
      const v = [d.av[0] - w / 2, d.av[1] - h / 2];
      o = { id: uid(), t: "image", img: imgId, p: V2U(pg, ...v), w, h, a: -pg.rot, opacity: 1 };
    } else {
      // encaixa a imagem no retângulo desenhado mantendo a proporção
      let w = o.w, h = w * ratio; if (h > o.h) { h = o.h; w = h / ratio; }
      o.w = w; o.h = h; o.img = imgId; delete o.rect;
    }
  }
  draw = null;
  if (!o || (BOX.has(o.t) && (o.w < 1 || o.h < 1))) { drawOverlay(i); return; }
  pushUndo(); S.objs[S.uids[i]].push(o); changed([i]);
  setTool(S.tool); // mantém o comando ativo (como no CAD)
}
function finishPolyline() {
  const d = draw; if (!d) return;
  draw = null; d.cursor = null; const o = { id: uid(), t: "polyline", pts: d.pts, stroke: S.style.stroke, width: S.style.width, opacity: S.style.opacity, dash: S.style.dash };
  if (o.pts.length < 2) { drawOverlay(d.i); return; }
  pushUndo(); S.objs[S.uids[d.i]].push(o); changed([d.i]);
}
function cancelDraw() { if (draw) { const i = draw.i; draw = null; drawOverlay(i); const t = TOOLS.find((x) => x.id === S.tool); t && cmd(t.h); } }

// ----- seleção, mover e redimensionar
function selectDown(e, P) {
  const h = e.target.closest("[data-h]"), g = e.target.closest(".obj");
  if (h) { const [i, o] = pageOfObj(h.dataset.id); drag = { mode: "handle", i, id: o.id, k: +h.dataset.h, orig: clone(o), start: P.v, pushed: false }; return; }
  if (g) {
    const id = g.dataset.id;
    if (e.shiftKey || e.ctrlKey) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); }
    else if (!S.sel.has(id)) { S.sel = new Set([id]); }
    drag = { mode: "move", i: P.i, start: P.v, last: P.v, pushed: false };
    redrawAll(); renderProps(); return;
  }
  if (!e.shiftKey) S.sel.clear();
  drag = { mode: "box", i: P.i, start: P.v, end: P.v };
  redrawAll(); renderProps();
}
function selectMove(e) {
  const pg = S.pages[drag.i], r = $(`.page[data-i="${drag.i}"]`).getBoundingClientRect(), k = pxpt();
  let v = [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
  if (drag.mode === "box") {
    drag.end = v; const g = $(`.page[data-i="${drag.i}"] svg.ov .preview`);
    const x = Math.min(drag.start[0], v[0]), y = Math.min(drag.start[1], v[1]);
    g.innerHTML = `<rect x="${x}" y="${y}" width="${Math.abs(v[0] - drag.start[0])}" height="${Math.abs(v[1] - drag.start[1])}" fill="#2563eb" fill-opacity=".08" stroke="#2563eb" stroke-width="${1 / k}" stroke-dasharray="${4 / k}"/>`;
    return;
  }
  if (!drag.pushed) { if (Math.hypot(v[0] - drag.start[0], v[1] - drag.start[1]) * k < 3) return; pushUndo(); drag.pushed = true; }
  if (drag.mode === "move") {
    const a = V2U(pg, ...drag.last), b = V2U(pg, ...v);
    (S.objs[S.uids[drag.i]] || []).filter((o) => S.sel.has(o.id)).forEach((o) => translate(o, b[0] - a[0], b[1] - a[1]));
    drag.last = v; drawOverlay(drag.i); return;
  }
  if (drag.mode === "handle") {
    const o = (S.objs[S.uids[drag.i]] || []).find((x) => x.id === drag.id); if (!o) return;
    const O = drag.orig;
    if (o.t === "line" || o.t === "arrow") {
      const other = U2V(pg, ...(drag.k === 0 ? O.p2 : O.p1)); if (e.shiftKey) v = ortho(other, v);
      o[drag.k === 0 ? "p1" : "p2"] = V2U(pg, ...v);
    } else if (BOX.has(o.t)) {
      const b = vbbox(pg, O), corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      const fixed = corners[(drag.k + 2) % 4], A = V2U(pg, ...fixed), B = V2U(pg, ...v);
      o.x = Math.min(A[0], B[0]); o.y = Math.min(A[1], B[1]); o.w = Math.abs(B[0] - A[0]); o.h = Math.abs(B[1] - A[1]);
    } else if (o.t === "text" || o.t === "image") {
      const U = V2U(pg, ...v), a = (O.a || 0) * Math.PI / 180, dx = U[0] - O.p[0], dy = U[1] - O.p[1];
      const lx = dx * Math.cos(a) + dy * Math.sin(a), ly = -dx * Math.sin(a) + dy * Math.cos(a);
      if (o.t === "image") { const s = Math.max(0.05, Math.max(lx / O.w, ly / O.h)); o.w = O.w * s; o.h = O.h * s; }
      else { const s = Math.max(0.2, ly / O.h); o.size = Math.max(4, Math.round(O.size * s * 10) / 10); textSize(o); }
    }
    drawOverlay(drag.i);
  }
}
function selectUp() {
  const d = drag; drag = null;
  if (d.mode === "box") {
    const pg = S.pages[d.i], x = Math.min(d.start[0], d.end[0]), y = Math.min(d.start[1], d.end[1]), w = Math.abs(d.end[0] - d.start[0]), h = Math.abs(d.end[1] - d.start[1]);
    if (w * pxpt() > 4 || h * pxpt() > 4) (S.objs[S.uids[d.i]] || []).forEach((o) => { const b = vbbox(pg, o); if (b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y) S.sel.add(o.id); });
    drawOverlay(d.i); renderProps(); return;
  }
  if (d.pushed) changed([d.i]); else drawOverlay(d.i);
  renderProps();
}
function selected() { const r = []; S.uids.forEach((u, i) => (S.objs[u] || []).forEach((o) => S.sel.has(o.id) && r.push([i, o]))); return r; }
function deleteSel() {
  const s = selected(); if (!s.length) return; pushUndo();
  const pages = new Set(s.map((x) => x[0]));
  pages.forEach((i) => (S.objs[S.uids[i]] = S.objs[S.uids[i]].filter((o) => !S.sel.has(o.id))));
  S.sel.clear(); changed([...pages]); renderProps();
}
function duplicateSel() {
  const s = selected(); if (!s.length) return; pushUndo(); S.sel.clear();
  const pages = new Set();
  s.forEach(([i, o]) => { const c = clone(o); c.id = uid(); translate(c, 10, 10); S.objs[S.uids[i]].push(c); S.sel.add(c.id); pages.add(i); });
  changed([...pages]); renderProps();
}
function reorderSel(front) {
  const s = selected(); if (!s.length) return; pushUndo(); const pages = new Set(s.map((x) => x[0]));
  pages.forEach((i) => { const L = S.objs[S.uids[i]], a = L.filter((o) => S.sel.has(o.id)), b = L.filter((o) => !S.sel.has(o.id)); S.objs[S.uids[i]] = front ? [...b, ...a] : [...a, ...b]; });
  changed([...pages]);
}
function nudge(dx, dy) {
  const s = selected(); if (!s.length) return; pushUndo(); const pages = new Set();
  s.forEach(([i, o]) => { const pg = S.pages[i], a = V2U(pg, 0, 0), b = V2U(pg, dx, dy); translate(o, b[0] - a[0], b[1] - a[1]); pages.add(i); });
  changed([...pages]);
}

// ----- editor de texto
let editing = null;
function openEditor(i, pU, obj) {
  commitEditor();
  const page = $(`.page[data-i="${i}"]`), ta = document.createElement("textarea"); ta.className = "edit";
  const st = S.style;
  editing = { i, p: pU, obj, ta, size: obj ? obj.size : st.size, color: obj ? obj.color : st.textColor, bold: obj ? obj.bold : st.bold };
  ta.value = obj ? obj.text : "";
  ta.placeholder = "Escreve aqui";
  page.appendChild(ta); placeEditor();
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); cancelEditor(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEditor(); }
    e.stopPropagation();
  });
  ta.addEventListener("pointerdown", (e) => e.stopPropagation());
  ta.addEventListener("blur", () => setTimeout(commitEditor, 0));
  if (obj) { S.sel.clear(); obj._hidden = true; const L = S.objs[S.uids[i]]; editing.idx = L.indexOf(obj); drawOverlay(i); $(`.page[data-i="${i}"] [data-id="${obj.id}"]`)?.remove(); }
  setTimeout(() => ta.focus(), 0);
  cmd("<b>Texto:</b> escreve e clica fora para aplicar. <b>Ctrl+Enter</b> aplica, <b>Esc</b> cancela.");
}
function placeEditor() {
  if (!editing) return;
  const pg = S.pages[editing.i], [vx, vy] = U2V(pg, ...editing.p), k = pxpt(), ta = editing.ta;
  ta.style.left = vx * k - 4 + "px"; ta.style.top = vy * k - 4 + "px";
  ta.style.fontSize = editing.size * k + "px"; ta.style.color = editing.color; ta.style.fontWeight = editing.bold ? "700" : "400";
  const lines = (ta.value || "x").split("\n");
  measureCtx.font = `${editing.bold ? "bold " : ""}${editing.size * k}px Helvetica, Arial`;
  ta.style.width = Math.max(120, Math.max(...lines.map((l) => measureCtx.measureText(l).width)) + 40) + "px";
  ta.style.height = Math.max(editing.size * k * 1.2 * lines.length + 14, 30) + "px";
  ta.oninput = placeEditor;
}
function commitEditor() {
  if (!editing) return;
  const ed = editing; editing = null; const text = ed.ta.value.replace(/\s+$/, ""); ed.ta.remove();
  const L = S.objs[S.uids[ed.i]];
  if (ed.obj) {
    delete ed.obj._hidden;
    if (text !== ed.obj.text) { pushUndo(); if (!text) S.objs[S.uids[ed.i]] = L.filter((o) => o !== ed.obj); else { ed.obj.text = text; textSize(ed.obj); } changed([ed.i]); }
    else drawOverlay(ed.i);
  } else if (text) {
    const pg = S.pages[ed.i];
    const o = { id: uid(), t: "text", p: ed.p, text, size: ed.size, color: ed.color, bold: ed.bold, a: -pg.rot, opacity: 1 };
    textSize(o); pushUndo(); L.push(o); changed([ed.i]);
  }
  const t = TOOLS.find((x) => x.id === S.tool); t && cmd(t.h);
}
function cancelEditor() { if (!editing) return; const ed = editing; editing = null; ed.ta.remove(); if (ed.obj) delete ed.obj._hidden; drawOverlay(ed.i); }

// ------------------------------------------------------------------ painel de propriedades
let propsPushed = false;
function renderProps() {
  const P = $("#props"); propsPushed = false;
  const sel = selected().map((x) => x[1]);
  const T = S.tool, st = S.style;
  const ref = sel[0] || null;
  const types = new Set(sel.map((o) => o.t));
  const showStroke = sel.length ? [...types].some((t) => !["text", "image", "marker", "whiteout"].includes(t)) : !["text", "marker", "whiteout", "image", "stamp", "signature", "select", "hand"].includes(T);
  const showFill = sel.length ? [...types].some((t) => CLOSED.has(t) || t === "whiteout") : ["rect", "ellipse", "cloud", "whiteout"].includes(T);
  const showText = sel.length ? types.has("text") : T === "text";
  const showMark = sel.length ? types.has("marker") : T === "marker";
  const v = (k, def) => (ref && ref[k] !== undefined ? ref[k] : def);
  const stroke = v("stroke", st.stroke), width = v("width", st.width), fill = ref ? (ref.t === "whiteout" ? ref.fill : ref.fill ?? null) : (T === "whiteout" ? (st.fill || "#FFFFFF") : st.fill);
  const op = v("opacity", st.opacity), dash = v("dash", st.dash), tcol = ref && ref.t === "text" ? ref.color : st.textColor;
  const size = ref && ref.t === "text" ? ref.size : st.size, bold = ref && ref.t === "text" ? ref.bold : st.bold, mark = ref && ref.t === "marker" ? ref.color : st.mark;
  const sw = (list, cur, key, none) => `<div class="swatches">${none ? `<button class="sw none ${cur == null ? "on" : ""}" data-k="${key}" data-v="" title="Sem preenchimento"></button>` : ""}${list.map((c) => `<button class="sw ${String(cur).toUpperCase() === c.toUpperCase() ? "on" : ""}" data-k="${key}" data-v="${c}" style="background:${c}" title="${c}"></button>`).join("")}<input type="color" data-k="${key}" value="${cur || "#ffffff"}" title="Outra cor"></div>`;
  let h = "";
  const title = sel.length ? (sel.length > 1 ? `${sel.length} objetos` : ({ line: "Linha", arrow: "Seta", polyline: "Polilinha", rect: "Retângulo", ellipse: "Elipse", cloud: "Nuvem", ink: "Desenho", text: "Texto", marker: "Marcador", whiteout: "Tapar", image: "Imagem" }[ref.t])) : (TOOLS.find((t) => t.id === T)?.n || "");
  h += `<h3>${esc(title)}</h3>`;
  if (!S.pdf) h += `<p class="hint">Abre um PDF para começar.</p>`;
  if (showStroke) h += `<label class="hint">Cor da linha</label>${sw(COLORS, stroke, "stroke")}
    <div class="row"><label>Espessura</label><input type="range" min="0.25" max="12" step="0.25" value="${width}" data-k="width"><span id="wLab">${width} pt</span></div>
    <label class="chk"><input type="checkbox" data-k="dash" ${dash ? "checked" : ""}> Tracejado</label>`;
  if (showFill) h += `<label class="hint">Preenchimento</label>${sw(COLORS, fill, "fill", !(ref ? ref.t === "whiteout" : T === "whiteout"))}`;
  if (showMark) h += `<label class="hint">Cor do marcador</label>${sw(MARK_COLORS, mark, "mark")}`;
  if (showText) h += `<label class="hint">Cor do texto</label>${sw(COLORS, tcol, "textColor")}
    <div class="row"><label>Tamanho</label><input class="inp" type="number" min="4" max="200" step="1" value="${size}" data-k="size" style="width:70px"></div>
    <label class="chk"><input type="checkbox" data-k="bold" ${bold ? "checked" : ""}> Negrito</label>`;
  if (showStroke || showFill || showText || (sel.length && types.has("image")))
    h += `<div class="row"><label>Opacidade</label><input type="range" min="0.1" max="1" step="0.05" value="${op}" data-k="opacity"></div>`;
  if (sel.length) h += `<div class="btnrow"><button class="btn" data-a="dup">Duplicar</button><button class="btn" data-a="front">À frente</button><button class="btn" data-a="back">Atrás</button><button class="btn danger" data-a="del">Apagar</button></div>
    ${sel.length === 1 && ref.t === "text" ? `<button class="btn" data-a="edit">Editar texto</button>` : ""}`;
  else if (T === "select" && S.pdf) h += `<p class="hint">Escolhe uma ferramenta à esquerda. As opções aparecem aqui e ficam para os próximos objetos.</p><p class="hint"><b>Espaço</b> repete o último comando. <b>Esc</b> termina. <b>Shift</b> deixa as linhas a 0°, 45° ou 90°.</p>`;
  else if (T === "stamp" || T === "signature" || T === "image") h += `<button class="btn" data-a="rechoose">Escolher outra…</button>`;
  P.innerHTML = h;
  P.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k;
    const val = () => (el.type === "checkbox" ? el.checked : el.classList.contains("sw") ? (el.dataset.v || null) : el.type === "range" || el.type === "number" ? +el.value : el.value);
    const ev = el.classList.contains("sw") ? "click" : el.type === "range" ? "input" : "change";
    el.addEventListener(ev, () => { applyProp(k, val()); if (el.classList.contains("sw") || el.type === "color" || el.type === "checkbox") renderProps(); if (k === "width") $("#wLab").textContent = val() + " pt"; });
  });
  P.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.a;
    if (a === "del") deleteSel(); else if (a === "dup") duplicateSel(); else if (a === "front") reorderSel(true); else if (a === "back") reorderSel(false);
    else if (a === "edit") { const [i, o] = selected()[0]; openEditor(i, o.p, o); }
    else if (a === "rechoose") setTool(T);
  }));
}
function applyProp(k, val) {
  const map = { textColor: "color", mark: "color" };
  const sel = selected();
  if (sel.length) {
    if (!propsPushed) { pushUndo(); propsPushed = true; }
    const pages = new Set();
    sel.forEach(([i, o]) => {
      const key = map[k] || k;
      if (k === "textColor" && o.t !== "text") return; if (k === "mark" && o.t !== "marker") return;
      if ((k === "size" || k === "bold") && o.t !== "text") return;
      if (k === "fill" && !(CLOSED.has(o.t) || o.t === "whiteout")) return;
      if (k === "fill" && o.t === "whiteout" && !val) return;
      if (["stroke", "width", "dash"].includes(k) && ["text", "image", "marker", "whiteout"].includes(o.t)) return;
      o[key] = val; if (o.t === "text") textSize(o); pages.add(i);
    });
    changed([...pages]);
  }
  if (k in S.style) S.style[k] = val;
  try { localStorage.setItem("vrpdf-style", JSON.stringify(S.style)); } catch {}
}

// ------------------------------------------------------------------ carimbos e assinaturas
function stampPNG(text, color, sub) {
  const s = 3, c = document.createElement("canvas"), x = c.getContext("2d");
  const f1 = `bold ${26 * s}px Helvetica, Arial, sans-serif`, f2 = `${11 * s}px Helvetica, Arial, sans-serif`;
  x.font = f1; const w1 = x.measureText(text).width; x.font = f2; const w2 = sub ? x.measureText(sub).width : 0;
  const pad = 14 * s; c.width = Math.ceil(Math.max(w1, w2) + 2 * pad); c.height = Math.ceil(26 * s * 1.25 + (sub ? 11 * s * 1.6 : 0) + pad * 1.6);
  x.strokeStyle = color; x.fillStyle = color; x.globalAlpha = 0.92;
  const rr = (o, rad, lw) => { x.lineWidth = lw; x.beginPath(); x.roundRect(o, o, c.width - 2 * o, c.height - 2 * o, rad); x.stroke(); };
  rr(2 * s, 8 * s, 3 * s); rr(6 * s, 6 * s, 1 * s);
  x.textBaseline = "top"; x.font = f1; x.fillText(text, (c.width - w1) / 2, pad * 0.8);
  if (sub) { x.font = f2; x.fillText(sub, (c.width - w2) / 2, pad * 0.8 + 26 * s * 1.25); }
  return c.toDataURL("image/png");
}
const STAMPS = { "APROVADO": "#1F7A4D", "REVISTO": "#2F4FA8", "PARA EXECUÇÃO": "#1F7A4D", "PARA APROVAÇÃO": "#8A5A00", "NÃO APROVADO": "#C8302B", "CONFIDENCIAL": "#C8302B", "RASCUNHO": "#6B6B6B", "CÓPIA": "#6B6B6B" };
function stampDialog() {
  return new Promise((res) => {
    const prev = JSON.parse(localStorage.getItem("vrpdf-stamp") || "{}");
    const today = new Date().toLocaleDateString("pt-PT");
    modal(`<h2>Carimbo</h2>
      <div class="grid2"><label>Texto</label><input class="inp" id="stT" list="stL" value="${esc(prev.t || "APROVADO")}"><datalist id="stL">${Object.keys(STAMPS).map((k) => `<option value="${k}">`).join("")}</datalist>
      <label>Linha de baixo</label><input class="inp" id="stS" value="${esc(prev.s ?? ("Ventura Rodrigues  " + today))}">
      <label>Cor</label><input type="color" id="stC" value="${prev.c || "#1F7A4D"}"></div>
      <div style="text-align:center;background:#fff;border-radius:8px;padding:10px"><img id="stP" style="max-width:100%;height:80px;object-fit:contain"></div>
      <p class="hint">Depois clica na página onde o queres colocar (ou arrasta para escolher o tamanho).</p>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="stOk">Usar este carimbo</button></div>`, (d, close) => {
      const upd = () => { $("#stP").src = stampPNG($("#stT").value || " ", $("#stC").value, $("#stS").value); };
      $("#stT").addEventListener("input", () => { const c = STAMPS[$("#stT").value.toUpperCase()]; if (c) $("#stC").value = c; upd(); });
      $("#stS").addEventListener("input", upd); $("#stC").addEventListener("input", upd); upd();
      $("#stOk").addEventListener("click", () => {
        const p = { t: $("#stT").value, s: $("#stS").value, c: $("#stC").value }; localStorage.setItem("vrpdf-stamp", JSON.stringify(p));
        const id = uid(); S.images[id] = stampPNG(p.t || " ", p.c, p.s); S.stamp = id; close(); res(true);
      });
      $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => res(false)));
    });
  });
}
function sigs() { try { return JSON.parse(localStorage.getItem("vrpdf-sigs") || "[]"); } catch { return []; } }
function signatureDialog() {
  return new Promise((res) => {
    let chosen = sigs().length ? 0 : -1;
    modal(`<h2>Assinatura</h2>
      <div class="siglist" id="sgL"></div>
      <p class="hint">Desenha uma nova assinatura com o rato, a caneta ou o dedo:</p>
      <canvas class="pad" id="sgPad"></canvas>
      <div class="btnrow"><button class="btn" id="sgClear">Limpar</button><button class="btn" id="sgSave">Guardar esta assinatura</button><button class="btn" id="sgImg">Carregar imagem…</button></div>
      <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="sgOk">Usar a selecionada</button></div>`, (d, close) => {
      const list = () => { const L = sigs(); $("#sgL").innerHTML = L.length ? L.map((s, k) => `<div class="s ${k === chosen ? "on" : ""}" data-k="${k}"><img src="${s}"><button class="x" data-del="${k}" title="Apagar">×</button></div>`).join("") : '<span class="hint">Ainda não tens assinaturas guardadas.</span>';
        $$("#sgL .s").forEach((el) => el.addEventListener("click", (e) => { if (e.target.dataset.del) { const L2 = sigs(); L2.splice(+e.target.dataset.del, 1); localStorage.setItem("vrpdf-sigs", JSON.stringify(L2)); chosen = L2.length ? 0 : -1; list(); return; } chosen = +el.dataset.k; list(); })); };
      list();
      const c = $("#sgPad"), x = c.getContext("2d"); let strokes = [], cur = null;
      const fit = () => { const r = c.getBoundingClientRect(); c.width = r.width * 2; c.height = r.height * 2; x.setTransform(2, 0, 0, 2, 0, 0); redraw(); };
      const redraw = () => { x.clearRect(0, 0, c.width, c.height); x.strokeStyle = "#141e5a"; x.lineWidth = 2.6; x.lineCap = x.lineJoin = "round"; strokes.forEach((s) => { x.beginPath(); s.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.stroke(); }); };
      setTimeout(fit, 30);
      const pt = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      c.addEventListener("pointerdown", (e) => { c.setPointerCapture(e.pointerId); cur = [pt(e)]; strokes.push(cur); });
      c.addEventListener("pointermove", (e) => { if (cur) { cur.push(pt(e)); redraw(); } });
      c.addEventListener("pointerup", () => (cur = null));
      $("#sgClear").addEventListener("click", () => { strokes = []; redraw(); });
      const saveData = (url) => { const L = sigs(); L.unshift(url); localStorage.setItem("vrpdf-sigs", JSON.stringify(L.slice(0, 8))); chosen = 0; list(); };
      $("#sgSave").addEventListener("click", () => {
        const all = strokes.flat(); if (all.length < 2) { toast("Desenha a assinatura na área branca."); return; }
        const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]), m = 6, k = 3;
        const o = document.createElement("canvas"); o.width = (Math.max(...xs) - Math.min(...xs) + 2 * m) * k; o.height = (Math.max(...ys) - Math.min(...ys) + 2 * m) * k;
        const ox = o.getContext("2d"); ox.scale(k, k); ox.translate(m - Math.min(...xs), m - Math.min(...ys)); ox.strokeStyle = "#141e5a"; ox.lineWidth = 2.6; ox.lineCap = ox.lineJoin = "round";
        strokes.forEach((s) => { ox.beginPath(); s.forEach((p, i) => (i ? ox.lineTo(p[0], p[1]) : ox.moveTo(p[0], p[1]))); ox.stroke(); });
        saveData(o.toDataURL("image/png")); strokes = []; redraw();
      });
      $("#sgImg").addEventListener("click", () => {
        const inp = $("#fileImage"); inp.value = ""; inp.onchange = async () => { const f = inp.files[0]; if (!f) return;
          const bmp = await createImageBitmap(f), k = Math.min(1, 900 / bmp.width), o = document.createElement("canvas"); o.width = bmp.width * k; o.height = bmp.height * k;
          const ox = o.getContext("2d"); ox.drawImage(bmp, 0, 0, o.width, o.height); const im = ox.getImageData(0, 0, o.width, o.height), dd = im.data;
          for (let i = 0; i < dd.length; i += 4) { const l = 0.3 * dd[i] + 0.59 * dd[i + 1] + 0.11 * dd[i + 2]; const a = l > 200 ? 0 : 255 - l; dd[i] = 20; dd[i + 1] = 30; dd[i + 2] = 90; dd[i + 3] = a; }
          ox.putImageData(im, 0, 0); saveData(o.toDataURL("image/png")); };
        inp.click();
      });
      $("#sgOk").addEventListener("click", () => { const L = sigs(); if (chosen < 0 || !L[chosen]) { toast("Guarda ou escolhe uma assinatura."); return; } const id = uid(); S.images[id] = L[chosen]; S.signature = id; close(); res(true); });
      $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => res(false)));
    });
  });
}

// ------------------------------------------------------------------ operações de páginas (pdf-lib)
async function pageOp(fn, msg) {
  if (!S.bytes) return;
  busy(true);
  try {
    const snap = snapshot();
    const doc = await PDFDocument.load(S.bytes, { ignoreEncryption: true });
    const uids = await fn(doc, S.uids.slice());
    if (!uids) return;
    const bytes = await doc.save();
    S.undo.push(snap); S.redo = []; S.dirty = true;
    S.sel.clear(); await loadBytes(bytes, uids); updateButtons(); autosave(); if (msg) toast(msg);
  } catch (e) { console.error(e); alert("Não foi possível alterar as páginas.\n\n" + (e.message || e)); }
  finally { busy(false); }
}
async function pageAction(a) {
  if (!S.pdf) return;
  const pages = selPages();
  if (a === "rotate") return pageOp((doc, u) => { pages.forEach((i) => { const p = doc.getPage(i); p.setRotation(degrees(((p.getRotation().angle || 0) + 90) % 360)); }); return u; }, "Rodado");
  if (a === "delete") {
    if (pages.length >= S.pages.length) { toast("Não é possível apagar todas as páginas."); return; }
    if (!confirm(`Apagar ${pages.length} página(s)?`)) return;
    return pageOp((doc, u) => { [...pages].reverse().forEach((i) => { doc.removePage(i); u.splice(i, 1); }); S.pageSel.clear(); return u; }, "Página(s) apagada(s)");
  }
  if (a === "dup") return pageOp(async (doc, u) => {
    for (const i of [...pages].reverse()) { const [c] = await doc.copyPages(doc, [i]); doc.insertPage(i + 1, c); const nu = uid(); S.objs[nu] = clone(S.objs[u[i]] || []).map((o) => ({ ...o, id: uid() })); u.splice(i + 1, 0, nu); }
    return u; }, "Duplicado");
  if (a === "blank") return pageOp((doc, u) => { const at = pages[pages.length - 1] + 1, ref = S.pages[at - 1]; doc.insertPage(at, [ref.W, ref.H]); u.splice(at, 0, uid()); return u; }, "Página em branco inserida");
  if (a === "up" || a === "down") { const i = pages[0], j = a === "up" ? i - 1 : i + 1; if (j < 0 || j >= S.pages.length) return; S.pageSel = new Set([j]); return movePage(i, j); }
  if (a === "insert") { const inp = $("#fileInsert"); inp.value = ""; inp.onchange = () => insertFiles([...inp.files], pages[pages.length - 1] + 1); inp.click(); return; }
  if (a === "extract") return extractPages(pages);
}
function movePage(from, to) {
  return pageOp((doc, u) => { const p = doc.getPage(from); doc.removePage(from); doc.insertPage(to, p); const [x] = u.splice(from, 1); u.splice(to, 0, x); return u; }, "Página movida");
}
async function insertFiles(files, at) {
  return pageOp(async (doc, u) => {
    let pos = at;
    for (const f of files) {
      if (f.type.startsWith("image/")) { await appendImage(doc, f, pos); u.splice(pos, 0, uid()); pos++; }
      else { const n = await appendPdf(doc, new Uint8Array(await f.arrayBuffer()), pos); for (let k = 0; k < n; k++) u.splice(pos + k, 0, uid()); pos += n; }
    }
    return u;
  }, `${files.length} ficheiro(s) inserido(s)`);
}
async function extractPages(pages) {
  busy(true, "A extrair…");
  try {
    const full = await buildFinalPdf();
    const src = await PDFDocument.load(full), out = await PDFDocument.create();
    (await out.copyPages(src, pages)).forEach((p) => out.addPage(p));
    download(await out.save(), `${S.name} (páginas ${pages.map((p) => p + 1).join(",")}).pdf`);
  } finally { busy(false); }
}

// ------------------------------------------------------------------ gravar o PDF final
const hex = (c) => { const n = parseInt(String(c || "#000000").slice(1), 16); return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
function winAnsiSafe(font, s) {
  let out = "";
  for (const ch of s) { try { font.encodeText(ch); out += ch; } catch { out += ch === "–" || ch === "—" ? "-" : "?"; } }
  return out;
}
async function buildFinalPdf() {
  const doc = await PDFDocument.load(S.bytes, { ignoreEncryption: true });
  const fR = await doc.embedFont(StandardFonts.Helvetica), fB = await doc.embedFont(StandardFonts.HelveticaBold);
  const imgCache = {};
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], pg = S.pages[i], list = S.objs[S.uids[i]] || [];
    const X = (u) => pg.x0 + u[0], Y = (u) => pg.y1 - u[1];
    for (const o of list) {
      const op = o.opacity ?? 1;
      if (o.t === "text") {
        const a = (o.a || 0) * Math.PI / 180, font = o.bold ? fB : fR;
        o.text.split("\n").forEach((line, k) => {
          const ly = o.size * 0.8 + k * o.size * 1.2, u = [o.p[0] - ly * Math.sin(a), o.p[1] + ly * Math.cos(a)];
          if (line) page.drawText(winAnsiSafe(font, line), { x: X(u), y: Y(u), size: o.size, font, color: hex(o.color), opacity: op, rotate: degrees(-(o.a || 0)) });
        });
      } else if (o.t === "image") {
        const src = S.images[o.img]; if (!src) continue;
        let im = imgCache[o.img];
        if (!im) { const bytes = Uint8Array.from(atob(src.split(",")[1]), (c) => c.charCodeAt(0)); im = imgCache[o.img] = src.startsWith("data:image/png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); }
        const a = (o.a || 0) * Math.PI / 180, bl = [o.p[0] - o.h * Math.sin(a), o.p[1] + o.h * Math.cos(a)];
        page.drawImage(im, { x: X(bl), y: Y(bl), width: o.w, height: o.h, rotate: degrees(-(o.a || 0)), opacity: op });
      } else {
        const d = dOf(segs(o));
        const opt = { x: pg.x0, y: pg.y1 };
        if (o.t === "marker") Object.assign(opt, { color: hex(o.color), opacity: 0.42, blendMode: BlendMode ? BlendMode.Multiply : undefined });
        else if (o.t === "whiteout") Object.assign(opt, { color: hex(o.fill || "#FFFFFF") });
        else {
          Object.assign(opt, { borderColor: hex(o.stroke), borderWidth: o.width, borderOpacity: op, borderLineCap: LineCapStyle.Round });
          if (o.dash) opt.borderDashArray = [o.width * 4, o.width * 3];
          if (CLOSED.has(o.t) && o.fill) { opt.color = hex(o.fill); opt.opacity = op; }
        }
        page.drawSvgPath(d, opt);
        if (o.t === "arrow") page.drawSvgPath(dOf(arrowHead(o)), { x: pg.x0, y: pg.y1, color: hex(o.stroke), opacity: op });
      }
    }
  }
  doc.setProducer("VR PDF (Ventura Rodrigues)");
  return await doc.save();
}
function download(bytes, name) {
  const blob = new Blob([bytes], { type: "application/pdf" }), url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 20000);
}
async function savePdf() {
  if (!S.pdf) return; commitEditor(); busy(true, "A criar o PDF…");
  try { const bytes = await buildFinalPdf(); download(bytes, `${S.name}.pdf`); S.dirty = false; autosave(); toast("PDF guardado na pasta de transferências"); }
  catch (e) { console.error(e); alert("Não foi possível criar o PDF.\n\n" + (e.message || e)); }
  finally { busy(false); }
}
async function sharePdf() {
  if (!S.pdf) return; commitEditor(); busy(true, "A preparar…");
  try {
    const bytes = await buildFinalPdf(); const file = new File([bytes], `${S.name}.pdf`, { type: "application/pdf" });
    busy(false);
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: S.name }); S.dirty = false; }
    else { download(bytes, `${S.name}.pdf`); toast("Este navegador não partilha ficheiros: o PDF foi descarregado."); }
  } catch (e) { if (e.name !== "AbortError") alert(e.message || e); }
  finally { busy(false); }
}

// ------------------------------------------------------------------ menu Documento: numerar, marca d'água, juntar
function docMenu() {
  if (!S.pdf) { toast("Abre primeiro um PDF."); return; }
  modal(`<h2>Documento</h2>
    <div class="btnrow" style="flex-direction:column;align-items:stretch">
      <button class="btn" id="dmNum">Numerar páginas…</button>
      <button class="btn" id="dmWm">Marca d'água…</button>
      <button class="btn" id="dmJoin">Juntar PDFs ou fotografias no fim…</button>
      <button class="btn" id="dmRotAll">Rodar todas as páginas 90°</button>
      <button class="btn" id="dmPng">Exportar a página atual como imagem (PNG)</button>
      <button class="btn danger" id="dmClear">Apagar todos os desenhos e anotações</button>
    </div>
    <p class="hint">${S.pages.length} páginas. Versão ${VERSION}. Os desenhos ficam editáveis até guardares o PDF; o PDF guardado leva-os já fixos.</p>
    <div class="actions"><button class="btn" data-close>Fechar</button></div>`, (d, close) => {
    $("#dmNum").onclick = () => { close(); numberDialog(); };
    $("#dmWm").onclick = () => { close(); watermarkDialog(); };
    $("#dmJoin").onclick = () => { close(); const inp = $("#fileInsert"); inp.value = ""; inp.onchange = () => insertFiles([...inp.files], S.pages.length); inp.click(); };
    $("#dmRotAll").onclick = () => { close(); S.pageSel = new Set(S.pages.map((_, i) => i)); pageAction("rotate").then(() => { S.pageSel.clear(); markThumbs(); }); };
    $("#dmPng").onclick = async () => { close(); await exportPng(S.cur); };
    $("#dmClear").onclick = () => { if (!confirm("Apagar todos os desenhos, textos e anotações feitos no VR PDF?")) return; pushUndo(); S.uids.forEach((u) => (S.objs[u] = [])); S.sel.clear(); close(); changed(S.pages.map((_, i) => i)); };
  });
}
function addTextAll(make) {
  pushUndo(); const pages = [];
  S.pages.forEach((pg, i) => { const o = make(pg, i); if (o) { textSize(o); S.objs[S.uids[i]].push(o); pages.push(i); } });
  changed(pages);
}
function numberDialog() {
  modal(`<h2>Numerar páginas</h2>
    <div class="grid2"><label>Texto</label><input class="inp" id="nT" value="Página {n} de {total}">
    <label>Posição</label><select id="nP"><option value="br">Em baixo à direita</option><option value="bc">Em baixo ao centro</option><option value="bl">Em baixo à esquerda</option><option value="tr">Em cima à direita</option></select>
    <label>Tamanho</label><input class="inp" type="number" id="nS" value="9" min="5" max="30">
    <label>Começar em</label><input class="inp" type="number" id="nF" value="1"></div>
    <p class="hint">{n} = número da página, {total} = total. Ficam como textos editáveis.</p>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="nOk">Numerar</button></div>`, (d, close) => {
    $("#nOk").onclick = () => {
      const tpl = $("#nT").value, pos = $("#nP").value, size = +$("#nS").value || 9, first = +$("#nF").value || 1, total = S.pages.length + first - 1, m = 28;
      addTextAll((pg, i) => {
        const text = tpl.replace("{n}", i + first).replace("{total}", total);
        const o = { id: uid(), t: "text", text, size, color: "#333333", bold: false, opacity: 1, a: -pg.rot, p: [0, 0] }; textSize(o);
        const [vw, vh] = vdims(pg); let vx = pos.endsWith("r") ? vw - m - o.w : pos.endsWith("c") ? (vw - o.w) / 2 : m; let vy = pos.startsWith("b") ? vh - m * 0.8 - o.h : m * 0.6;
        o.p = V2U(pg, vx, vy); return o;
      });
      close(); toast("Páginas numeradas");
    };
  });
}
function watermarkDialog() {
  modal(`<h2>Marca d'água</h2>
    <div class="grid2"><label>Texto</label><input class="inp" id="wT" list="wL" value="RASCUNHO"><datalist id="wL"><option value="RASCUNHO"><option value="CÓPIA"><option value="CONFIDENCIAL"><option value="NÃO VÁLIDO PARA OBRA"><option value="PRELIMINAR"></datalist>
    <label>Cor</label><input type="color" id="wC" value="#C8302B">
    <label>Opacidade</label><input type="range" id="wO" min="0.05" max="0.6" step="0.05" value="0.18"></div>
    <div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="wOk">Aplicar a todas as páginas</button></div>`, (d, close) => {
    $("#wOk").onclick = () => {
      const text = $("#wT").value || "RASCUNHO", color = $("#wC").value, op = +$("#wO").value;
      addTextAll((pg) => {
        const [vw, vh] = vdims(pg), size = Math.min(110, Math.max(30, Math.hypot(vw, vh) * 0.7 / Math.max(4, text.length) / 0.62));
        const o = { id: uid(), t: "text", text, size, color, bold: true, opacity: op, a: -pg.rot - 35, p: [0, 0] }; textSize(o);
        const ang = -35 * Math.PI / 180, cx = vw / 2, cy = vh / 2; // âncora para o centro do texto ficar no centro da página
        const vx = cx - (o.w / 2) * Math.cos(ang) + (o.h / 2) * Math.sin(ang), vy = cy - (o.w / 2) * Math.sin(ang) - (o.h / 2) * Math.cos(ang);
        o.p = V2U(pg, vx, vy); return o;
      });
      close(); toast("Marca d'água aplicada");
    };
  });
}
async function exportPng(i) {
  busy(true, "A exportar…");
  try {
    const pg = S.pages[i], [vw, vh] = vdims(pg), k = 200 / 72, c = document.createElement("canvas");
    const vp = pg.page.getViewport({ scale: k, rotation: pg.rot }); c.width = vp.width; c.height = vp.height;
    const x = c.getContext("2d"); await pg.page.render({ canvasContext: x, viewport: vp }).promise;
    const svg = $(`.page[data-i="${i}"] svg.ov`).cloneNode(true); svg.querySelectorAll(".selui,.search,.preview").forEach((n) => n.remove());
    svg.setAttribute("width", vw); svg.setAttribute("height", vh);
    const img = new Image(); await new Promise((r) => { img.onload = r; img.onerror = r; img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg)); });
    x.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/png")); const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `${S.name} - página ${i + 1}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 20000);
  } finally { busy(false); }
}

// ------------------------------------------------------------------ pesquisa
async function runSearch(q) {
  q = q.trim().toLowerCase(); if (!q) { S.search = null; redrawAll(); $("#searchCount").textContent = ""; return; }
  const hits = [];
  for (let i = 0; i < S.pages.length; i++) {
    const pg = S.pages[i], tc = await pg.page.getTextContent();
    tc.items.forEach((it) => {
      const s = (it.str || "").toLowerCase(); let from = 0, k;
      while (s && (k = s.indexOf(q, from)) >= 0) {
        const [a, b, c, d, e, f] = it.transform, h = Math.hypot(c, d) || it.height || 10, w = it.width || 0;
        const x0 = e + w * k / s.length, x1 = e + w * (k + q.length) / s.length;
        hits.push({ page: i, x: x0 - pg.x0, y: pg.y1 - f - h * 0.85, w: x1 - x0, h: h * 1.1 }); from = k + q.length;
      }
    });
  }
  S.search = { q, hits, i: hits.length ? 0 : -1 }; redrawAll(); showHit();
}
function showHit() {
  const s = S.search; $("#searchCount").textContent = s ? (s.hits.length ? `${s.i + 1} de ${s.hits.length}` : "Sem resultados") : "";
  if (!s || s.i < 0) return; const h = s.hits[s.i], pg = S.pages[h.page];
  redrawAll(); goPage(h.page, U2V(pg, h.x + h.w / 2, h.y + h.h / 2));
}
$("#searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); const q = e.target.value; if (!S.search || S.search.q !== q.trim().toLowerCase()) runSearch(q); else { S.search.i = (S.search.i + (e.shiftKey ? -1 : 1) + S.search.hits.length) % Math.max(1, S.search.hits.length); showHit(); } }
  if (e.key === "Escape") closeSearch(); e.stopPropagation();
});
$("#sNext").onclick = () => { if (!S.search) return runSearch($("#searchInput").value); if (S.search.hits.length) { S.search.i = (S.search.i + 1) % S.search.hits.length; showHit(); } };
$("#sPrev").onclick = () => { if (S.search && S.search.hits.length) { S.search.i = (S.search.i - 1 + S.search.hits.length) % S.search.hits.length; showHit(); } };
function closeSearch() { $("#searchbar").classList.remove("on"); S.search = null; redrawAll(); viewer.focus(); }
$("#sClose").onclick = closeSearch;
function openSearch() { if (!S.pdf) return; $("#searchbar").classList.add("on"); $("#searchInput").focus(); $("#searchInput").select(); }

// ------------------------------------------------------------------ teclado
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select") || $("#modal").classList.contains("on")) { if (e.key === "Escape") $("#modal").classList.remove("on"); return; }
  const k = e.key, ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k.toLowerCase() === "o") { e.preventDefault(); return $("#fileOpen").click(); }
  if (ctrl && k.toLowerCase() === "s") { e.preventDefault(); return savePdf(); }
  if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); return redo(); }
  if (ctrl && k.toLowerCase() === "f") { e.preventDefault(); return openSearch(); }
  if (ctrl && k.toLowerCase() === "d") { e.preventDefault(); return duplicateSel(); }
  if (ctrl && k.toLowerCase() === "a") { e.preventDefault(); S.sel = new Set((S.objs[S.uids[S.cur]] || []).map((o) => o.id)); redrawAll(); renderProps(); return; }
  if (ctrl && (k === "+" || k === "=")) { e.preventDefault(); S.fit = null; return setZoom(S.zoom * 1.2); }
  if (ctrl && k === "-") { e.preventDefault(); S.fit = null; return setZoom(S.zoom / 1.2); }
  if (ctrl && k === "0") { e.preventDefault(); S.fit = "width"; return fitZoom(); }
  if (k === "Escape") { if (draw) return cancelDraw(); if (S.tool !== "select") return setTool("select"); S.sel.clear(); redrawAll(); renderProps(); return; }
  if (k === "Enter" && draw && draw.t === "polyline") { e.preventDefault(); return finishPolyline(); }
  if (k === " " ) { e.preventDefault(); if (S.tool === "select" && S.lastTool) return setTool(S.lastTool); return; }
  if (k === "Delete" || k === "Backspace") { e.preventDefault(); return deleteSel(); }
  if (k.startsWith("Arrow") && S.sel.size) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; return nudge(k === "ArrowLeft" ? -st : k === "ArrowRight" ? st : 0, k === "ArrowUp" ? -st : k === "ArrowDown" ? st : 0); }
  if (ctrl || e.altKey) return;
  const t = TOOLS.find((x) => x !== "-" && x.k === k.toUpperCase()); if (t) { e.preventDefault(); setTool(t.id); }
});

// ------------------------------------------------------------------ ligações dos botões
$("#bOpen").onclick = $("#bOpen2").onclick = () => $("#fileOpen").click();
$("#fileOpen").onchange = (e) => openFiles(e.target.files);
$("#bSave").onclick = savePdf; $("#bShare").onclick = sharePdf;
$("#bUndo").onclick = undo; $("#bRedo").onclick = redo;
$("#bZoomIn").onclick = () => { S.fit = null; setZoom(S.zoom * 1.2); };
$("#bZoomOut").onclick = () => { S.fit = null; setZoom(S.zoom / 1.2); };
$("#zoomLab").onclick = () => { S.fit = S.fit === "width" ? "page" : "width"; fitZoom(); toast(S.fit === "width" ? "Ajustado à largura" : "Página inteira"); };
$("#bThumbs").onclick = () => { $("#side").classList.toggle("hidden"); localStorage.setItem("vrpdf-side", $("#side").classList.contains("hidden") ? "0" : "1"); if (S.fit) setTimeout(fitZoom, 0); };
$("#bProps").onclick = () => { $("#props").classList.toggle("hidden"); localStorage.setItem("vrpdf-props", $("#props").classList.contains("hidden") ? "0" : "1"); if (S.fit) setTimeout(fitZoom, 0); };
$("#bSearch").onclick = openSearch; $("#bPageMenu").onclick = docMenu;
$("#bTheme").onclick = () => { const d = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; document.documentElement.dataset.theme = d; localStorage.setItem("vrpdf-theme", d); };
$("#pageNum").addEventListener("change", (e) => goPage(Math.max(0, Math.min(S.pages.length - 1, (+e.target.value || 1) - 1))));
$$("[data-pg]").forEach((b) => (b.onclick = () => pageAction(b.dataset.pg)));
// arrastar ficheiros para a janela
["dragenter", "dragover"].forEach((ev) => document.addEventListener(ev, (e) => { if (e.dataTransfer && e.dataTransfer.types.includes("Files")) { e.preventDefault(); $("#drop").classList.add("over"); } }));
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) $("#drop").classList.remove("over"); });
document.addEventListener("drop", (e) => {
  if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); $("#drop").classList.remove("over");
  const files = [...e.dataTransfer.files];
  if (S.pdf && $("#start").classList.contains("hidden")) {
    modal(`<h2>${files.length} ficheiro(s)</h2><p>O que queres fazer?</p><div class="actions"><button class="btn" data-close>Cancelar</button><button class="btn" id="dIns">Juntar no fim deste documento</button><button class="btn primary" id="dOpen">Abrir</button></div>`, (d, close) => {
      $("#dIns").onclick = () => { close(); insertFiles(files, S.pages.length); };
      $("#dOpen").onclick = () => { close(); openFiles(files); };
    });
  } else openFiles(files);
});
window.addEventListener("beforeunload", (e) => { if (S.dirty) { autosave(); } });

// ------------------------------------------------------------------ arranque
(async function init() {
  const th = localStorage.getItem("vrpdf-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = th;
  try { Object.assign(S.style, JSON.parse(localStorage.getItem("vrpdf-style") || "{}")); } catch {}
  const narrow = innerWidth < 900;
  if (localStorage.getItem("vrpdf-side") === "1" && !narrow) $("#side").classList.remove("hidden");
  if (localStorage.getItem("vrpdf-props") === "0" || narrow) $("#props").classList.add("hidden");
  buildTools(); setTool("select"); renderProps();
  const s = await idbGet("session");
  if (s && s.bytes) {
    const when = new Date(s.ts).toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
    $("#resume").innerHTML = `<div class="resume"><div class="t"><span class="hint">Continuar onde ficaste</span><b>${esc(s.name)}.pdf</b><span class="hint">${s.pages || ""} páginas · ${when}${s.dirty ? " · com alterações por guardar" : ""}</span></div><button class="btn primary" id="bResume">Continuar</button></div>`;
    $("#bResume").onclick = () => resumeSession(s);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  // abrir PDFs partilhados para a app (Android: "Abrir com")
  if ("launchQueue" in window) launchQueue.setConsumer(async (p) => { if (p.files && p.files.length) openFiles(await Promise.all(p.files.map((h) => h.getFile()))); });
  window.__vrpdf = S; // para diagnóstico
})();
