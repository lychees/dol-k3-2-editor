// ports.js — 港口编辑器 (ports.json + port_meta.json)
// ports.json: [{ id, name, x, y }] — 世界地图坐标（2160×1080）
// port_meta.json: { "<id>": { name, tileset, region, buildings: { "<bid>": [x, y] }, maid? } }
import {
  loadJSON, loadBinary, loadImage, saveFile, toJSONBlob, pickFile,
  el, pageHeader, makeDirty, makeAtlas, renderGridToCanvas, toast, clamp,
} from './common.js';

pageHeader('港口编辑器', 'ports.json · port_meta.json — 132 港口');

const MW = 2160, MH = 1080;      // 世界地图尺寸（tile）
const MAPW = 760, MAPH = 380;    // 小地图显示尺寸（px）
const SX = MAPW / MW, SY = MAPH / MH;
const PM = 96, PMS = 384;        // 港口地图 96×96 tile → 384×384 px（4px/tile）

const dirty = makeDirty();

// ---------- 数据加载 ----------
const [ports, metas, goods, maids, buildingNames, worldBin, tilesImg, portmaps] = await Promise.all([
  loadJSON('ports.json'),
  loadJSON('port_meta.json'),
  loadJSON('goods.json'),
  loadJSON('maids.json'),
  loadJSON('building_names.json'),
  loadBinary('world_map.bin'),
  loadImage('tiles_day.png'),
  loadBinary('portmaps.bin'),
]);

const REGIONS = Object.keys(goods.regions);
const BUILDING_IDS = Object.keys(buildingNames).map(Number).sort((a, b) => a - b);

const worldCanvas = renderGridToCanvas(worldBin, MW, MH, makeAtlas(tilesImg, 16, 16));

// 港口图块集按 tileset 懒加载缓存（NNN = 2*tileset，3 位零填充）
const portAtlases = {};
function getPortAtlas(ts) {
  if (!portAtlases[ts]) {
    const nnn = String(2 * ts).padStart(3, '0');
    portAtlases[ts] = loadImage(`portchips/${nnn}_day.png`).then(img => makeAtlas(img, 16, 16));
  }
  return portAtlases[ts];
}

// 港口 id → portmaps.bin 中的地图索引（与 main.js PORT_MAP_OVERRIDE 一致）
function portMapIdx(pid) {
  return ({ 131: 94, 132: 0 })[pid] ?? Math.min(pid - 1, 100);
}

// ---------- 状态 ----------
let selectedId = null;   // 选中港口 id（number）
let selectedBld = null;  // 选中建筑 id（string）

const mapCanvas = document.getElementById('map');
const portCanvas = document.getElementById('portmap');
const listEl = document.getElementById('list');
const filterEl = document.getElementById('filter');
const formEl = document.getElementById('form');
const editorEl = document.getElementById('editor');
const emptyEl = document.getElementById('empty');
const metaTipEl = document.getElementById('meta-tip');
const metaBodyEl = document.getElementById('meta-body');
const bldBodyEl = document.getElementById('bld-body');
const bldAddSel = document.getElementById('bld-add-sel');

let xInput = null, yInput = null; // 表单中的坐标输入框（拖动时同步）

const getPort = id => ports.find(p => p.id === id);
const getMeta = id => metas[String(id)] || null;
const abbr = name => (name.length > 6 ? name.slice(0, 5) + '…' : name);

function selectPort(id) {
  selectedId = id;
  selectedBld = null;
  renderList();
  renderForm();
  drawMap();
  renderPortMap();
}

