// ships.js — 船舰编辑器 (ships.json)
// Schema: { "Ship Name": { durability, power, capacity, guns, min_crew, max_crew, price, tacking } }
import { loadJSON, saveFile, toJSONBlob, pickFile, el, pageHeader, makeDirty, toast } from './common.js';

pageHeader('船舰编辑器', 'ships.json — 22 种船型属性');

const FIELDS = [
  ['durability', '耐久 (hull)'],
  ['power', '动力 (speed)'],
  ['capacity', '载货量'],
  ['guns', '火炮数'],
  ['min_crew', '最少船员'],
  ['max_crew', '最多船员'],
  ['price', '价格 (金币)'],
  ['tacking', '转向 (tacking)'],
];

const dirty = makeDirty();
let ships = await loadJSON('ships.json');
let selected = null;

const listEl = document.getElementById('list');
const formEl = document.getElementById('form');
const editorEl = document.getElementById('editor');
const emptyEl = document.getElementById('empty');
const filterEl = document.getElementById('filter');

function renderList() {
  listEl.innerHTML = '';
  const q = filterEl.value.trim().toLowerCase();
  for (const name of Object.keys(ships)) {
    if (q && !name.toLowerCase().includes(q)) continue;
    const item = el('div', { class: 'item' + (name === selected ? ' selected' : ''), text: name });
    item.onclick = () => { selected = name; renderList(); renderForm(); };
    listEl.append(item);
  }
}

function renderForm() {
  if (!selected || !ships[selected]) { editorEl.style.display = 'none'; emptyEl.style.display = ''; return; }
  editorEl.style.display = ''; emptyEl.style.display = 'none';
  formEl.innerHTML = '';
  const s = ships[selected];

  formEl.append(el('label', { text: '船名' }));
  const nameInput = el('input', { type: 'text', value: selected });
  nameInput.onchange = () => {
    const nn = nameInput.value.trim();
    if (!nn || nn === selected) return;
    if (ships[nn]) { toast('船名已存在'); nameInput.value = selected; return; }
    ships[nn] = ships[selected];
    delete ships[selected];
    selected = nn;
    dirty.mark(); renderList();
  };
  formEl.append(nameInput);

  for (const [key, label] of FIELDS) {
    formEl.append(el('label', { text: label }));
    const inp = el('input', { type: 'number', value: s[key] ?? 0, min: 0 });
    inp.onchange = () => {
      s[key] = Math.max(0, Math.round(+inp.value || 0));
      inp.value = s[key];
      dirty.mark();
      validate(s);
    };
    formEl.append(inp);
  }
  validate(s);
}

function validate(s) {
  const tips = [];
  if (s.min_crew > s.max_crew) tips.push('⚠️ 最少船员大于最多船员');
  if (s.price <= 0) tips.push('⚠️ 价格为 0');
  document.getElementById('ship-tip').textContent = tips.join('　');
}

document.getElementById('btn-add').onclick = () => {
  let n = 'New Ship', i = 2;
  while (ships[n]) n = `New Ship ${i++}`;
  ships[n] = { durability: 50, power: 80, capacity: 100, guns: 20, min_crew: 5, max_crew: 40, price: 5000, tacking: 70 };
  selected = n;
  dirty.mark(); renderList(); renderForm();
};

document.getElementById('btn-del').onclick = () => {
  if (!selected) return;
  if (!confirm(`删除船型 ${selected}？`)) return;
  delete ships[selected];
  selected = null;
  dirty.mark(); renderList(); renderForm();
};

document.getElementById('btn-export').onclick = () => {
  saveFile('ships.json', toJSONBlob(ships));
  dirty.clear();
};

document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    ships = JSON.parse(new TextDecoder().decode(f.buffer));
    selected = null;
    dirty.mark(); renderList(); renderForm();
    toast(`已导入 ${f.name}`);
  } catch (e) { toast('JSON 解析失败: ' + e.message); }
};

filterEl.oninput = renderList;
renderList();
