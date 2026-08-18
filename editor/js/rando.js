// rando.js — 随机地图查看器（randomizer 种子预览）
// 只读：与游戏内 main.js 的 randomizer 调用严格一致，同种子同选项得到同一世界。
import {
  loadJSON, loadImage, saveFile,
  pageHeader, makeAtlas, renderGridToCanvas, toast, clamp,
} from './common.js';
import { hashSeed, mulberry32, generateWorldMap, applyRandomizer } from './randomizer.js';

pageHeader('随机地图查看器', 'randomizer 种子预览 — 与游戏内生成结果一致');

const W = 2160, H = 1080, LEN = W * H;
const MIN_ZOOM = 1, MAX_ZOOM = 24;
// main.js: SAILABLE = ids 1..32
const isWater = (id) => id >= 1 && id <= 32;

// ---------- 数据加载 ----------

const [tilesImg, ports, villages, portMeta, goodsData] = await Promise.all([
  loadImage('tiles_day.png'),
  loadJSON('ports.json'),
  loadJSON('villages.json'),
  loadJSON('port_meta.json'),
  loadJSON('goods.json'),
]);
const atlas = makeAtlas(tilesImg, 16, 16);

// ---------- 状态 ----------

let grid = null;              // 生成的地图（Uint8Array，1-based tile id）
let off = null;               // 离屏全图 canvas（2160×1080，1px/tile）
let sealedLakes = 0;
let seedStr = '';
let reloc = null;             // { ports, villages } 重定位后的坐标
let landPctActual = 0;

let zoom = 1;                 // px/tile
let viewX = 0, viewY = 0;     // 视口左上角的世界 tile 坐标（可为小数）
let panning = null;           // { mx, my, vx, vy }

// ---------- DOM ----------

const wrap = document.getElementById('wrap');
const view = document.getElementById('view');
const viewCtx = view.getContext('2d');
const statusEl = document.getElementById('status');
const zoomLabel = document.getElementById('zoom-label');
const statsEl = document.getElementById('stats');
const seedInput = document.getElementById('seed');
const genBtn = document.getElementById('btn-gen');
const landpctInput = document.getElementById('opt-landpct');
const landpctLabel = document.getElementById('landpct-label');
const show = { reloc: true, orig: false };

// ---------- 生成 ----------

function buildGeoLists() {
  // 与 main.js buildGeoLists 一致：coast = 四邻居（环绕）中有水域的陆地
  const landList = [], coastList = [];
  const waterAt = (x, z) =>
    isWater(grid[(((z % H) + H) % H) * W + (((x % W) + W) % W)]);
  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      if (!isWater(grid[z * W + x])) {
        landList.push(x, z);
        if (waterAt(x + 1, z) || waterAt(x - 1, z) ||
            waterAt(x, z + 1) || waterAt(x, z - 1)) {
          coastList.push(x, z);
        }
      }
    }
  }
  const snapCoast = rnd => {
    const i = Math.floor(rnd() * (coastList.length / 2)) * 2;
    return [coastList[i], coastList[i + 1]];
  };
  const snapLand = rnd => {
    const i = Math.floor(rnd() * (landList.length / 2)) * 2;
    return [landList[i], landList[i + 1]];
  };
  return { snapCoast, snapLand };
}

function relocate(snapCoast, snapLand) {
  // 深拷贝后传入 applyRandomizer，不污染原始数据
  const portsCopy = ports.map(p => ({ ...p }));
  const villagesCopy = villages.map(v => ({ ...v, img: v.img ? [...v.img] : v.img }));
  const goodsCopy = structuredClone(goodsData);
  applyRandomizer(
    { seed: seedStr, markets: false, specialties: false, startShip: false,
      portDev: false, portLocations: true, discoveries: true },
    { goodsData: goodsCopy, villages: villagesCopy, ports: portsCopy, portMeta,
      portRegion: pid => (portMeta[pid] ?? portMeta[Math.min(pid, 101)])?.region,
      portDev: {}, snapCoast, snapLand,
      ships: [] });
  return { ports: portsCopy, villages: villagesCopy };
}

