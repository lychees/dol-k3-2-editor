// map.js — 世界地图编辑器 (world_map.bin)
// 2160×1080 字节，1-based tile id，行优先；世界为环面（x/y 均环绕）。
import {
  loadBinary, loadJSON, loadImage, saveFile, pickFile,
  pageHeader, makeDirty, makeAtlas, renderGridToCanvas, toast, clamp,
} from './common.js';

pageHeader('世界地图编辑器', 'world_map.bin — 2160×1080');

const W = 2160, H = 1080, LEN = W * H;
const MIN_ZOOM = 1, MAX_ZOOM = 24;
const UNDO_MAX = 50;

const dirty = makeDirty();

// ---------- 数据加载 ----------

const [grid, tilesImg] = await Promise.all([
  loadBinary('world_map.bin'),
  loadImage('tiles_day.png'),
]);
if (grid.length !== LEN) throw new Error(`world_map.bin 长度错误: ${grid.length}（应为 ${LEN}）`);
const atlas = makeAtlas(tilesImg, 16, 16);

// 叠加层数据（只读，加载失败不阻塞编辑器）
async function tryJSON(name) { try { return await loadJSON(name); } catch { return null; } }
const overlays = {
  ports: await tryJSON('ports.json'),
  towns: await tryJSON('towns.json'),
  ruins: await tryJSON('ruins.json'),
  villages: await tryJSON('villages.json'),
};

// 离屏全图（2160×1080，1px/tile）；编辑时只重绘被改的 tile
const off = renderGridToCanvas(grid, W, H, atlas);
const offCtx = off.getContext('2d');

// ---------- 状态 ----------

let tool = 'brush';           // brush / rect / fill / picker / pan
let brushSize = 3;
let curTile = 1;
let zoom = 1;                 // px/tile
let viewX = 0, viewY = 0;     // 视口左上角的世界 tile 坐标（可为小数）
let stroke = null;            // 当前笔画的 diff：Map<idx, oldVal>
const undoStack = [], redoStack = [];
const show = { grid: false, ports: true, towns: true, ruins: true, villages: true };

let panning = null;           // { mx, my, vx, vy }
let painting = false;
let lastPaint = null;
let rectStart = null, rectCur = null;
let hoverTile = null;

// ---------- DOM ----------

const wrap = document.getElementById('wrap');
const view = document.getElementById('view');
const viewCtx = view.getContext('2d');
const statusEl = document.getElementById('status');
const zoomLabel = document.getElementById('zoom-label');
const curTileEl = document.getElementById('cur-tile');
const undoBtn = document.getElementById('btn-undo');
const redoBtn = document.getElementById('btn-redo');
const palette = document.getElementById('palette');
const pctx = palette.getContext('2d');

// ---------- 基础操作 ----------

const wrapX = (x) => ((x % W) + W) % W;
const wrapY = (y) => ((y % H) + H) % H;

// 写单个 tile（记录 diff 并即时更新离屏 canvas 对应 1px 区域）
function setIdx(idx, id) {
  if (grid[idx] === id) return;
  if (stroke && !stroke.has(idx)) stroke.set(idx, grid[idx]);
  grid[idx] = id;
  atlas.drawTile(offCtx, id, idx % W, (idx / W) | 0, 1, true);
}

function setTile(x, y, id) { setIdx(wrapY(y) * W + wrapX(x), id); }

function applyBrush(cx, cy, id) {
  const r = (brushSize - 1) / 2;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++)
      setTile(cx + dx, cy + dy, id);
}

// 快速移动时在两个采样点之间补刷，避免断线
function paintLine(x0, y0, x1, y1, id) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps > 200 || steps === 0) { applyBrush(x1, y1, id); return; } // 跨环绕边界的跳变不插值
  for (let i = 0; i <= steps; i++)
    applyBrush(Math.round(x0 + dx * i / steps), Math.round(y0 + dy * i / steps), id);
}

