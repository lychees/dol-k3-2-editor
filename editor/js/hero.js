// hero.js — 养成编辑器 (heroes.json + monsters.json)
// heroes.json: { attrs: [ {str,agi,con,int,per,cha} ×7 ], growth: { maxHp, maxSp, atk,
//   defLvDiv, expPerLv, weaponBonus[4], armorBonus[4], mateSkill } }
// monsters.json: [ { name, img: [列, 行], hp, atk, def, exp, gold } ]
//   img 为 discoveries.png 1-based [列, 行]（49px 格，16 列 × 8 行）；数组下标即难度 tier。
import {
  loadJSON, loadImage, saveFile, toJSONBlob, pickFile,
  el, pageHeader, makeDirty, toast, assetURL, probeAssets, clamp,
} from './common.js';

pageHeader('养成编辑器', 'heroes.json · monsters.json — 主角属性、成长公式与怪物');

const HEROES = [
  { name: 'João Ferrero',     img: 'dos/hero_joao.png' },
  { name: 'Catalina Erantzo', img: 'dos/hero_catalina.png' },
  { name: 'Otto Baynes',      img: 'dos/hero_otto.png' },
  { name: 'Ernst Von Bohr',   img: 'dos/hero_ernst.png' },
  { name: 'Pietro Conti',     img: 'dos/hero_pietro.png' },
  { name: 'Ali Vezas',        img: 'dos/hero_ali.png' },
  { name: 'Isabella',         img: 'waifu/isabella.png' },
];
const ATTRS = ['str', 'agi', 'con', 'int', 'per', 'cha'];
const ATTR_LABEL = {
  str: '力量 str', agi: '敏捷 agi', con: '体质 con',
  int: '智力 int', per: '感知 per', cha: '魅力 cha',
};
const CELL = 49, COLS = 16, ROWS = 8, ZOOM = 2; // discoveries.png 图集参数
const TABS = ['heroes', 'growth', 'monsters'];
const TAB_FILE = { heroes: 'heroes.json', growth: 'heroes.json', monsters: 'monsters.json' };

const dirty = makeDirty();
await probeAssets();
// 优先读游戏 assets 里的文件；独立部署（线上）时游戏站点可能还没有，
// 回退到编辑器内置副本 editor/data/（与游戏内置数据一致）。
let heroes;
try {
  heroes = await loadJSON('heroes.json');
} catch {
  heroes = await (await fetch('./data/heroes.json')).json();
  toast('游戏站点暂无 heroes.json，已加载编辑器内置副本');
}
let monsters;
try {
  monsters = await loadJSON('monsters.json');
} catch {
  monsters = await (await fetch('./data/monsters.json')).json();
  toast('游戏站点暂无 monsters.json，已加载编辑器内置副本');
}
const discImg = await loadImage('discoveries.png');

let tab = 'heroes';
let heroIdx = 0;
let monIdx = 0;
let pickerCv = null, previewCv = null, coordEl = null; // 怪物图集点选（renderMonForm 重建）

function heroImgURL(i) {
  return encodeURI(assetURL((HEROES[i] || HEROES[0]).img));
}

// --- 成长公式（与 main.js 一致；atk/def 预览按武器/护甲 tier 0，未计疲劳衰减） ---
function calcStats(i, lv) {
  const a = heroes.attrs[i], g = heroes.growth;
  const strDiv = g.atk.strDiv || 1, defDiv = g.defLvDiv || 1;
  return {
    maxHp: g.maxHp.base + g.maxHp.perLv * lv + a.con * g.maxHp.conMul,
    maxSp: g.maxSp.base + g.maxSp.perLv * lv + a.int * g.maxSp.intMul + a.per * g.maxSp.perMul,
    atk: g.atk.base + g.atk.perLv * lv + (g.weaponBonus[0] || 0) + Math.floor(a.str / strDiv),
    def: Math.floor(lv / defDiv) + (g.armorBonus[0] || 0),
  };
}

