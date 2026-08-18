// world.js — 发现物 / 城镇 / 遗迹编辑器 (villages.json + towns.json + ruins.json)
// villages: [{ id, name, x, y, desc, img: [col, row], subject }]   img 为 discoveries.png 1-based [列, 行]
// towns:    [{ id, name, x, z }]      z 即世界地图 y 坐标
// ruins:    [{ id, name, x, z, desc }]
import {
  loadBinary, loadJSON, loadImage, saveFile, toJSONBlob, pickFile,
  el, pageHeader, makeDirty, makeAtlas, renderGridToCanvas, toast, clamp,
} from './common.js';

pageHeader('发现物 / 城镇 / 遗迹编辑器', 'villages.json · towns.json · ruins.json');

const WORLD_W = 2160, WORLD_H = 1080;      // 世界地图 tile 尺寸
const MAP_W = 700, MAP_H = 350;            // 小地图显示尺寸
const CELL = 49, COLS = 16, ROWS = 8, ZOOM = 2; // discoveries.png 图集参数

const MODES = {
  villages: { file: 'villages.json', label: '发现物', yKey: 'y', hasDesc: true, hasImg: true, hasSubject: true },
  towns:    { file: 'towns.json',    label: '城镇',   yKey: 'z' },
  ruins:    { file: 'ruins.json',    label: '遗迹',   yKey: 'z', hasDesc: true },
};

const dirty = makeDirty();

const [villages, towns, ruins, discImg, worldBin, tilesImg] = await Promise.all([
  loadJSON('villages.json'), loadJSON('towns.json'), loadJSON('ruins.json'),
  loadImage('discoveries.png'), loadBinary('world_map.bin'), loadImage('tiles_day.png'),
]);
const data = { villages, towns, ruins };
let mode = 'villages';
let selected = -1; // data[mode] 数组下标

const listEl = document.getElementById('list');
const formEl = document.getElementById('form');
const editorEl = document.getElementById('editor');
const emptyEl = document.getElementById('empty');
const filterEl = document.getElementById('filter');
const imgPanel = document.getElementById('img-panel');
const picker = document.getElementById('atlas-picker');
const preview = document.getElementById('img-preview');
const mapCanvas = document.getElementById('world-map');

const sel = () => data[mode][selected] || null;

// --- 世界地图（三个 tab 共用） ---
// 先用 tiles_day.png 把 2160×1080 的 world_map.bin 渲染成离屏 canvas，再缩放显示。
const tileAtlas = makeAtlas(tilesImg, 16, 16);
const worldFull = renderGridToCanvas(worldBin, WORLD_W, WORLD_H, tileAtlas);

function drawMap() {
  const ctx = mapCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(worldFull, 0, 0, MAP_W, MAP_H);
  const arr = data[mode], yk = MODES[mode].yKey;
  ctx.fillStyle = 'rgba(255,90,90,0.9)';
  for (let i = 0; i < arr.length; i++) {
    if (i === selected) continue;
    const px = arr[i].x / WORLD_W * MAP_W, py = arr[i][yk] / WORLD_H * MAP_H;
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
  const cur = sel();
  if (cur) {
    const px = cur.x / WORLD_W * MAP_W, py = cur[yk] / WORLD_H * MAP_H;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}

mapCanvas.onclick = (e) => {
  const cur = sel();
  if (!cur) { toast('请先在左侧选择条目'); return; }
  const r = mapCanvas.getBoundingClientRect();
  const x = clamp(Math.round((e.clientX - r.left) / r.width * WORLD_W), 0, WORLD_W - 1);
  const y = clamp(Math.round((e.clientY - r.top) / r.height * WORLD_H), 0, WORLD_H - 1);
  cur.x = x;
  cur[MODES[mode].yKey] = y;
  dirty.mark();
  drawMap();
  renderForm();
};

// --- 发现物图集点选（discoveries.png，2 倍放大 + 网格线） ---
picker.width = discImg.width * ZOOM;
picker.height = discImg.height * ZOOM;
picker.style.width = '560px';
picker.style.height = 'auto';

function drawPicker() {
  const ctx = picker.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, picker.width, picker.height);
  ctx.drawImage(discImg, 0, 0, picker.width, picker.height);
  const step = CELL * ZOOM;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * step, 0); ctx.lineTo(x * step, picker.height); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * step); ctx.lineTo(picker.width, y * step); ctx.stroke(); }
  const cur = sel();
  if (cur && cur.img) {
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.strokeRect((cur.img[0] - 1) * step + 1, (cur.img[1] - 1) * step + 1, step - 2, step - 2);
    ctx.lineWidth = 1;
  }
}

picker.onclick = (e) => {
  const cur = sel();
  if (!cur || !MODES[mode].hasImg) return;
  const r = picker.getBoundingClientRect();
  const col = clamp(Math.floor((e.clientX - r.left) / r.width * COLS) + 1, 1, COLS);
  const row = clamp(Math.floor((e.clientY - r.top) / r.height * ROWS) + 1, 1, ROWS);
  cur.img = [col, row];
  dirty.mark();
  drawPicker(); drawPreview(); updateImgLabel();
};

function drawPreview() {
  const ctx = preview.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, preview.width, preview.height);
  const cur = sel();
  if (cur && cur.img) {
    ctx.drawImage(discImg,
      (cur.img[0] - 1) * CELL, (cur.img[1] - 1) * CELL, CELL, CELL,
      0, 0, preview.width, preview.height);
  }
}

function updateImgLabel() {
  const cur = sel();
  document.getElementById('img-coord').textContent = cur && cur.img ? cur.img.join(', ') : '-';
}