// 非递归洪水填充（环面）
function floodFill(sx, sy, id) {
  const target = grid[sy * W + sx];
  if (target === id) return;
  const seen = new Uint8Array(LEN);
  const stack = [sy * W + sx];
  seen[stack[0]] = 1;
  while (stack.length) {
    const idx = stack.pop();
    setIdx(idx, id);
    const x = idx % W, y = (idx / W) | 0;
    const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
    const yu = y === 0 ? H - 1 : y - 1, yd = y === H - 1 ? 0 : y + 1;
    const nbr = [y * W + xl, y * W + xr, yu * W + x, yd * W + x];
    for (const n of nbr) {
      if (!seen[n] && grid[n] === target) { seen[n] = 1; stack.push(n); }
    }
  }
}

function fillRect(x0, y0, x1, y1, id) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      setTile(x, y, id);
}

// ---------- 撤销 / 重做 ----------

function commitStroke() {
  if (stroke && stroke.size) {
    undoStack.push(stroke);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    dirty.mark();
  }
  stroke = null;
  updateUndoButtons();
}

function undo() {
  const s = undoStack.pop();
  if (!s) return;
  const inv = new Map();
  for (const [idx, oldVal] of s) {
    inv.set(idx, grid[idx]);
    grid[idx] = oldVal;
    atlas.drawTile(offCtx, oldVal, idx % W, (idx / W) | 0, 1, true);
  }
  redoStack.push(inv);
  dirty.mark();
  updateUndoButtons();
  render();
}

function redo() {
  const s = redoStack.pop();
  if (!s) return;
  const inv = new Map();
  for (const [idx, newVal] of s) {
    inv.set(idx, grid[idx]);
    grid[idx] = newVal;
    atlas.drawTile(offCtx, newVal, idx % W, (idx / W) | 0, 1, true);
  }
  undoStack.push(inv);
  dirty.mark();
  updateUndoButtons();
  render();
}

function updateUndoButtons() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
}

// ---------- 渲染 ----------

function zoomText() { return `${+zoom.toFixed(2)} px/tile`; }

function render() {
  // 缩小到 2px/tile 以下时启用平滑，否则远景会因最近邻采样显得斑驳
  viewCtx.imageSmoothingEnabled = zoom < 2;
  viewCtx.setTransform(1, 0, 0, 1, 0, 0);
  viewCtx.fillStyle = '#0b0f16';
  viewCtx.fillRect(0, 0, view.width, view.height);
  viewCtx.drawImage(off, -viewX * zoom, -viewY * zoom, W * zoom, H * zoom);
  drawGridLines();
  drawOverlays();
  drawPreviews();
}

function drawGridLines() {
  if (!show.grid || zoom < 8) return;
  const x0 = Math.max(0, Math.floor(viewX)), x1 = Math.min(W, Math.ceil(viewX + view.width / zoom));
  const y0 = Math.max(0, Math.floor(viewY)), y1 = Math.min(H, Math.ceil(viewY + view.height / zoom));
  viewCtx.strokeStyle = 'rgba(255,255,255,0.15)';
  viewCtx.lineWidth = 1;
  viewCtx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.round((x - viewX) * zoom) + 0.5;
    viewCtx.moveTo(sx, 0); viewCtx.lineTo(sx, view.height);
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.round((y - viewY) * zoom) + 0.5;
    viewCtx.moveTo(0, sy); viewCtx.lineTo(view.width, sy);
  }
  viewCtx.stroke();
}

function drawOverlays() {
  const marks = [];
  if (show.ports && overlays.ports)
    for (const p of overlays.ports) marks.push({ x: p.x, y: p.y, name: p.name, color: '#ff4d4d' });
  if (show.towns && overlays.towns)
    for (const t of overlays.towns) marks.push({ x: t.x, y: t.z, name: t.name, color: '#ffd24d' });
  if (show.ruins && overlays.ruins)
    for (const r of overlays.ruins) marks.push({ x: r.x, y: r.z, name: r.name, color: '#c07dff' });
  if (show.villages && overlays.villages)
    for (const v of overlays.villages) marks.push({ x: v.x, y: v.y, name: v.name, color: '#5dff8a' });
  const r = Math.max(2.5, zoom * 0.3);
  viewCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
  viewCtx.textBaseline = 'bottom';
  for (const m of marks) {
    const sx = (m.x - viewX) * zoom, sy = (m.y - viewY) * zoom;
    if (sx < -60 || sy < -20 || sx > view.width + 60 || sy > view.height + 20) continue;
    viewCtx.fillStyle = m.color;
    viewCtx.beginPath();
    viewCtx.arc(sx, sy, r, 0, 7);
    viewCtx.fill();
    if (zoom >= 4) viewCtx.fillText(m.name, sx + r + 3, sy - r);
  }
}