// 通用数值输入：修改即 clamp + dirty.mark()，并刷新主角速览
function numInput(obj, key, { min = 0, max = 9999, float = false } = {}) {
  const attrs = { type: 'number', value: obj[key], min, max };
  if (float) attrs.step = 0.05;
  const inp = el('input', attrs);
  inp.onchange = () => {
    let v = +inp.value;
    if (!Number.isFinite(v)) v = obj[key];
    v = float ? clamp(v, min, max) : clamp(Math.round(v), min, max);
    obj[key] = v;
    inp.value = v;
    dirty.mark();
    renderHeroForm(); // 数值速览实时反映 growth 变化
  };
  return inp;
}

// --- tab 1：主角属性 ---
function renderHeroList() {
  const list = document.getElementById('hero-list');
  list.innerHTML = '';
  heroes.attrs.forEach((a, i) => {
    const hero = HEROES[i] || { name: `#${i}` };
    const item = el('div', { class: 'hero-item' + (i === heroIdx ? ' selected' : '') },
      el('img', { src: heroImgURL(i), alt: '' }),
      el('span', { text: hero.name }),
    );
    item.onclick = () => { heroIdx = i; renderHeroList(); renderHeroForm(); };
    list.append(item);
  });
}

function renderStats(table) {
  table.innerHTML = '';
  const lvs = [1, 10, 20, 50];
  table.append(el('tr', {}, el('th', { text: '等级' }), ...lvs.map(l => el('th', { text: 'Lv ' + l }))));
  const rows = [['maxHp', 'maxHp'], ['maxSp', 'maxSp'], ['atk', 'atk（武器 tier 0）'], ['def', 'def（护甲 tier 0）']];
  for (const [k, label] of rows) {
    table.append(el('tr', {}, el('td', { text: label }),
      ...lvs.map(l => el('td', { text: String(calcStats(heroIdx, l)[k]) }))));
  }
}

function renderHeroForm() {
  const main = document.getElementById('hero-main');
  main.innerHTML = '';
  const a = heroes.attrs[heroIdx];
  if (!a) return;
  const hero = HEROES[heroIdx] || { name: `#${heroIdx}` };

  const card = el('div', { class: 'card' });
  card.append(el('h3', { text: `${heroIdx}. ${hero.name}` }));
  const row = el('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' });
  row.append(el('img', { id: 'hero-portrait', src: heroImgURL(heroIdx), alt: '' }));
  const form = el('div', { class: 'ed-form', style: 'grid-template-columns:90px 90px' });
  for (const k of ATTRS) {
    form.append(el('label', { text: ATTR_LABEL[k] }));
    const inp = el('input', { type: 'number', value: a[k], min: 3, max: 18 });
    inp.onchange = () => {
      a[k] = clamp(Math.round(+inp.value || 3), 3, 18);
      inp.value = a[k];
      dirty.mark();
      renderStats(statsTable);
    };
    form.append(inp);
  }
  row.append(form);
  card.append(row);
  card.append(el('p', { class: 'hint', text: '六维范围 3–18 整数。游戏启动时 heroes.json 按主角索引覆盖内置属性。' }));
  main.append(card);

  const scard = el('div', { class: 'card' });
  scard.append(el('h3', { text: '数值速览（按当前成长参数实时计算）' }));
  const statsTable = el('table', { class: 'stats' });
  scard.append(statsTable);
  scard.append(el('p', { class: 'hint', text: 'atk 未计疲劳衰减（疲劳≥90 时 ×fatigueFactor）。' }));
  main.append(scard);
  renderStats(statsTable);
}