async function generate() {
  seedStr = seedInput.value.trim();
  if (!seedStr) { toast('请输入种子（或点「随机种子」）'); return; }
  genBtn.disabled = true;
  genBtn.textContent = '生成中…';
  statusEl.textContent = '生成中…（2160×1080，约需一两秒）';
  // 让状态文本先渲染出来再跑 CPU 密集的生成
  await new Promise(r => setTimeout(r, 30));
  try {
    // 与 main.js:184 严格一致
    const opts = {
      landPct: +landpctInput.value,
      continents: document.getElementById('opt-cont').value,
      riverCount: +document.getElementById('opt-rivers').value,
      mountCount: +document.getElementById('opt-mount').value,
      polar: document.getElementById('opt-polar').checked,
      coastSmoothing: document.getElementById('opt-coast').checked,
    };
    const t0 = performance.now();
    const res = generateWorldMap(
      mulberry32(hashSeed(seedStr) ^ 0x9e3779b9), W, H, 1, [74, 66, 82], opts);
    grid = res.data;
    sealedLakes = res.sealedLakes;
    off = renderGridToCanvas(grid, W, H, atlas);

    let land = 0;
    for (let i = 0; i < LEN; i++) if (!isWater(grid[i])) land++;
    landPctActual = land / LEN;

    const { snapCoast, snapLand } = buildGeoLists();
    reloc = relocate(snapCoast, snapLand);

    const ms = Math.round(performance.now() - t0);
    statsEl.innerHTML =
      `种子：<b>${escapeHtml(seedStr)}</b><br>` +
      `hashSeed：<b>${hashSeed(seedStr)}</b>（0x${hashSeed(seedStr).toString(16).padStart(8, '0')}）<br>` +
      `实际陆地占比：<b>${(landPctActual * 100).toFixed(1)}%</b><br>` +
      `封闭湖泊（已填平）：<b>${sealedLakes}</b> 格<br>` +
      `生成耗时：${ms} ms`;
    statusEl.textContent = '就绪';
    render();
  } catch (e) {
    console.error(e);
    statusEl.textContent = `生成失败：${e.message}`;
    toast(`生成失败：${e.message}`);
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = '生成';
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 渲染 ----------

function zoomText() { return `${+zoom.toFixed(2)} px/tile`; }

function render() {
  viewCtx.imageSmoothingEnabled = zoom < 2;
  viewCtx.setTransform(1, 0, 0, 1, 0, 0);
  viewCtx.fillStyle = '#0b0f16';
  viewCtx.fillRect(0, 0, view.width, view.height);
  if (!off) return;
  viewCtx.drawImage(off, -viewX * zoom, -viewY * zoom, W * zoom, H * zoom);
  drawMarkers();
}

function drawMarkers() {
  const r = Math.max(2.5, zoom * 0.3);
  viewCtx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
  viewCtx.textBaseline = 'bottom';
  const dot = (x, y, name, color, withName) => {
    const sx = (x - viewX) * zoom, sy = (y - viewY) * zoom;
    if (sx < -60 || sy < -20 || sx > view.width + 60 || sy > view.height + 20) return;
    viewCtx.fillStyle = color;
    viewCtx.beginPath();
    viewCtx.arc(sx, sy, r, 0, 7);
    viewCtx.fill();
    if (withName && zoom >= 4) viewCtx.fillText(name, sx + r + 3, sy - r);
  };
  // 原始港口位置（对比用，灰点）
  if (show.orig) {
    for (const p of ports) dot(p.x, p.y, p.name, 'rgba(160,160,160,0.7)', false);
  }
  // 重定位后的港口（红点+名字）与发现物（绿点）
  if (show.reloc && reloc) {
    for (const v of reloc.villages) dot(v.x, v.y, v.name, '#5dff8a', false);
    for (const p of reloc.ports) dot(p.x, p.y, p.name, '#ff4d4d', true);
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

function eventPos(e) {
  const r = view.getBoundingClientRect();
  return { mx: e.clientX - r.left, my: e.clientY - r.top };
}

function updateStatus(mx, my) {
  const tx = Math.floor(viewX + mx / zoom), ty = Math.floor(viewY + my / zoom);
  if (tx < 0 || ty < 0 || tx >= W || ty >= H || !grid) return;
  const id = grid[ty * W + tx];
  statusEl.textContent =
    `坐标 (${tx}, ${ty})　tile id: ${id}${isWater(id) ? '（可航行水域）' : ''}　缩放 ${zoomText()}`;
}

// ---------- 鼠标交互 ----------

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { mx, my } = eventPos(e);
  zoomAt(mx, my, e.deltaY < 0 ? 1.25 : 0.8);
}, { passive: false });

view.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button === 1 || e.button === 2) {
    const { mx, my } = eventPos(e);
    panning = { mx, my, vx: viewX, vy: viewY };
    view.style.cursor = 'grabbing';
  }
});

window.addEventListener('mousemove', (e) => {
  const { mx, my } = eventPos(e);
  if (panning) {
    viewX = panning.vx - (mx - panning.mx) / zoom;
    viewY = panning.vy - (my - panning.my) / zoom;
    clampView();
    render();
    return;
  }
  const r = view.getBoundingClientRect();
  if (mx < 0 || my < 0 || mx >= r.width || my >= r.height) return;
  updateStatus(mx, my);
});

window.addEventListener('mouseup', () => {
  if (panning) {
    panning = null;
    view.style.cursor = 'crosshair';
  }
});

view.addEventListener('mouseleave', () => {
  statusEl.textContent = grid ? '就绪' : '尚未生成';
});

// ---------- 工具栏 / 侧栏 ----------

landpctInput.oninput = () => {
  landpctLabel.textContent = `${Math.round(+landpctInput.value * 100)}%`;
};

document.getElementById('btn-randseed').onclick = () => {
  seedInput.value = String(Math.floor(Math.random() * 1e9));
  generate();
};
genBtn.onclick = generate;
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') generate();
});

document.getElementById('zoom-in').onclick = () => zoomAt(view.width / 2, view.height / 2, 1.25);
document.getElementById('zoom-out').onclick = () => zoomAt(view.width / 2, view.height / 2, 0.8);

document.getElementById('ov-reloc').onchange = (e) => { show.reloc = e.target.checked; render(); };
document.getElementById('ov-orig').onchange = (e) => { show.orig = e.target.checked; render(); };

document.getElementById('btn-export').onclick = () => {
  if (!off) { toast('请先生成地图'); return; }
  off.toBlob((blob) => {
    if (blob) saveFile(`rando_${seedStr}.png`, blob, 'image/png');
  }, 'image/png');
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
viewX = (W - view.width / zoom) / 2;
viewY = (H - view.height / zoom) / 2;
clampView();
zoomLabel.textContent = zoomText();
statusEl.textContent = '就绪';
render();
generate();