function drawPreviews() {
  viewCtx.lineWidth = 1;
  if (rectStart && rectCur) {
    const x0 = Math.min(rectStart.x, rectCur.x), x1 = Math.max(rectStart.x, rectCur.x);
    const y0 = Math.min(rectStart.y, rectCur.y), y1 = Math.max(rectStart.y, rectCur.y);
    viewCtx.strokeStyle = '#4fd8ff';
    viewCtx.strokeRect((x0 - viewX) * zoom, (y0 - viewY) * zoom, (x1 - x0 + 1) * zoom, (y1 - y0 + 1) * zoom);
  } else if (hoverTile && tool === 'brush') {
    const r = (brushSize - 1) / 2;
    viewCtx.strokeStyle = 'rgba(255,255,255,0.7)';
    viewCtx.strokeRect((hoverTile.x - r - viewX) * zoom, (hoverTile.y - r - viewY) * zoom, brushSize * zoom, brushSize * zoom);
  }
}

// ---------- 视图变换 ----------

function clampView() {
  const vw = view.width / zoom, vh = view.height / zoom;
  viewX = vw >= W ? (W - vw) / 2 : clamp(viewX, 0, W - vw);
  viewY = vh >= H ? (H - vh) / 2 : clamp(viewY, 0, H - vh);
}

function zoomAt(mx, my, factor) {
  const tx = viewX + mx / zoom, ty = viewY + my / zoom;
  zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
  viewX = tx - mx / zoom;
  viewY = ty - my / zoom;
  clampView();
  zoomLabel.textContent = zoomText();
  render();
}

function eventTile(e) {
  const r = view.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const tx = Math.floor(viewX + mx / zoom), ty = Math.floor(viewY + my / zoom);
  return { x: wrapX(tx), y: wrapY(ty), mx, my };
}

function updateStatus(t) {
  const id = grid[t.y * W + t.x];
  statusEl.textContent =
    `坐标 (${t.x}, ${t.y})　tile id: ${id}${id >= 1 && id <= 32 ? '（可航行水域）' : ''}　缩放 ${zoomText()}`;
}

// ---------- 鼠标交互 ----------

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('wheel', (e) => {
  e.preventDefault();
  const t = eventTile(e);
  zoomAt(t.mx, t.my, e.deltaY < 0 ? 1.25 : 0.8);
}, { passive: false });

view.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const t = eventTile(e);
  if (e.button === 1 || e.button === 2 || (e.button === 0 && tool === 'pan')) {
    panning = { mx: t.mx, my: t.my, vx: viewX, vy: viewY };
    view.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  if (e.altKey || tool === 'picker') { pickTile(t.x, t.y); return; }
  stroke = new Map();
  if (tool === 'brush') {
    painting = true;
    lastPaint = { x: t.x, y: t.y };
    applyBrush(t.x, t.y, curTile);
    render();
  } else if (tool === 'rect') {
    rectStart = { x: t.x, y: t.y };
    rectCur = rectStart;
    render();
  } else if (tool === 'fill') {
    floodFill(t.x, t.y, curTile);
    commitStroke();
    render();
  }
});

window.addEventListener('mousemove', (e) => {
  const r = view.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  if (panning) {
    viewX = panning.vx - (mx - panning.mx) / zoom;
    viewY = panning.vy - (my - panning.my) / zoom;
    clampView();
    render();
    return;
  }
  if (mx < 0 || my < 0 || mx >= r.width || my >= r.height) {
    if (hoverTile) { hoverTile = null; render(); }
    return;
  }
  const t = eventTile(e);
  hoverTile = { x: t.x, y: t.y };
  updateStatus(t);
  if (painting) {
    paintLine(lastPaint.x, lastPaint.y, t.x, t.y, curTile);
    lastPaint = { x: t.x, y: t.y };
    render();
  } else if (rectStart) {
    rectCur = { x: t.x, y: t.y };
    render();
  } else {
    render();
  }
});

