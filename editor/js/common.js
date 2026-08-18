// common.js — shared utilities for the UW editor suite.
// All editors are plain ES modules, no build step (same convention as game/main.js).
// They load data from ../assets/ (the game's asset folder) and export modified
// files back to the user via download / File System Access API.

// Asset base: when the editor is served from the game repo (game/editor/),
// '../assets/' exists locally. When deployed standalone (e.g. GitHub Pages
// dol-k3-2-editor), fall back to the game's public Pages site (GitHub Pages
// sends Access-Control-Allow-Origin: *, so cross-origin fetch works).
const LOCAL_ASSETS = '../assets/';
const REMOTE_ASSETS = 'https://lychees.github.io/dol-k3-2/game/assets/';
let _base = LOCAL_ASSETS;
let _probe = null;
export function probeAssets() {
  if (!_probe) {
    _probe = fetch(LOCAL_ASSETS + 'building_names.json', { method: 'HEAD' })
      .then(r => { if (!r.ok) throw new Error('no local assets'); })
      .catch(() => { _base = REMOTE_ASSETS; });
  }
  return _probe;
}

// Resolved asset base URL ('../assets/' locally, remote Pages URL otherwise).
// Valid only after any load*/assetURL call has completed its first probe.
export const ASSETS = LOCAL_ASSETS; // deprecated: use assetURL()

export function assetURL(name) {
  return _base + name;
}

// ---------- loading ----------

export async function loadJSON(name) {
  await probeAssets();
  const r = await fetch(_base + name);
  if (!r.ok) throw new Error(`加载失败 ${name}: HTTP ${r.status}`);
  return r.json();
}

export async function loadBinary(name) {
  await probeAssets();
  const r = await fetch(_base + name);
  if (!r.ok) throw new Error(`加载失败 ${name}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function loadImage(name) {
  await probeAssets();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`加载图片失败 ${name}`));
    img.src = _base + name;
  });
}

// ---------- saving ----------

// Plain download export: predictable in every browser (and in automation).
// The user overwrites game/assets/<name> with the downloaded file.
export async function saveFile(suggestedName, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  download(suggestedName, blob);
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`已导出 ${filename}（下载目录），请覆盖 game/assets/${filename}`);
}

export function toJSONBlob(obj) {
  return new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
}

// Import a local file; returns { name, buffer } where buffer is ArrayBuffer.
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, buffer: await f.arrayBuffer() });
    };
    input.click();
  });
}

// ---------- DOM helpers ----------

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export function toast(msg) {
  let t = document.getElementById('uw-toast');
  if (!t) {
    t = el('div', { id: 'uw-toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// Standard page header with a link back to the hub.
export function pageHeader(title, subtitle = '') {
  const h = el('header', { class: 'ed-header' },
    el('a', { class: 'ed-home', href: 'index.html', text: '← 编辑器主页' }),
    el('h1', { text: title }),
    subtitle ? el('span', { class: 'ed-sub', text: subtitle }) : null,
  );
  document.body.prepend(h);
  return h;
}

// ---------- dirty tracking ----------

// Call mark() on every mutation; the page warns before unload while dirty.
export function makeDirty() {
  let dirty = false;
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });
  return {
    mark() { dirty = true; document.title = document.title.replace(/^\* /, ''); document.title = '* ' + document.title; },
    clear() { dirty = false; document.title = document.title.replace(/^\* /, ''); },
    get dirty() { return dirty; },
  };
}

// ---------- tile atlas ----------

// A tile atlas: image of `cols` × rows cells, each `tile`×`tile` px.
// Ids are 1-based row-major (id 1 = top-left cell), matching the game's shader.
export function makeAtlas(img, tile = 16, cols = 16) {
  const rows = Math.floor(img.height / tile);
  const count = cols * rows;
  function drawTile(ctx, id, dx, dy, size = tile, smooth = false) {
    if (!id || id < 1 || id > count) return;
    const i = id - 1;
    const sx = (i % cols) * tile, sy = Math.floor(i / cols) * tile;
    ctx.imageSmoothingEnabled = smooth;
    ctx.drawImage(img, sx, sy, tile, tile, dx, dy, size, size);
    if (smooth) ctx.imageSmoothingEnabled = false;
  }
  return { img, tile, cols, rows, count, drawTile };
}

// Render a whole tile grid (Uint8Array, 1-based ids) into a canvas at 1px/tile
// using an offscreen atlas canvas. Returns the canvas (w×h pixels).
// Tiles are downsampled with smoothing so the 1px result is the average color
// (nearest-neighbor would pick a single texel, making land look black).
export function renderGridToCanvas(grid, w, h, atlas) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  // draw tile by tile via ImageData is slow for 2.3M tiles; draw in strips
  const strip = document.createElement('canvas');
  strip.width = w; strip.height = 1;
  const sctx = strip.getContext('2d');
  for (let y = 0; y < h; y++) {
    sctx.clearRect(0, 0, w, 1);
    for (let x = 0; x < w; x++) {
      atlas.drawTile(sctx, grid[y * w + x], x, 0, 1, true);
    }
    ctx.drawImage(strip, 0, y);
  }
  return c;
}

// ---------- misc ----------

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function downloadText(filename, text, mime = 'application/json') {
  download(filename, new Blob([text], { type: mime }));
}