// --- tab 2：成长参数 ---
function renderGrowth() {
  const main = document.getElementById('growth-main');
  main.innerHTML = '';
  const g = heroes.growth;
  const groups = [
    {
      title: '生命 maxHp', obj: g.maxHp,
      hint: 'maxHp = base + perLv×lv + con×conMul',
      fields: [['base', 'base'], ['perLv', 'perLv'], ['conMul', 'conMul']],
    },
    {
      title: '法力 maxSp', obj: g.maxSp,
      hint: 'maxSp = base + perLv×lv + int×intMul + per×perMul',
      fields: [['base', 'base'], ['perLv', 'perLv'], ['intMul', 'intMul'], ['perMul', 'perMul']],
    },
    {
      title: '攻击 atk', obj: g.atk,
      hint: 'atk = (base + perLv×lv + weaponBonus[武器tier] + floor(str/strDiv)) ×（疲劳≥90 时 ×fatigueFactor）',
      fields: [['base', 'base'], ['perLv', 'perLv'], ['strDiv', 'strDiv'], ['fatigueFactor', 'fatigueFactor']],
      opts: { strDiv: { min: 1 }, fatigueFactor: { min: 0, max: 1, float: true } },
    },
    {
      title: '防御与经验', obj: g,
      hint: 'def = floor(lv/defLvDiv) + armorBonus[护甲tier]；升级所需 exp = lv × expPerLv',
      fields: [['defLvDiv', 'defLvDiv'], ['expPerLv', 'expPerLv']],
      opts: { defLvDiv: { min: 1 } },
    },
    {
      title: '伙伴技能 mateSkill', obj: g.mateSkill,
      hint: '技能等级 = clamp(1..maxLv, floor(属性/statDiv) + 技能加成)；技能升级 xp = 当前lv × xpPerLv',
      fields: [['maxLv', 'maxLv'], ['xpPerLv', 'xpPerLv'], ['statDiv', 'statDiv']],
      opts: { statDiv: { min: 1 } },
    },
  ];
  for (const grp of groups) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', { text: grp.title }));
    const form = el('div', { class: 'ed-form', style: 'grid-template-columns:130px 90px' });
    for (const [k, label] of grp.fields) {
      form.append(el('label', { text: label }), numInput(grp.obj, k, (grp.opts && grp.opts[k]) || {}));
    }
    card.append(form, el('p', { class: 'hint', text: grp.hint }));
    main.append(card);
  }
  for (const [key, title, hint] of [
    ['weaponBonus', '武器加成 weaponBonus', '武器 tier 0–3 的攻击力加成，代入 atk 公式。'],
    ['armorBonus', '护甲加成 armorBonus', '护甲 tier 0–3 的防御力加成，代入 def 公式。'],
  ]) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', { text: title }));
    const form = el('div', { class: 'ed-form', style: 'grid-template-columns:130px 90px' });
    for (let i = 0; i < 4; i++) {
      form.append(el('label', { text: `tier ${i}` }), numInput(g[key], i, {}));
    }
    card.append(form, el('p', { class: 'hint', text: hint }));
    main.append(card);
  }
}

// --- tab 3：怪物 ---
function renderMonList() {
  const list = document.getElementById('mon-list');
  list.innerHTML = '';
  monsters.forEach((m, i) => {
    const item = el('div', { class: 'item' + (i === monIdx ? ' selected' : ''), text: `${i}. ${m.name}` });
    item.onclick = () => { monIdx = i; renderMonList(); renderMonForm(); };
    list.append(item);
  });
}

function drawPicker() {
  const ctx = pickerCv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, pickerCv.width, pickerCv.height);
  ctx.drawImage(discImg, 0, 0, pickerCv.width, pickerCv.height);
  const step = CELL * ZOOM;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * step, 0); ctx.lineTo(x * step, pickerCv.height); ctx.stroke(); }
  for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * step); ctx.lineTo(pickerCv.width, y * step); ctx.stroke(); }
  const m = monsters[monIdx];
  if (m) {
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 2;
    ctx.strokeRect((m.img[0] - 1) * step + 1, (m.img[1] - 1) * step + 1, step - 2, step - 2);
    ctx.lineWidth = 1;
  }
}

