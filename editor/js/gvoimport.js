// gvoimport.js — GVO 发现物导入器（dol-rev → villages.json + gvo_map.json）
// dol-rev discoveries.js: [{ id, n, c, d, i, a }]  n=繁中名 c=分类 d=说明 a=有无大图
// 仅 a==1 可导入；大图 https://lychees.github.io/dol-rev/assets/discovery/{id补零4位}_a.png
// 导入 = villages.json 新增条目 + gvo_map.discoveries[新id] = GVO id
import {
  loadJSON, loadBinary, loadImage, saveFile, toJSONBlob,
  el, pageHeader, makeDirty, makeAtlas, renderGridToCanvas, toast, clamp,
} from './common.js';

pageHeader('GVO 发现物导入器', 'dol-rev → villages.json + gvo_map.json');

const WORLD_W = 2160, WORLD_H = 1080;   // 世界地图 tile 尺寸
const MAP_W = 700, MAP_H = 350;         // 小地图显示尺寸
const GVO_BASE = 'https://lychees.github.io/dol-rev/';
const SUBJECTS = ['biology', 'archaeology', 'art', 'geography', 'religion', 'treasure'];

const dirty = makeDirty();

// 拉取 dol-rev 发现物列表（跨域，Pages 带 ACAO:*）：去头去尾后 JSON.parse
async function loadGVO() {
  const r = await fetch(GVO_BASE + 'data/discoveries.js');
  if (!r.ok) throw new Error(`加载 dol-rev discoveries.js 失败: HTTP ${r.status}`);
  const text = await r.text();
  const json = text.replace(/^\s*const\s+DISCOVERIES\s*=\s*/, '').replace(/;\s*$/, '');
  return JSON.parse(json);
}

function gvoImgURL(id) {
  return `${GVO_BASE}assets/discovery/${String(id).padStart(4, '0')}_a.png`;
}

// GVO 分类 → 学科默认映射
function mapSubject(c) {
  if (/史跡|遺跡/.test(c)) return 'archaeology';
  if (/宗教/.test(c)) return 'religion';
  if (/生物|植物|動物/.test(c)) return 'biology';
  if (/美術|藝術/.test(c)) return 'art';
  if (/財寶|寶藏|遺物/.test(c)) return 'treasure';
  return 'geography';
}

const [villages, worldBin, tilesImg, gvoRaw, gvoMap] = await Promise.all([
  loadJSON('villages.json'),
  loadBinary('world_map.bin'),
  loadImage('tiles_day.png'),
  loadGVO(),
  // 优先读游戏 assets；独立部署（线上）时回退编辑器内置副本
  loadJSON('gvo_map.json').catch(async () => {
    const d = await (await fetch('./data/gvo_map.json')).json();
    toast('游戏站点暂无 gvo_map.json，已加载编辑器内置副本');
    return d;
  }),
]);
if (!gvoMap.discoveries) gvoMap.discoveries = {};

// 只有 a==1（有大图）的条目可导入
const gvoList = gvoRaw.filter(e => e.a == 1);
// 分类下拉选项（去重，按出现顺序）
const categories = [...new Set(gvoList.map(e => e.c))];

let sel = null;                 // 当前选中的 GVO 条目
let form = { name: '', desc: '', subject: 'geography' }; // 可编辑字段
let pos = null;                 // 待导入坐标 { x, y }，未选为 null

const listEl = document.getElementById('list');
const filterEl = document.getElementById('filter');
const catEl = document.getElementById('cat');
const onlyNewEl = document.getElementById('only-new');
const editorEl = document.getElementById('editor');
const emptyEl = document.getElementById('empty');
const formEl = document.getElementById('form');
const gvoImgEl = document.getElementById('gvo-img');
const mapCanvas = document.getElementById('world-map');
const addBtn = document.getElementById('btn-add');

const importedSet = () => new Set(Object.values(gvoMap.discoveries));
const isImported = (id) => importedSet().has(id);

// --- 世界地图 ---
const tileAtlas = makeAtlas(tilesImg, 16, 16);
const worldFull = renderGridToCanvas(worldBin, WORLD_W, WORLD_H, tileAtlas);

