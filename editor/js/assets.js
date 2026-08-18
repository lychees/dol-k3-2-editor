// assets.js — 资产浏览器（只读预览 game/assets/ 下全部文件，清单见 manifest.js）
import { assetURL, probeAssets, el, pageHeader } from './common.js';
import { ASSET_FILES } from './manifest.js';

pageHeader('资产浏览器', `game/assets/ — ${ASSET_FILES.length} 个文件`);

await probeAssets(); // 先确定资产 base（本地 ../assets/ 或远程 Pages）
const url = (p) => assetURL(encodeURI(p)); // 音乐文件名含空格，需编码
const base = (p) => p.slice(p.lastIndexOf('/') + 1);

function fileType(p) {
  const e = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
  if (e === 'png') return 'image';
  if (e === 'mp3' || e === 'ogg') return 'audio';
  if (e === 'json') return 'json';
  if (e === 'bin') return 'bin';
  return 'other';
}

// 已知图集的格网信息（尺寸见 FORMATS.md）；不在表内的图片不提供格网开关
const GRID_INFO = {
  'tiles_dawn.png':  { w: 16, h: 16, cols: 16, note: '世界图块集（黎明相位）：16px 图块，16 列，id 1-based 行优先' },
  'tiles_day.png':   { w: 16, h: 16, cols: 16, note: '世界图块集（白天相位）：16px 图块，16 列 × 8 行（id 1–128），1-based 行优先' },
  'tiles_dusk.png':  { w: 16, h: 16, cols: 16, note: '世界图块集（黄昏相位）：16px 图块，16 列，id 1-based 行优先' },
  'tiles_night.png': { w: 16, h: 16, cols: 16, note: '世界图块集（夜晚相位）：16px 图块，16 列，id 1-based 行优先' },
  'figures.png':     { w: 65, h: 81, cols: 16, note: '伙伴/女郎头像：65×81 格，16 列 × 8 行，1-based [列,行]（游戏绘制内缩 3px）' },
  'discoveries.png': { w: 49, h: 49, cols: 16, note: '发现物图集：49px 格，16 列 × 8 行，1-based [列,行]，无前边距' },
  'heroes.png':      { w: 68, h: 68, cols: 8,  note: '主角行走图：68px 格，8 列 × 9 行（6 主角 × 8 帧）' },
  'npc_atlas.png':   { w: 32, h: 32, cols: 16, note: 'NPC 图集：32px 格，16 列（40 角色，行 = 方向 down/left/right/up）' },
};
function gridInfo(p) {
  if (p.startsWith('portchips/'))
    return { w: 16, h: 16, cols: 16, note: '港口图块集：16px 图块，16 列 × 15 行（256×240），显示 id = 文件 id + 1' };
  return GRID_INFO[p] || null;
}

const BIN_INFO = {
  'world_map.bin': '世界地图：2160 × 1080 字节，每字节一个 1-based tile id（行优先）；id 1–32 为可航行水域，图块集 tiles_day.png 等四相位。',
  'portmaps.bin': '港口地图：101 张 96×96 地图连续排列（0-based tile id），共 930816 字节；图块集 portchips/NNN_<phase>.png。',
};

const ZOOMS = [25, 50, 100, 200, 400, 800];

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function fetchSize(path) {
  try {
    const r = await fetch(url(path), { method: 'HEAD' });
    const n = Number(r.headers.get('content-length'));
    return r.ok && Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

// ---------- 左侧文件树 ----------

const treeEl = document.getElementById('tree');
const filterEl = document.getElementById('filter');
const viewerEl = document.getElementById('viewer');
const emptyEl = document.getElementById('empty');
let selected = null;
let onResize = null; // 当前视图需要响应窗口缩放时设置（图片「适应宽度」）
window.addEventListener('resize', () => onResize && onResize());

const groups = [];
{
  const byDir = new Map();
  for (const p of ASSET_FILES) {
    const i = p.lastIndexOf('/');
    const dir = i < 0 ? '' : p.slice(0, i);
    if (!byDir.has(dir)) { const g = { dir, files: [], collapsed: false }; byDir.set(dir, g); groups.push(g); }
    byDir.get(dir).files.push(p);
  }
}

function renderTree() {
  treeEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  for (const g of groups) {
    const files = q ? g.files.filter(p => base(p).toLowerCase().includes(q)) : g.files;
    if (!files.length) continue;
    const collapsed = g.collapsed && !q; // 筛选时强制展开
    const head = el('div', { class: 'tree-head' },
      (collapsed ? '▸ ' : '▾ ') + (g.dir || '（根目录）') + ' ',
      el('span', { class: 'count', text: `${files.length} 个文件` }));
    head.onclick = () => { g.collapsed = !g.collapsed; renderTree(); };
    const items = el('div', { class: 'tree-items' });
    for (const p of files) {
      const it = el('div', { class: 'item' + (p === selected ? ' selected' : ''), text: base(p), title: p });
      it.onclick = () => { selected = p; renderTree(); renderViewer(); };
      items.append(it);
    }
    treeEl.append(el('div', { class: 'tree-group' + (collapsed ? ' collapsed' : '') }, head, items));
  }
}

// ---------- 主区域预览 ----------

function viewerShell(path) {
  onResize = null;
  viewerEl.innerHTML = '';
  emptyEl.style.display = 'none';
  viewerEl.style.display = '';
  const bar = el('div', { class: 'viewer-bar' },
    el('strong', { text: path }),
    el('a', { href: url(path), target: '_blank', rel: 'noopener', text: '在新标签打开' }));
  viewerEl.append(bar);
  return bar;
}

function renderViewer() {
  if (!selected) { viewerEl.style.display = 'none'; emptyEl.style.display = ''; return; }
  const t = fileType(selected);
  if (t === 'image') showImage(selected);
  else if (t === 'audio') showAudio(selected);
  else if (t === 'json') showJSON(selected);
  else if (t === 'bin') showBin(selected);
  else {
    viewerShell(selected);
    viewerEl.append(el('p', { class: 'hint', text: '暂不支持预览此类型，可在新标签打开查看。' }));
  }
}

function drawGrid(canvas, gi) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255, 90, 90, 0.65)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = gi.w; x < canvas.width; x += gi.w) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); }
  for (let y = gi.h; y < canvas.height; y += gi.h) { ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); }
  ctx.stroke();
}