function drawPreview() {
  const ctx = previewCv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, previewCv.width, previewCv.height);
  const m = monsters[monIdx];
  if (m) {
    ctx.drawImage(discImg,
      (m.img[0] - 1) * CELL, (m.img[1] - 1) * CELL, CELL, CELL,
      0, 0, previewCv.width, previewCv.height);
  }
}

function onPick(e) {
  const m = monsters[monIdx];
  if (!m) return;
  const r = pickerCv.getBoundingClientRect();
  const col = clamp(Math.floor((e.clientX - r.left) / r.width * COLS) + 1, 1, COLS);
  const row = clamp(Math.floor((e.clientY - r.top) / r.height * ROWS) + 1, 1, ROWS);
  m.img = [col, row];
  coordEl.textContent = `${col}, ${row}`;
  dirty.mark();
  drawPicker();
  drawPreview();
}

function renderMonForm() {
  const main = document.getElementById('mon-main');
  main.innerHTML = '';
  const m = monsters[monIdx];
  if (!m) {
    main.append(el('p', { class: 'hint', text: '请先在左侧选择怪物（或点击「新增怪物」）。' }));
    return;
  }
  const card = el('div', { class: 'card' });
  card.append(el('h3', { text: `#${monIdx} ${m.name}（难度 tier ${monIdx}）` }));
  const form = el('div', { class: 'ed-form', style: 'grid-template-columns:110px 1fr' });

  form.append(el('label', { text: '名字 name' }));
  const nameInp = el('input', { type: 'text', value: m.name });
  nameInp.onchange = () => { m.name = nameInp.value; dirty.mark(); renderMonList(); };
  form.append(nameInp);

  for (const k of ['hp', 'atk', 'def', 'exp', 'gold']) {
    form.append(el('label', { text: k }));
    const inp = el('input', { type: 'number', value: m[k], min: 0 });
    inp.onchange = () => {
      m[k] = Math.max(0, Math.round(+inp.value || 0));
      inp.value = m[k];
      dirty.mark();
    };
    form.append(inp);
  }

  coordEl = el('span', { text: `${m.img[0]}, ${m.img[1]}` });
  form.append(el('label', { text: '图集格 img' }), coordEl);
  card.append(form);
  card.append(el('p', { class: 'hint', text: '点击下图选择 discoveries.png 中的图格（1-based [列, 行]，49px 格，16 列 × 8 行）。' }));

  const wrap = el('div', { style: 'display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap' });
  pickerCv = el('canvas', { id: 'atlas-picker' });
  pickerCv.width = discImg.width * ZOOM;
  pickerCv.height = discImg.height * ZOOM;
  pickerCv.onclick = onPick;
  const side = el('div', {});
  previewCv = el('canvas', { id: 'mon-preview', width: 98, height: 98 });
  side.append(previewCv, el('p', { class: 'hint', text: '98×98 预览' }));
  wrap.append(pickerCv, side);
  card.append(wrap);
  main.append(card);
  drawPicker();
  drawPreview();
}

document.getElementById('btn-add').onclick = () => {
  monsters.push({ name: '新怪物', img: [1, 1], hp: 10, atk: 5, def: 0, exp: 5, gold: 5 });
  monIdx = monsters.length - 1;
  dirty.mark();
  renderMonList();
  renderMonForm();
  toast('已新增怪物（数组下标即难度 tier，新增会扩展难度梯度）');
};

document.getElementById('btn-del').onclick = () => {
  const m = monsters[monIdx];
  if (!m) { toast('请先选择怪物'); return; }
  if (!confirm(`确认删除 ${monIdx}. ${m.name}？\n数组下标即难度 tier，删除会改变后续怪物的难度梯度。`)) return;
  monsters.splice(monIdx, 1);
  monIdx = Math.min(monIdx, monsters.length - 1);
  dirty.mark();
  renderMonList();
  renderMonForm();
};