// ---------- 世界小地图 ----------
function drawMap() {
  const ctx = mapCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(worldCanvas, 0, 0, MAPW, MAPH);
  ctx.font = '9px monospace';
  ctx.textBaseline = 'bottom';
  for (const p of ports) {
    const px = p.x * SX, py = p.y * SY;
    const sel = p.id === selectedId;
    ctx.fillStyle = sel ? '#ffd54f' : '#ff5f5f';
    ctx.beginPath();
    ctx.arc(px, py, sel ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sel ? '#ffd54f' : 'rgba(255,255,255,.85)';
    ctx.fillText(sel ? p.name : abbr(p.name), px + 4, py - 2);
  }
}

function hitPort(mx, my) {
  let best = null, bestD = 8; // 8px 命中半径
  for (const p of ports) {
    const d = Math.hypot(p.x * SX - mx, p.y * SY - my);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

let dragging = null, dragMoved = false;
mapCanvas.addEventListener('mousedown', e => {
  const r = mapCanvas.getBoundingClientRect();
  const p = hitPort(e.clientX - r.left, e.clientY - r.top);
  if (!p) return;
  if (p.id !== selectedId) selectPort(p.id);
  dragging = p;
  dragMoved = false;
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!dragging) return;
  const r = mapCanvas.getBoundingClientRect();
  const nx = clamp(Math.round((e.clientX - r.left) / SX), 0, MW - 1);
  const ny = clamp(Math.round((e.clientY - r.top) / SY), 0, MH - 1);
  if (nx === dragging.x && ny === dragging.y) return;
  dragging.x = nx;
  dragging.y = ny;
  dragMoved = true;
  if (xInput) xInput.value = nx;
  if (yInput) yInput.value = ny;
  drawMap();
});
window.addEventListener('mouseup', () => {
  if (dragging && dragMoved) dirty.mark();
  dragging = null;
});

// ---------- 港口列表 ----------
function renderList() {
  listEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  for (const p of [...ports].sort((a, b) => a.id - b.id)) {
    const label = `${p.id} ${p.name}`;
    if (q && !label.toLowerCase().includes(q)) continue;
    const item = el('div', {
      class: 'item' + (p.id === selectedId ? ' selected' : ''),
      text: label + (getMeta(p.id) ? '' : '（无 meta）'),
    });
    item.onclick = () => selectPort(p.id);
    listEl.append(item);
  }
}
filterEl.oninput = renderList;

// ---------- 表单 ----------
function renderForm() {
  const p = selectedId == null ? null : getPort(selectedId);
  if (!p) { editorEl.style.display = 'none'; emptyEl.style.display = ''; return; }
  editorEl.style.display = '';
  emptyEl.style.display = 'none';
  formEl.innerHTML = '';
  const meta = getMeta(p.id);

  formEl.append(el('label', { text: 'id' }));
  formEl.append(el('input', { type: 'number', value: p.id, disabled: '' }));

  formEl.append(el('label', { text: '名称' }));
  const nameInput = el('input', { type: 'text', value: p.name });
  nameInput.onchange = () => {
    const nn = nameInput.value.trim();
    if (!nn || nn === p.name) { nameInput.value = p.name; return; }
    p.name = nn;
    if (meta) meta.name = nn; // meta.name 与 ports.json 保持同步
    dirty.mark();
    renderList();
    drawMap();
  };
  formEl.append(nameInput);

  formEl.append(el('label', { text: 'x（0–2159）' }));
  xInput = el('input', { type: 'number', value: p.x, min: 0, max: MW - 1 });
  xInput.onchange = () => {
    p.x = clamp(Math.round(+xInput.value || 0), 0, MW - 1);
    xInput.value = p.x;
    dirty.mark();
    drawMap();
  };
  formEl.append(xInput);

  formEl.append(el('label', { text: 'y（0–1079）' }));
  yInput = el('input', { type: 'number', value: p.y, min: 0, max: MH - 1 });
  yInput.onchange = () => {
    p.y = clamp(Math.round(+yInput.value || 0), 0, MH - 1);
    yInput.value = p.y;
    dirty.mark();
    drawMap();
  };
  formEl.append(yInput);

  if (!meta) {
    metaBodyEl.style.display = 'none';
    metaTipEl.textContent = '';
    formEl.append(el('label', { text: 'port_meta' }));
    const createBtn = el('button', { type: 'button', text: '创建 meta' });
    createBtn.onclick = () => {
      metas[String(p.id)] = { name: p.name, tileset: 0, region: 'Iberia', buildings: {} };
      dirty.mark();
      renderForm();
      renderList();
      renderPortMap();
      toast(`已创建港口 ${p.id} 的 meta`);
    };
    formEl.append(createBtn);
    metaTipEl.textContent = '该港口暂无 port_meta 数据（region / tileset / maid / 建筑需要先创建 meta）。';
    return;
  }

  metaBodyEl.style.display = '';
  metaTipEl.textContent = `港口地图索引 ${portMapIdx(p.id)} · 图块集 ${String(2 * meta.tileset).padStart(3, '0')}_day.png`;

  formEl.append(el('label', { text: 'region' }));
  const regionSel = el('select', {},
    ...REGIONS.map(r => el('option', { value: r, text: r, selected: r === meta.region ? '' : null })));
  regionSel.onchange = () => { meta.region = regionSel.value; dirty.mark(); };
  formEl.append(regionSel);

  formEl.append(el('label', { text: 'tileset（0–6）' }));
  const tsSel = el('select', {},
    ...[0, 1, 2, 3, 4, 5, 6].map(t => el('option', { value: t, text: t, selected: t === meta.tileset ? '' : null })));
  tsSel.onchange = () => {
    meta.tileset = +tsSel.value;
    dirty.mark();
    renderPortMap();
    metaTipEl.textContent = `港口地图索引 ${portMapIdx(p.id)} · 图块集 ${String(2 * meta.tileset).padStart(3, '0')}_day.png`;
  };
  formEl.append(tsSel);

  formEl.append(el('label', { text: 'maid' }));
  const maidSel = el('select', {},
    el('option', { value: '', text: '（无）', selected: meta.maid == null ? '' : null }),
    ...Object.keys(maids).sort((a, b) => +a - +b).map(id =>
      el('option', { value: id, text: `${id} ${maids[id].name}`, selected: meta.maid === +id ? '' : null })));
  maidSel.onchange = () => {
    if (maidSel.value === '') delete meta.maid;
    else meta.maid = +maidSel.value;
    dirty.mark();
  };
  formEl.append(maidSel);

  renderBuildings();
}

// ---------- 建筑表格 ----------
function renderBuildings() {
  const meta = getMeta(selectedId);
  bldBodyEl.innerHTML = '';
  if (!meta) return;
  if (selectedBld != null && !meta.buildings[selectedBld]) selectedBld = null;

  const bids = Object.keys(meta.buildings).sort((a, b) => +a - +b);
  for (const bid of bids) {
    const [bx, by] = meta.buildings[bid];
    const tr = el('tr', { class: bid === selectedBld ? 'selected' : '' });
    tr.onclick = () => { selectedBld = bid; renderBuildings(); renderPortMap(); };

    const xi = el('input', { type: 'number', value: bx, min: 0, max: PM - 1 });
    xi.onclick = e => e.stopPropagation();
    xi.onchange = () => {
      meta.buildings[bid][0] = clamp(Math.round(+xi.value || 0), 0, PM - 1);
      xi.value = meta.buildings[bid][0];
      dirty.mark();
      renderPortMap();
    };
    const yi = el('input', { type: 'number', value: by, min: 0, max: PM - 1 });
    yi.onclick = e => e.stopPropagation();
    yi.onchange = () => {
      meta.buildings[bid][1] = clamp(Math.round(+yi.value || 0), 0, PM - 1);
      yi.value = meta.buildings[bid][1];
      dirty.mark();
      renderPortMap();
    };
    const delBtn = el('button', { type: 'button', class: 'danger', text: '删除' });
    delBtn.onclick = e => {
      e.stopPropagation();
      if (!confirm(`删除建筑 ${bid}（${buildingNames[bid] || '?'}）？`)) return;
      delete meta.buildings[bid];
      if (selectedBld === bid) selectedBld = null;
      dirty.mark();
      renderBuildings();
      renderPortMap();
    };

    tr.append(
      el('td', { text: bid }),
      el('td', { text: buildingNames[bid] || '?' }),
      el('td', {}, xi),
      el('td', {}, yi),
      el('td', {}, delBtn),
    );
    bldBodyEl.append(tr);
  }

  // 添加建筑下拉：只列尚未拥有的建筑
  bldAddSel.innerHTML = '';
  const missing = BUILDING_IDS.filter(id => !meta.buildings[String(id)]);
  for (const id of missing) {
    bldAddSel.append(el('option', { value: id, text: `${id} ${buildingNames[id]}` }));
  }
  document.getElementById('bld-add-btn').disabled = missing.length === 0;
}

document.getElementById('bld-add-btn').onclick = () => {
  const meta = getMeta(selectedId);
  if (!meta || !bldAddSel.value) return;
  const bid = bldAddSel.value;
  meta.buildings[bid] = [48, 48]; // 默认放在地图中央
  selectedBld = bid;
  dirty.mark();
  renderBuildings();
  renderPortMap();
};

// ---------- 港口地图 ----------
let pmToken = 0;
async function renderPortMap() {
  const token = ++pmToken;
  const ctx = portCanvas.getContext('2d');
  ctx.clearRect(0, 0, PMS, PMS);
  if (selectedId == null) return;
  const meta = getMeta(selectedId);
  const ts = meta ? meta.tileset : 0;

  let atlas;
  try {
    atlas = await getPortAtlas(ts);
  } catch (e) {
    if (token === pmToken) toast(e.message);
    return;
  }
  if (token !== pmToken) return;

  const idx = portMapIdx(selectedId);
  const src = portmaps.subarray(idx * PM * PM, (idx + 1) * PM * PM);
  const grid = new Uint8Array(PM * PM); // 文件 0-based → 图集 1-based
  for (let i = 0; i < grid.length; i++) grid[i] = src[i] + 1;
  const c = renderGridToCanvas(grid, PM, PM, atlas);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, 0, 0, PMS, PMS);

  if (!meta) return;
  const k = PMS / PM; // 4 px/tile
  ctx.font = 'bold 9px monospace';
  ctx.textBaseline = 'middle';
  for (const [bid, [bx, by]] of Object.entries(meta.buildings)) {
    const cx = bx * k + k / 2, cy = by * k + k / 2;
    const sel = bid === selectedBld;
    ctx.fillStyle = sel ? '#ffd54f' : '#ff5f5f';
    ctx.strokeStyle = '#10141c';
    ctx.beginPath();
    ctx.rect(cx - 6, cy - 6, 12, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#10141c';
    ctx.textAlign = 'center';
    ctx.fillText(bid, cx, cy + 0.5);
  }
  ctx.textAlign = 'left';
}

portCanvas.addEventListener('click', e => {
  const meta = getMeta(selectedId);
  if (!meta) return;
  if (selectedBld == null || !meta.buildings[selectedBld]) {
    toast('请先在建筑表格中选中一行');
    return;
  }
  const r = portCanvas.getBoundingClientRect();
  const tx = clamp(Math.floor((e.clientX - r.left) / (PMS / PM)), 0, PM - 1);
  const ty = clamp(Math.floor((e.clientY - r.top) / (PMS / PM)), 0, PM - 1);
  meta.buildings[selectedBld] = [tx, ty];
  dirty.mark();
  renderBuildings();
  renderPortMap();
});

// ---------- 工具栏 ----------
document.getElementById('btn-add').onclick = () => {
  const id = ports.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  ports.push({ id, name: 'New Port', x: 0, y: 0 });
  metas[String(id)] = { name: 'New Port', tileset: 0, region: 'Iberia', buildings: {} };
  dirty.mark();
  selectPort(id);
  toast(`已新增港口 ${id}，请在地图上拖动定位`);
};

document.getElementById('btn-del').onclick = () => {
  const p = selectedId == null ? null : getPort(selectedId);
  if (!p) return;
  if (!confirm(`删除港口 ${p.id} ${p.name}？（ports.json 与 port_meta.json 中都会删除）`)) return;
  ports.splice(ports.indexOf(p), 1);
  delete metas[String(p.id)];
  selectedId = null;
  selectedBld = null;
  dirty.mark();
  renderList();
  renderForm();
  drawMap();
  renderPortMap();
};

document.getElementById('btn-export-ports').onclick = () => {
  saveFile('ports.json', toJSONBlob(ports));
  dirty.clear();
};
document.getElementById('btn-export-meta').onclick = () => {
  saveFile('port_meta.json', toJSONBlob(metas));
  dirty.clear();
};

document.getElementById('btn-import-ports').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const data = JSON.parse(new TextDecoder().decode(f.buffer));
    if (!Array.isArray(data)) throw new Error('ports.json 应为数组');
    ports.length = 0;
    ports.push(...data);
    selectedId = null;
    selectedBld = null;
    dirty.mark();
    renderList();
    renderForm();
    drawMap();
    renderPortMap();
    toast(`已导入 ${f.name}`);
  } catch (e) { toast('JSON 解析失败: ' + e.message); }
};
document.getElementById('btn-import-meta').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const data = JSON.parse(new TextDecoder().decode(f.buffer));
    if (Array.isArray(data) || typeof data !== 'object' || !data) throw new Error('port_meta.json 应为对象');
    for (const k of Object.keys(metas)) delete metas[k];
    Object.assign(metas, data);
    selectedBld = null;
    dirty.mark();
    renderList();
    renderForm();
    renderPortMap();
    toast(`已导入 ${f.name}`);
  } catch (e) { toast('JSON 解析失败: ' + e.message); }
};

// ---------- 初始化 ----------
renderList();
renderForm();
drawMap();