function showImage(path) {
  const gi = gridInfo(path);
  let zoom = 100; // 百分比，或 'fit'
  const bar = viewerShell(path);

  const img = new Image();
  const overlay = document.createElement('canvas');
  overlay.style.display = 'none';
  const wrap = el('div', { class: 'img-wrap' }, img, overlay);
  const checker = el('div', { class: 'img-checker' }, wrap);
  const info = el('span', { class: 'hint', text: '加载中…' });

  const zoomBtns = ZOOMS.map(z => el('button', { text: z + '%', onclick: () => { zoom = z; applyZoom(); } }));
  const fitBtn = el('button', { text: '适应宽度', onclick: () => { zoom = 'fit'; applyZoom(); } });
  const gridBtn = gi ? el('button', {
    text: '格网',
    onclick: () => {
      const on = overlay.style.display === 'none';
      overlay.style.display = on ? '' : 'none';
      gridBtn.classList.toggle('active', on);
    },
  }) : null;

  bar.append(el('span', { style: 'flex:1' }), ...zoomBtns, fitBtn, gridBtn, info);
  viewerEl.append(checker);
  if (gi) viewerEl.append(el('p', { class: 'hint', text: '格网：' + gi.note }));

  function applyZoom() {
    for (const b of [...zoomBtns, fitBtn]) b.classList.remove('active');
    if (zoom === 'fit') fitBtn.classList.add('active');
    else zoomBtns[ZOOMS.indexOf(zoom)]?.classList.add('active');
    if (!img.naturalWidth) return;
    const z = zoom === 'fit' ? (checker.clientWidth - 16) / img.naturalWidth : zoom / 100;
    wrap.style.width = Math.max(1, Math.round(img.naturalWidth * z)) + 'px';
  }
  onResize = () => { if (zoom === 'fit') applyZoom(); };

  img.onload = async () => {
    overlay.width = img.naturalWidth;
    overlay.height = img.naturalHeight;
    if (gi) drawGrid(overlay, gi);
    const size = await fetchSize(path);
    info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px` + (size ? ` · ${fmtSize(size)}` : '');
    applyZoom();
  };
  img.onerror = () => { info.textContent = '图片加载失败'; };
  img.src = url(path);
}

async function showAudio(path) {
  const bar = viewerShell(path);
  viewerEl.append(el('p', {}, el('audio', { controls: '', preload: 'none', src: url(path) })));
  const size = await fetchSize(path);
  if (size) bar.append(el('span', { class: 'hint', text: fmtSize(size) }));
}

async function showJSON(path) {
  const bar = viewerShell(path);
  const pre = el('pre', { class: 'json-view', text: '加载中…' });
  viewerEl.append(pre);
  try {
    const r = await fetch(url(path));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    bar.append(el('span', { class: 'hint', text: fmtSize(new TextEncoder().encode(text).length) }));
    let pretty;
    try { pretty = JSON.stringify(JSON.parse(text), null, 1); }
    catch { pretty = text; } // 解析失败时显示原文
    const lines = pretty.split('\n');
    if (lines.length > 200) {
      pre.textContent = lines.slice(0, 200).join('\n');
      viewerEl.append(el('p', { class: 'hint', text: `共 ${lines.length} 行，仅显示前 200 行（已截断），完整内容请「在新标签打开」。` }));
    } else {
      pre.textContent = pretty;
    }
  } catch (e) {
    pre.textContent = '加载失败: ' + e.message;
  }
}

async function showBin(path) {
  const bar = viewerShell(path);
  bar.append(el('a', { class: 'btn-link', href: url(path), download: base(path), text: '下载' }));
  viewerEl.append(el('p', { class: 'hint', text: BIN_INFO[path] || '二进制数据文件，无预览，可下载后用十六进制工具查看。' }));
  const size = await fetchSize(path);
  if (size) bar.append(el('span', { class: 'hint', text: fmtSize(size) }));
}

filterEl.oninput = renderTree;
renderTree();