// --- tabs ---
function setTab(t) {
  tab = t;
  for (const k of TABS) {
    document.getElementById('tab-' + k).classList.toggle('active', k === t);
    document.getElementById('pane-' + k).classList.toggle('active', k === t);
  }
  document.getElementById('btn-export').textContent = '导出 ' + TAB_FILE[t];
  if (t === 'heroes') { renderHeroList(); renderHeroForm(); }
  else if (t === 'growth') renderGrowth();
  else { renderMonList(); renderMonForm(); }
}
for (const k of TABS) {
  document.getElementById('tab-' + k).onclick = () => setTab(k);
}

// --- 导入 / 导出（tab 1/2 共用 heroes.json，tab 3 用 monsters.json） ---
const isNum = (v) => Number.isFinite(v);

function validateHeroes(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '应为对象 { attrs, growth }';
  if (!Array.isArray(d.attrs) || !d.attrs.length) return 'attrs 应为非空数组';
  for (const a of d.attrs) {
    if (!a || typeof a !== 'object') return 'attrs 每项应为对象';
    for (const k of ATTRS) if (!isNum(a[k])) return `attrs 每项需含数值 ${k}`;
  }
  const g = d.growth;
  if (!g || typeof g !== 'object') return '缺少 growth 对象';
  const sub = {
    maxHp: ['base', 'perLv', 'conMul'],
    maxSp: ['base', 'perLv', 'intMul', 'perMul'],
    atk: ['base', 'perLv', 'strDiv', 'fatigueFactor'],
    mateSkill: ['maxLv', 'xpPerLv', 'statDiv'],
  };
  for (const [gk, keys] of Object.entries(sub)) {
    if (!g[gk] || typeof g[gk] !== 'object') return `growth.${gk} 应为对象`;
    for (const k of keys) if (!isNum(g[gk][k])) return `growth.${gk}.${k} 应为数值`;
  }
  for (const k of ['defLvDiv', 'expPerLv']) if (!isNum(g[k])) return `growth.${k} 应为数值`;
  for (const k of ['weaponBonus', 'armorBonus']) {
    if (!Array.isArray(g[k]) || g[k].length !== 4 || !g[k].every(isNum)) return `growth.${k} 应为 4 个数值的数组`;
  }
  return null;
}

function validateMonsters(d) {
  if (!Array.isArray(d)) return '顶层必须是数组';
  for (const m of d) {
    if (!m || typeof m !== 'object') return '每项应为对象';
    if (typeof m.name !== 'string') return '每项需含字符串 name';
    if (!Array.isArray(m.img) || m.img.length !== 2 || !m.img.every(Number.isInteger)) return 'img 应为 [列, 行] 整数对';
    if (m.img[0] < 1 || m.img[0] > COLS || m.img[1] < 1 || m.img[1] > ROWS) return `img 越界（列 1–${COLS}，行 1–${ROWS}）`;
    for (const k of ['hp', 'atk', 'def', 'exp', 'gold']) {
      if (!isNum(m[k]) || m[k] < 0) return `${k} 应为 ≥0 的数值`;
    }
  }
  return null;
}

document.getElementById('btn-export').onclick = () => {
  if (tab === 'monsters') saveFile('monsters.json', toJSONBlob(monsters));
  else saveFile('heroes.json', toJSONBlob(heroes));
  dirty.clear();
};

document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(f.buffer));
    if (tab === 'monsters') {
      const err = validateMonsters(parsed);
      if (err) throw new Error(err);
      monsters = parsed;
      monIdx = 0;
      renderMonList();
      renderMonForm();
    } else {
      const err = validateHeroes(parsed);
      if (err) throw new Error(err);
      heroes = parsed;
      heroIdx = Math.min(heroIdx, heroes.attrs.length - 1);
      if (tab === 'growth') renderGrowth();
      else { renderHeroList(); renderHeroForm(); }
    }
    dirty.mark();
    toast(`已导入 ${f.name} → ${TAB_FILE[tab]}`);
  } catch (e) {
    toast('导入失败: ' + e.message);
  }
};

setTab('heroes');