window.addEventListener('mouseup', () => {
  if (panning) {
    panning = null;
    view.style.cursor = tool === 'pan' ? 'grab' : 'crosshair';
    return;
  }
  if (painting) {
    painting = false;
    lastPaint = null;
    commitStroke();
  } else if (rectStart && rectCur) {
    const x0 = Math.min(rectStart.x, rectCur.x), x1 = Math.max(rectStart.x, rectCur.x);
    const y0 = Math.min(rectStart.y, rectCur.y), y1 = Math.max(rectStart.y, rectCur.y);
    fillRect(x0, y0, x1, y1, curTile);
    rectStart = rectCur = null;
    commitStroke();
    render();
  }
});

view.addEventListener('mouseleave', () => {
  hoverTile = null;
  statusEl.textContent = '就绪';
  if (!panning && !painting && !rectStart) render();
});

// ---------- 图块面板 ----------

function setCurTile(id) {
  curTile = clamp(id, 1, atlas.count);
  curTileEl.textContent = `${curTile}${curTile <= 32 ? '（水域）' : ''}`;
  drawPalette();
}

function pickTile(x, y) {
  setCurTile(grid[y * W + x]);
  toast(`已取色 tile id ${curTile}`);
}

function drawPalette() {
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, palette.width, palette.height);
  pctx.drawImage(tilesImg, 0, 0, palette.width, palette.height); // 256×128 → 512×256，2 倍显示
  const i = curTile - 1;
  const cx = (i % 16) * 32, cy = ((i / 16) | 0) * 32;
  pctx.strokeStyle = '#ffdd33';
  pctx.lineWidth = 2;
  pctx.strokeRect(cx + 1, cy + 1, 30, 30);
}

palette.addEventListener('click', (e) => {
  const r = palette.getBoundingClientRect();
  const col = Math.floor((e.clientX - r.left) / r.width * 16);
  const row = Math.floor((e.clientY - r.top) / r.height * 8);
  setCurTile(clamp(row, 0, 7) * 16 + clamp(col, 0, 15) + 1);
});

// ---------- 工具栏 ----------

const toolBtns = [...document.querySelectorAll('[data-tool]')];
function setTool(t) {
  tool = t;
  for (const b of toolBtns) b.classList.toggle('active', b.dataset.tool === t);
  view.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
  render();
}
for (const b of toolBtns) b.onclick = () => setTool(b.dataset.tool);

document.getElementById('brush-size').onchange = (e) => { brushSize = +e.target.value; render(); };
document.getElementById('zoom-in').onclick = () => zoomAt(view.width / 2, view.height / 2, 1.25);
document.getElementById('zoom-out').onclick = () => zoomAt(view.width / 2, view.height / 2, 0.8);
undoBtn.onclick = undo;
redoBtn.onclick = redo;

for (const [id, key] of [['ov-grid', 'grid'], ['ov-ports', 'ports'], ['ov-towns', 'towns'], ['ov-ruins', 'ruins'], ['ov-villages', 'villages']]) {
  document.getElementById(id).onchange = (e) => { show[key] = e.target.checked; render(); };
}

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
  else if (k === 'z') { e.preventDefault(); undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
});

// ---------- 导入 / 导出 ----------

document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.bin');
  if (!f) return;
  if (f.buffer.byteLength !== LEN) {
    toast(`导入失败：${f.name} 长度为 ${f.buffer.byteLength} 字节，应为 ${LEN}`);
    return;
  }
  grid.set(new Uint8Array(f.buffer));
  offCtx.drawImage(renderGridToCanvas(grid, W, H, atlas), 0, 0);
  undoStack.length = 0;
  redoStack.length = 0;
  updateUndoButtons();
  dirty.mark();
  render();
  toast(`已导入 ${f.name}`);
};

document.getElementById('btn-export').onclick = () => {
  saveFile('world_map.bin', grid);
  dirty.clear();
};

// ---------- 初始化 ----------

function resize() {
  view.width = wrap.clientWidth;
  view.height = wrap.clientHeight;
  clampView();
  render();
}
new ResizeObserver(resize).observe(wrap);

resize();
// 初始视野居中
viewX = (W - view.width / zoom) / 2;
viewY = (H - view.height / zoom) / 2;
clampView();
setCurTile(1);
zoomLabel.textContent = zoomText();
statusEl.textContent = '就绪';
render();