// --- 列表与表单 ---
function renderList() {
  listEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  data[mode].forEach((e, i) => {
    const label = `${e.id}. ${e.name}`;
    if (q && !label.toLowerCase().includes(q)) return;
    const item = el('div', { class: 'item' + (i === selected ? ' selected' : ''), text: label });
    item.onclick = () => { selected = i; renderList(); renderForm(); };
    listEl.append(item);
  });
}

function renderForm() {
  const cfg = MODES[mode];
  const cur = sel();
  imgPanel.style.display = cfg.hasImg ? '' : 'none';
  if (!cur) {
    editorEl.style.display = 'none';
    emptyEl.style.display = '';
    drawMap();
    return;
  }
  editorEl.style.display = '';
  emptyEl.style.display = 'none';
  formEl.innerHTML = '';

  // id（可改，需查重）
  formEl.append(el('label', { text: 'id' }));
  const idInp = el('input', { type: 'number', value: cur.id, min: 0 });
  idInp.onchange = () => {
    const v = Math.round(+idInp.value);
    if (!Number.isFinite(v) || v < 0) {
      toast('id 必须是非负整数');
      idInp.value = cur.id;
      return;
    }
    if (data[mode].some((e, i) => i !== selected && e.id === v)) {
      toast(`id ${v} 已被占用，未修改`);
      idInp.value = cur.id;
      return;
    }
    cur.id = v;
    dirty.mark();
    renderList();
  };
  formEl.append(idInp);

  // name
  formEl.append(el('label', { text: '名字' }));
  const nameInp = el('input', { type: 'text', value: cur.name });
  nameInp.onchange = () => { cur.name = nameInp.value; dirty.mark(); renderList(); };
  formEl.append(nameInp);

  // x
  formEl.append(el('label', { text: 'x' }));
  const xInp = el('input', { type: 'number', value: cur.x, min: 0, max: WORLD_W - 1 });
  xInp.onchange = () => {
    cur.x = clamp(Math.round(+xInp.value || 0), 0, WORLD_W - 1);
    xInp.value = cur.x;
    dirty.mark(); drawMap();
  };
  formEl.append(xInp);

  // y（towns/ruins 存为 z）
  formEl.append(el('label', { text: 'y (z)' }));
  const yInp = el('input', { type: 'number', value: cur[cfg.yKey], min: 0, max: WORLD_H - 1 });
  yInp.onchange = () => {
    cur[cfg.yKey] = clamp(Math.round(+yInp.value || 0), 0, WORLD_H - 1);
    yInp.value = cur[cfg.yKey];
    dirty.mark(); drawMap();
  };
  formEl.append(yInp);

  if (cfg.hasDesc) {
    formEl.append(el('label', { text: '描述 desc' }));
    const ta = el('textarea', { rows: 5 }, cur.desc ?? '');
    ta.onchange = () => { cur.desc = ta.value; dirty.mark(); };
    formEl.append(ta);
  }

  if (cfg.hasSubject) {
    formEl.append(el('label', { text: '学科 subject' }));
    const dl = el('datalist', { id: 'subject-list' });
    const subjects = [...new Set(data.villages.map(v => v.subject).filter(Boolean))].sort();
    for (const s of subjects) dl.append(el('option', { value: s }));
    const inp = el('input', { type: 'text', value: cur.subject ?? '', list: 'subject-list' });
    inp.onchange = () => { cur.subject = inp.value; dirty.mark(); };
    formEl.append(inp, dl);
  }

  document.getElementById('tip').textContent =
    '坐标为世界地图 tile 坐标（' + WORLD_W + '×' + WORLD_H + '），也可直接点击下方地图设置。';

  if (cfg.hasImg) { drawPicker(); drawPreview(); updateImgLabel(); }
  drawMap();
}

// --- tabs ---
function setMode(m) {
  mode = m;
  selected = -1;
  for (const k of Object.keys(MODES)) {
    document.getElementById('tab-' + k).classList.toggle('active', k === m);
  }
  renderList();
  renderForm();
}
for (const k of Object.keys(MODES)) {
  document.getElementById('tab-' + k).onclick = () => setMode(k);
}

// --- 新增 / 删除 ---
document.getElementById('btn-add').onclick = () => {
  const cfg = MODES[mode];
  const arr = data[mode];
  const id = arr.reduce((m, e) => Math.max(m, e.id), 0) + 1;
  const entry = { id, name: '新条目', x: 0 };
  entry[cfg.yKey] = 0;
  if (cfg.hasDesc) entry.desc = '';
  if (cfg.hasImg) { entry.img = [1, 1]; entry.subject = 'biology'; }
  arr.push(entry);
  selected = arr.length - 1;
  dirty.mark();
  renderList(); renderForm();
  toast(`已新增 ${cfg.label} id=${id}`);
};

document.getElementById('btn-del').onclick = () => {
  const cur = sel();
  if (!cur) { toast('请先选择条目'); return; }
  if (!confirm(`确认删除 ${cur.id}. ${cur.name}？`)) return;
  data[mode].splice(selected, 1);
  selected = -1;
  dirty.mark();
  renderList(); renderForm();
};

// --- 导入 / 导出（按当前 tab） ---
document.getElementById('btn-export').onclick = () => {
  saveFile(MODES[mode].file, toJSONBlob(data[mode]));
  dirty.clear();
};

document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(f.buffer));
    if (!Array.isArray(parsed)) throw new Error('顶层必须是数组');
    data[mode] = parsed;
    selected = -1;
    dirty.mark();
    renderList(); renderForm();
    toast(`已导入 ${f.name} → ${MODES[mode].file}`);
  } catch (e) {
    toast('JSON 解析失败: ' + e.message);
  }
};

filterEl.oninput = renderList;
renderList();
renderForm();
