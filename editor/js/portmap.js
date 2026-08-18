// portmap.js — 港口地图编辑器 (portmaps.bin)
// 101 张 96×96 地图连续排列，tile id 0-based；显示时用 id+1 去 portchips 图集取图。
import { loadBinary, loadJSON, loadImage, saveFile, pickFile, el, pageHeader, makeDirty, makeAtlas, toast, clamp } from './common.js';

pageHeader('港口地图编辑器', 'portmaps.bin — 101 × 96×96');

const W = 96, H = 96, MAP_SIZE = W * H, MAP_COUNT = 101, FILE_SIZE = MAP_COUNT * MAP_SIZE;
const PAL_COLS = 16, PAL_ROWS = 15, PAL_COUNT = PAL_COLS * PAL_ROWS; // 显示 id 1–240
const UNDO_MAX = 50;

const dirty = makeDirty();

// ---------- 数据加载 ----------
let portmaps = await loadBinary('portmaps.bin');
if (portmaps.byteLength !== FILE_SIZE) {
  toast(`警告：portmaps.bin 长度 ${portmaps.byteLength}，应为 ${FILE_SIZE}，已截断/补齐`);
  const fixed = new Uint8Array(FILE_SIZE);
  fixed.set(portmaps.subarray(0, Math.min(portmaps.byteLength, FILE_SIZE)));
  portmaps = fixed;
}
const [ports, portMeta, buildingNames] = await Promise.all([
  loadJSON('ports.json'),
  loadJSON('port_meta.json'),
  loadJSON('building_names.json'),
]);

// 港口 id → 地图索引（main.js PORT_MAP_OVERRIDE）
function mapIdxOfPort(pid) {
  return ({ 131: 94, 132: 0 })[pid] ?? Math.min(pid - 1, MAP_COUNT - 1);
}

// 地图索引 → 使用它的港口列表
const portsByMap = Array.from({ length: MAP_COUNT }, () => []);
for (const p of ports) {
  const idx = mapIdxOfPort(p.id);
  if (idx >= 0 && idx < MAP_COUNT) portsByMap[idx].push(p);
}

// 当前地图的 96×96 视图（直接编辑 portmaps 的切片）
function mapView(idx) {
  return portmaps.subarray(idx * MAP_SIZE, (idx + 1) * MAP_SIZE);
}

// ---------- 图块集 ----------
// 每张地图的图块集 = 使用它的第一个港口的 port_meta.json tileset 字段
const atlasCache = new Map(); // tileset -> Promise<atlas>
async function atlasForMap(idx) {
  const first = portsByMap[idx][0];
  const ts = (first && portMeta[first.id]) ? (portMeta[first.id].tileset ?? 0) : 0;
  if (!atlasCache.has(ts)) {
    const nnn = String(2 * ts).padStart(3, '0');
    atlasCache.set(ts, loadImage(`portchips/${nnn}_day.png`).then(img => makeAtlas(img, 16, PAL_COLS)));
  }
  return { atlas: await atlasCache.get(ts), tileset: ts };
}

// ---------- 状态 ----------
let curMap = 0;
let zoom = 6;
let tool = 'brush';       // brush | rect | fill | picker
let brushSize = 1;
let curTile = 0;          // 0-based 存储值；显示 id = curTile + 1
let gridOn = true;
let buildingsOn = true;
let atlas = null;
let tilesetOfMap = 0;

// ---------- DOM ----------
const mapSelect = document.getElementById('map-select');
const zoomSelect = document.getElementById('zoom-select');
const brushSizeSel = document.getElementById('brush-size');
const canvas = document.getElementById('map-canvas');
const ctx = canvas.getContext('2d');
const palette = document.getElementById('palette');
const pctx = palette.getContext('2d');
const statusEl = document.getElementById('status');
const mapInfoEl = document.getElementById('map-info');
const curTileEl = document.getElementById('cur-tile');

// 地图下拉拉框：标注使用它的港口
for (let i = 0; i < MAP_COUNT; i++) {
  const names = portsByMap[i].map(p => p.name).join(', ');
  mapSelect.append(el('option', { value: i, text: `#${i} — ${names || '（无港口使用）'}` }));
}

