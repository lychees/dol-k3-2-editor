// mates.js — 人物编辑器 (mates.json + maids.json)
// mates: { "1": { name, nation, lv, leadership, seamanship, knowledge, intuition,
//                 courage, swordplay, luck, accounting, gunnery, navigation, image: [x, y] } }
// maids: { "1": { name, image: [x, y] } }
// figures.png: 65×81 头像格，image 为 1-based [列, 行]。
import { loadJSON, loadImage, saveFile, toJSONBlob, pickFile, el, pageHeader, makeDirty, toast } from './common.js';

pageHeader('人物编辑器', 'mates.json · maids.json — 伙伴与酒吧女郎');

// figures.png：格距 65×81，游戏绘制时内缩 3px 取 59×75（见 main.js:2161）
const CELL_W = 65, CELL_H = 81, COLS = 16, INSET = 3, PIC_W = 59, PIC_H = 75;
const MATE_STATS = ['leadership', 'seamanship', 'knowledge', 'intuition', 'courage', 'swordplay', 'luck'];
const MATE_SKILLS = ['accounting', 'gunnery', 'navigation'];
const STAT_LABELS = {
  leadership: '领导力', seamanship: '航海术', knowledge: '知识', intuition: '直觉',
  courage: '勇气', swordplay: '剑术', luck: '运气',
  accounting: '会计', gunnery: '炮术', navigation: '导航',
};
const NATIONS = ['England', 'Holland', 'Italy', 'Portugal', 'Spain', 'Turkey'];

const dirty = makeDirty();
const figures = await loadImage('figures.png');
const ROWS = Math.floor(figures.height / CELL_H);

let mode = 'mates'; // 'mates' | 'maids'
let data = { mates: await loadJSON('mates.json'), maids: await loadJSON('maids.json') };
let selected = null;

const listEl = document.getElementById('list');
const formEl = document.getElementById('form');
const editorEl = document.getElementById('editor');
const emptyEl = document.getElementById('empty');
const filterEl = document.getElementById('filter');
const picker = document.getElementById('portrait-picker');
const pview = document.getElementById('portrait-view');

// --- portrait picker ---
picker.width = figures.width; picker.height = figures.height;
picker.style.width = Math.min(figures.width, 520) + 'px';
picker.style.height = 'auto';
function drawPicker() {
  const ctx = picker.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(figures, 0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * CELL_W, 0); ctx.lineTo(x * CELL_W, picker.height); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL_H); ctx.lineTo(picker.width, y * CELL_H); ctx.stroke(); }
  const cur = data[mode][selected];
  if (cur && cur.image) {
    ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
    ctx.strokeRect((cur.image[0] - 1) * CELL_W + 1, (cur.image[1] - 1) * CELL_H + 1, CELL_W - 2, CELL_H - 2);
    ctx.lineWidth = 1;
  }
}
picker.onclick = (e) => {
  if (!selected) return;
  const r = picker.getBoundingClientRect();
  const cx = Math.floor((e.clientX - r.left) / r.width * COLS) + 1;
  const cy = Math.floor((e.clientY - r.top) / r.height * ROWS) + 1;
  data[mode][selected].image = [cx, cy];
  dirty.mark(); drawPicker(); drawPortrait(); updateCoordLabel();
};

function drawPortrait() {
  const ctx = pview.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, pview.width, pview.height);
  const cur = data[mode][selected];
  if (cur && cur.image) {
    ctx.drawImage(figures,
      (cur.image[0] - 1) * CELL_W + INSET, (cur.image[1] - 1) * CELL_H + INSET, PIC_W, PIC_H,
      0, 0, pview.width, pview.height);
  }
}
function updateCoordLabel() {
  const cur = data[mode][selected];
  document.getElementById('img-coord').textContent = cur && cur.image ? cur.image.join(', ') : '-';
}

// --- list & form ---
function renderList() {
  listEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  for (const [id, m] of Object.entries(data[mode])) {
    if (q && !m.name.toLowerCase().includes(q)) continue;
    const item = el('div', { class: 'item' + (id === selected ? ' selected' : ''), text: `${id}. ${m.name}` });
    item.onclick = () => { selected = id; renderList(); renderForm(); };
    listEl.append(item);
  }
}

function renderForm() {
  const cur = data[mode][selected];
  if (!cur) { editorEl.style.display = 'none'; emptyEl.style.display = ''; drawPicker(); return; }
  editorEl.style.display = ''; emptyEl.style.display = 'none';
  formEl.innerHTML = '';

  formEl.append(el('label', { text: '名字' }));
  const nameInp = el('input', { type: 'text', value: cur.name });
  nameInp.onchange = () => { cur.name = nameInp.value; dirty.mark(); renderList(); };
  formEl.append(nameInp);

  if (mode === 'mates') {
    formEl.append(el('label', { text: '国籍' }));
    const nat = el('select');
    for (const n of NATIONS) nat.append(el('option', { value: n, text: n, ...(cur.nation === n ? { selected: '' } : {}) }));
    if (!NATIONS.includes(cur.nation)) nat.append(el('option', { value: cur.nation, text: cur.nation, selected: '' }));
    nat.onchange = () => { cur.nation = nat.value; dirty.mark(); };
    formEl.append(nat);

    formEl.append(el('label', { text: '等级 lv' }));
    const lv = el('input', { type: 'number', value: cur.lv, min: 1, max: 99 });
    lv.onchange = () => { cur.lv = Math.max(1, Math.round(+lv.value || 1)); lv.value = cur.lv; dirty.mark(); };
    formEl.append(lv);

    for (const k of [...MATE_STATS, ...MATE_SKILLS]) {
      formEl.append(el('label', { text: `${STAT_LABELS[k]} (${k})` }));
      const inp = el('input', { type: 'number', value: cur[k] ?? 0, min: 0, max: 150 });
      inp.onchange = () => { cur[k] = Math.max(0, Math.round(+inp.value || 0)); inp.value = cur[k]; dirty.mark(); };
      formEl.append(inp);
    }
    document.getElementById('tip').textContent = '属性建议范围 0–150；技能 0–3（0 = 不会）。';
  } else {
    document.getElementById('tip').textContent = '酒吧女郎只有名字与头像。在 port_meta.json 的 maid 字段中按编号引用。';
  }
  drawPicker(); drawPortrait(); updateCoordLabel();
}

// --- tabs ---
const tabMates = document.getElementById('tab-mates');
const tabMaids = document.getElementById('tab-maids');
function setMode(m) {
  mode = m; selected = null;
  tabMates.classList.toggle('active', m === 'mates');
  tabMaids.classList.toggle('active', m === 'maids');
  renderList(); renderForm();
}
tabMates.onclick = () => setMode('mates');
tabMaids.onclick = () => setMode('maids');

// --- import / export ---
document.getElementById('btn-export').onclick = () => {
  saveFile(mode + '.json', toJSONBlob(data[mode]));
  dirty.clear();
};
document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    data[mode] = JSON.parse(new TextDecoder().decode(f.buffer));
    selected = null;
    dirty.mark(); renderList(); renderForm();
    toast(`已导入 ${f.name} → ${mode}`);
  } catch (e) { toast('JSON 解析失败: ' + e.message); }
};

filterEl.oninput = renderList;
renderList();