function drawMap() {
  const ctx = mapCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(worldFull, 0, 0, MAP_W, MAP_H);
  // 现有发现物红点
  ctx.fillStyle = 'rgba(255,90,90,0.9)';
  for (const v of villages) {
    const px = v.x / WORLD_W * MAP_W, py = v.y / WORLD_H * MAP_H;
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
  }
  // 待导入坐标黄圈
  if (sel && pos) {
    const px = pos.x / WORLD_W * MAP_W, py = pos.y / WORLD_H * MAP_H;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd24a';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
}

mapCanvas.onclick = (e) => {
  if (!sel) { toast('请先在左侧选择 GVO 发现物'); return; }
  const r = mapCanvas.getBoundingClientRect();
  pos = {
    x: clamp(Math.round((e.clientX - r.left) / r.width * WORLD_W), 0, WORLD_W - 1),
    y: clamp(Math.round((e.clientY - r.top) / r.height * WORLD_H), 0, WORLD_H - 1),
  };
  drawMap();
  renderDetail();
};

// --- 左侧列表 ---
function renderList() {
  listEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  const cat = catEl.value;
  const onlyNew = onlyNewEl.checked;
  const imported = importedSet();
  for (const e of gvoList) {
    if (q && !e.n.toLowerCase().includes(q)) continue;
    if (cat && e.c !== cat) continue;
    const done = imported.has(e.id);
    if (onlyNew && done) continue;
    const item = el('div', {
      class: 'item' + (sel === e ? ' selected' : '') + (done ? ' imported' : ''),
    }, `${e.n} · ${e.c}`);
    if (done) item.append(el('span', { class: 'done', text: '✓' }));
    item.onclick = () => {
      sel = e;
      form = { name: e.n, desc: e.d || '', subject: mapSubject(e.c) };
      pos = null;
      renderList();
      renderDetail();
    };
    listEl.append(item);
  }
}

// --- 右侧详情卡 ---
function renderDetail() {
  if (!sel) {
    editorEl.style.display = 'none';
    emptyEl.style.display = '';
    drawMap();
    return;
  }
  editorEl.style.display = '';
  emptyEl.style.display = 'none';
  gvoImgEl.src = gvoImgURL(sel.id);
  formEl.innerHTML = '';

  formEl.append(el('label', { text: '名称' }));
  const nameInp = el('input', { type: 'text', value: form.name });
  nameInp.onchange = () => { form.name = nameInp.value; };
  formEl.append(nameInp);

  formEl.append(el('label', { text: '说明 desc' }));
  const ta = el('textarea', { rows: 5 }, form.desc);
  ta.onchange = () => { form.desc = ta.value; };
  formEl.append(ta);

  formEl.append(el('label', { text: '学科 subject' }));
  const subSel = el('select');
  for (const s of SUBJECTS) subSel.append(el('option', { value: s, text: s }));
  subSel.value = form.subject;
  subSel.onchange = () => { form.subject = subSel.value; };
  formEl.append(subSel);

  formEl.append(el('label', { text: 'x' }));
  const xInp = el('input', { type: 'number', min: 0, max: WORLD_W - 1 });
  if (pos) xInp.value = pos.x;
  xInp.onchange = () => {
    pos = { x: clamp(Math.round(+xInp.value || 0), 0, WORLD_W - 1), y: pos ? pos.y : 0 };
    xInp.value = pos.x;
    drawMap();
    updateAddBtn();
  };
  formEl.append(xInp);

  formEl.append(el('label', { text: 'y' }));
  const yInp = el('input', { type: 'number', min: 0, max: WORLD_H - 1 });
  if (pos) yInp.value = pos.y;
  yInp.onchange = () => {
    pos = { x: pos ? pos.x : 0, y: clamp(Math.round(+yInp.value || 0), 0, WORLD_H - 1) };
    yInp.value = pos.y;
    drawMap();
    updateAddBtn();
  };
  formEl.append(yInp);

  updateAddBtn();
  drawMap();
}

function updateAddBtn() {
  addBtn.disabled = !sel || !pos || isImported(sel.id);
  addBtn.textContent = sel && isImported(sel.id) ? '已导入' : '添加到游戏';
}

// --- 添加到游戏 ---
addBtn.onclick = () => {
  if (!sel || !pos || isImported(sel.id)) return;
  const id = villages.reduce((m, v) => Math.max(m, v.id), 0) + 1;
  villages.push({ id, name: form.name, x: pos.x, y: pos.y, desc: form.desc, img: [1, 1], subject: form.subject });
  gvoMap.discoveries[String(id)] = sel.id;
  dirty.mark();
  toast(`已添加 id=${id}「${form.name}」，记得导出 villages.json 与 gvo_map.json`);
  renderList();
  renderDetail();
};

// --- 导出 ---
document.getElementById('btn-export-villages').onclick = () => {
  saveFile('villages.json', toJSONBlob(villages));
  dirty.clear();
};
document.getElementById('btn-export-gvomap').onclick = () => {
  saveFile('gvo_map.json', toJSONBlob(gvoMap));
  dirty.clear();
};

// --- 筛选控件 ---
catEl.append(el('option', { value: '', text: '全部分类' }));
for (const c of categories) catEl.append(el('option', { value: c, text: c }));
filterEl.oninput = renderList;
catEl.onchange = renderList;
onlyNewEl.onchange = renderList;

renderList();
renderDetail();