// 底图：96×96、1px/tile 的离屏画布，编辑时增量更新
const base = document.createElement('canvas');
base.width = W; base.height = H;
const bctx = base.getContext('2d');

function paintBase(x, y, v) {
  if (atlas) atlas.drawTile(bctx, v + 1, x, y, 1); // 存储 0-based → 显示 id = v+1
}

function rebuildBase() {
  bctx.fillStyle = '#000';
  bctx.fillRect(0, 0, W, H);
  const view = mapView(curMap);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) paintBase(x, y, view[y * W + x]);
  }
}

// ---------- 撤销 / 重做（按笔画 diff） ----------
const undoStack = [], redoStack = [];

function pushStroke(map, olds) {
  // olds: Map<idx, oldValue>，news 从当前视图取
  if (!olds.size) return;
  const view = mapView(map);
  const idxs = [...olds.keys()];
  undoStack.push({ map, idxs, olds: idxs.map(i => olds.get(i)), news: idxs.map(i => view[i]) });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
  dirty.mark();
}

function applyRecord(rec, values) {
  const view = mapView(rec.map);
  for (let k = 0; k < rec.idxs.length; k++) view[rec.idxs[k]] = values[k];
  if (rec.map === curMap) {
    for (const i of rec.idxs) paintBase(i % W, (i / W) | 0, view[i]);
    render();
  }
  dirty.mark();
}

function undo() {
  const rec = undoStack.pop();
  if (!rec) return toast('没有可撤销的操作');
  applyRecord(rec, rec.olds);
  redoStack.push(rec);
}

function redo() {
  const rec = redoStack.pop();
  if (!rec) return toast('没有可重做的操作');
  applyRecord(rec, rec.news);
  undoStack.push(rec);
}

// ---------- 渲染 ----------
let hover = null;              // {x, y} 鼠标所在格
let rectStart = null, rectEnd = null; // 矩形工具拖拽中

function render() {
  const px = W * zoom;
  if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(base, 0, 0, px, px);

  if (gridOn) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      ctx.moveTo(i * zoom + 0.5, 0); ctx.lineTo(i * zoom + 0.5, px);
      ctx.moveTo(0, i * zoom + 0.5); ctx.lineTo(px, i * zoom + 0.5);
    }
    ctx.stroke();
  }

  if (buildingsOn) drawBuildings(px);

  if (rectStart && rectEnd) {
    const x0 = Math.min(rectStart.x, rectEnd.x) * zoom;
    const y0 = Math.min(rectStart.y, rectEnd.y) * zoom;
    const w = (Math.abs(rectEnd.x - rectStart.x) + 1) * zoom;
    const h = (Math.abs(rectEnd.y - rectStart.y) + 1) * zoom;
    ctx.fillStyle = 'rgba(110,178,255,0.25)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = '#6cb2ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  }

  if (hover) {
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(hover.x * zoom + 0.5, hover.y * zoom + 0.5, zoom - 1, zoom - 1);
  }
}

// 建筑叠加层（只读）：使用此地图的港口的 buildings
function drawBuildings(px) {
  const list = portsByMap[curMap];
  const multi = list.length > 1;
  ctx.font = `${Math.max(10, Math.round(zoom * 1.2))}px "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';
  for (const p of list) {
    const meta = portMeta[p.id];
    if (!meta || !meta.buildings) continue;
    for (const [bid, pos] of Object.entries(meta.buildings)) {
      const cx = (pos[0] + 0.5) * zoom, cy = (pos[1] + 0.5) * zoom;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(4, zoom * 0.7), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,80,80,0.35)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffd24a';
      ctx.stroke();
      const name = (multi ? p.name + '·' : '') + (buildingNames[bid] || bid);
      let tx = cx + 6;
      const tw = ctx.measureText(name).width;
      if (tx + tw > px - 2) tx = cx - 6 - tw; // 右边缘文字翻转到左侧
      const ty = clamp(cy + 4, 0, px - 14);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(name, tx, ty);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(name, tx, ty);
    }
  }
}

// ---------- 图块面板（2 倍放大，显示 id 1–240） ----------
function renderPalette() {
  pctx.imageSmoothingEnabled = false;
  pctx.fillStyle = '#0b0f16';
  pctx.fillRect(0, 0, palette.width, palette.height);
  if (atlas) pctx.drawImage(atlas.img, 0, 0, PAL_COLS * 32, PAL_ROWS * 32);
  if (curTile >= 0 && curTile < PAL_COUNT) {
    pctx.strokeStyle = '#ffd24a';
    pctx.lineWidth = 2;
    pctx.strokeRect((curTile % PAL_COLS) * 32 + 1, ((curTile / PAL_COLS) | 0) * 32 + 1, 30, 30);
  }
  curTileEl.textContent = `当前 tile：显示 id ${curTile + 1}（存储值 ${curTile}）`;
}

palette.addEventListener('pointerdown', (e) => {
  const r = palette.getBoundingClientRect();
  const cx = Math.floor((e.clientX - r.left) / r.width * PAL_COLS);
  const cy = Math.floor((e.clientY - r.top) / r.height * PAL_ROWS);
  if (cx < 0 || cy < 0 || cx >= PAL_COLS || cy >= PAL_ROWS) return;
  curTile = cy * PAL_COLS + cx;
  renderPalette();
});

// ---------- 编辑工具（均不环绕，边界截断） ----------
function applyBrush(view, olds, x, y) {
  const half = (brushSize - 1) >> 1;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const tx = x + dx, ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      const i = ty * W + tx;
      if (view[i] === curTile) continue;
      if (!olds.has(i)) olds.set(i, view[i]);
      view[i] = curTile;
      paintBase(tx, ty, curTile);
    }
  }
}

function fillRect(view, olds, a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (view[i] === curTile) continue;
      if (!olds.has(i)) olds.set(i, view[i]);
      view[i] = curTile;
      paintBase(x, y, curTile);
    }
  }
}

// 非递归洪水填充（4 向，不环绕）
function floodFill(x, y) {
  const view = mapView(curMap);
  const target = view[y * W + x];
  if (target === curTile) return;
  const olds = new Map();
  const stack = [y * W + x];
  while (stack.length) {
    const i = stack.pop();
    if (view[i] !== target) continue;
    olds.set(i, target);
    view[i] = curTile;
    paintBase(i % W, (i / W) | 0, curTile);
    const ix = i % W, iy = (i / W) | 0;
    if (ix > 0) stack.push(i - 1);
    if (ix < W - 1) stack.push(i + 1);
    if (iy > 0) stack.push(i - W);
    if (iy < H - 1) stack.push(i + W);
  }
  pushStroke(curMap, olds);
  render();
}

function pickTile(x, y) {
  curTile = mapView(curMap)[y * W + x];
  renderPalette();
  setStatus(x, y);
}

// ---------- 画布交互 ----------
let drawing = false;
let strokeOlds = null; // Map<idx, oldValue>
let lastPos = null;

function tileFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / zoom);
  const y = Math.floor((e.clientY - r.top) / zoom);
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  return { x, y };
}

function setStatus(x, y) {
  if (x === null) { statusEl.textContent = `地图 #${curMap} ｜ 工具：${toolName()}`; return; }
  const v = mapView(curMap)[y * W + x];
  statusEl.textContent = `坐标 (${x}, ${y}) ｜ tile 存储值 ${v} ｜ 显示 id ${v + 1} ｜ 工具：${toolName()}`;
}

function toolName() {
  return { brush: '画笔', rect: '矩形填充', fill: '油漆桶', picker: '取色器' }[tool];
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const pos = tileFromEvent(e);
  if (!pos) return;
  if (e.altKey || tool === 'picker') { pickTile(pos.x, pos.y); return; }
  canvas.setPointerCapture(e.pointerId);
  drawing = true;
  lastPos = pos;
  if (tool === 'fill') {
    floodFill(pos.x, pos.y);
    drawing = false;
  } else if (tool === 'rect') {
    rectStart = pos; rectEnd = pos;
    render();
  } else { // brush
    strokeOlds = new Map();
    applyBrush(mapView(curMap), strokeOlds, pos.x, pos.y);
    render();
  }
});

canvas.addEventListener('pointermove', (e) => {
  const pos = tileFromEvent(e);
  hover = pos;
  setStatus(pos ? pos.x : null, pos ? pos.y : 0);
  if (!drawing || !pos) { render(); return; }
  if (tool === 'rect') {
    rectEnd = pos;
  } else if (tool === 'brush') {
    // 快速移动时在两点间插值，避免断线
    const view = mapView(curMap);
    const dx = Math.abs(pos.x - lastPos.x), dy = Math.abs(pos.y - lastPos.y);
    const steps = Math.max(dx, dy, 1);
    for (let s = 1; s <= steps; s++) {
      const x = Math.round(lastPos.x + (pos.x - lastPos.x) * s / steps);
      const y = Math.round(lastPos.y + (pos.y - lastPos.y) * s / steps);
      applyBrush(view, strokeOlds, x, y);
    }
    lastPos = pos;
  }
  render();
});

function endStroke() {
  if (!drawing) return;
  drawing = false;
  if (tool === 'rect' && rectStart && rectEnd) {
    const olds = new Map();
    fillRect(mapView(curMap), olds, rectStart, rectEnd);
    pushStroke(curMap, olds);
  } else if (tool === 'brush' && strokeOlds) {
    pushStroke(curMap, strokeOlds);
  }
  strokeOlds = null;
  rectStart = rectEnd = null;
  render();
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', () => { hover = null; setStatus(null, 0); render(); });

// ---------- 工具栏 ----------
for (const btn of document.querySelectorAll('button.tool')) {
  btn.onclick = () => {
    tool = btn.dataset.tool;
    for (const b of document.querySelectorAll('button.tool')) b.classList.toggle('active', b === btn);
    document.getElementById('brush-label').style.visibility = tool === 'brush' ? 'visible' : 'hidden';
    setStatus(null, 0);
  };
}

brushSizeSel.onchange = () => { brushSize = +brushSizeSel.value; };
zoomSelect.onchange = () => { zoom = +zoomSelect.value; render(); };
document.getElementById('chk-grid').onchange = (e) => { gridOn = e.target.checked; render(); };
document.getElementById('chk-buildings').onchange = (e) => { buildingsOn = e.target.checked; render(); };
document.getElementById('btn-undo').onclick = undo;
document.getElementById('btn-redo').onclick = redo;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); }
});

mapSelect.onchange = () => selectMap(+mapSelect.value);

async function selectMap(i) {
  curMap = i;
  mapSelect.value = i;
  statusEl.textContent = '加载图块集…';
  const { atlas: a, tileset } = await atlasForMap(i);
  if (curMap !== i) return; // 期间又切换了地图
  atlas = a;
  tilesetOfMap = tileset;
  const nnn = String(2 * tileset).padStart(3, '0');
  const names = portsByMap[i].map(p => p.name).join(', ') || '（无港口使用）';
  mapInfoEl.textContent = `地图 #${i} ｜ 港口：${names} ｜ 图块集：portchips/${nnn}_day.png`;
  rebuildBase();
  renderPalette();
  render();
  setStatus(null, 0);
}

// ---------- 导入 / 导出 ----------
document.getElementById('btn-export-all').onclick = () => {
  saveFile('portmaps.bin', portmaps);
  dirty.clear();
};

document.getElementById('btn-import-all').onclick = async () => {
  const f = await pickFile('.bin');
  if (!f) return;
  if (f.buffer.byteLength !== FILE_SIZE) {
    return toast(`长度错误：${f.buffer.byteLength} 字节，portmaps.bin 应为 ${FILE_SIZE} 字节`);
  }
  portmaps.set(new Uint8Array(f.buffer));
  undoStack.length = 0; redoStack.length = 0;
  rebuildBase(); render();
  dirty.mark();
  toast(`已导入 ${f.name}`);
};

document.getElementById('btn-export-map').onclick = () => {
  saveFile(`portmap_${String(curMap).padStart(3, '0')}.bin`, mapView(curMap).slice());
};

document.getElementById('btn-import-map').onclick = async () => {
  const f = await pickFile('.bin');
  if (!f) return;
  if (f.buffer.byteLength !== MAP_SIZE) {
    return toast(`长度错误：${f.buffer.byteLength} 字节，单张地图应为 ${MAP_SIZE} 字节`);
  }
  mapView(curMap).set(new Uint8Array(f.buffer));
  undoStack.length = 0; redoStack.length = 0;
  rebuildBase(); render();
  dirty.mark();
  toast(`已导入 ${f.name} 到地图 #${curMap}`);
};

// ---------- 启动 ----------
selectMap(0);
