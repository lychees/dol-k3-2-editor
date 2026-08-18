// outfit.js — 装备 / 船舱 / 平衡参数编辑器 (equipment.json + balance.json)
// equipment.json: { outfit: [...6 项], cabins: {...9 种}, cabinDefaults: [...] }
//   outfit 中 sails/cannons 为 3 档 tiers [{name,cost,desc}]，其余 4 项为单件
//   {key, name, cost, desc}；key 被游戏代码引用，不可改。
// balance.json: 全局数值参数 + pirateShips 船型池（见 FORMATS.md）。
import {
  loadJSON, saveFile, toJSONBlob, pickFile,
  el, pageHeader, makeDirty, toast, probeAssets, clamp,
} from './common.js';

pageHeader('装备 / 船舱 / 平衡参数编辑器', 'equipment.json · balance.json');

const STATS = [
  'leadership', 'seamanship', 'knowledge', 'intuition', 'courage',
  'swordplay', 'luck', 'accounting', 'gunnery', 'navigation',
];
const OUTFIT_LABEL = {
  sails: '船帆', cannons: '火炮', ram: '撞角',
  figurehead: '船首像', boarding: '接舷跳板', armor: '装甲',
};
const TABS = ['outfit', 'cabins', 'balance'];
const TAB_FILE = { outfit: 'equipment.json', cabins: 'equipment.json', balance: 'balance.json' };

const dirty = makeDirty();
await probeAssets();
// 优先读游戏 assets 里的文件；独立部署（线上）时游戏站点可能还没有，
// 回退到编辑器内置副本 editor/data/（与游戏内置数据一致）。
let equip;
try {
  equip = await loadJSON('equipment.json');
} catch {
  equip = await (await fetch('./data/equipment.json')).json();
  toast('游戏站点暂无 equipment.json，已加载编辑器内置副本');
}
let balance;
try {
  balance = await loadJSON('balance.json');
} catch {
  balance = await (await fetch('./data/balance.json')).json();
  toast('游戏站点暂无 balance.json，已加载编辑器内置副本');
}

let tab = 'outfit';

// 通用文本输入
function textInput(obj, key) {
  const inp = el('input', { type: 'text', value: obj[key] ?? '' });
  inp.onchange = () => { obj[key] = inp.value; dirty.mark(); };
  return inp;
}

// 通用数值输入：修改即 clamp + dirty.mark()
function numInput(obj, key, { min = 0, max = 999999, float = false, step } = {}) {
  const attrs = { type: 'number', value: obj[key], min, max };
  if (float) attrs.step = step ?? 0.01;
  const inp = el('input', attrs);
  inp.onchange = () => {
    let v = +inp.value;
    if (!Number.isFinite(v)) v = obj[key];
    v = float ? clamp(v, min, max) : clamp(Math.round(v), min, max);
    obj[key] = v;
    inp.value = v;
    dirty.mark();
  };
  return inp;
}

function statSelect(obj, key) {
  const sel = el('select', {});
  for (const s of STATS) sel.append(el('option', { value: s, text: s }));
  sel.value = obj[key];
  sel.onchange = () => { obj[key] = sel.value; dirty.mark(); };
  return sel;
}

// --- tab 1：舰船装备 ---
function renderOutfit() {
  const main = document.getElementById('outfit-main');
  main.innerHTML = '';
  for (const item of equip.outfit) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', {},
      `${OUTFIT_LABEL[item.key] || item.key}`,
      el('span', { class: 'key', text: `key: ${item.key}（只读）` }),
    ));
    if (Array.isArray(item.tiers)) {
      item.tiers.forEach((t, i) => {
        const div = el('div', { class: 'tier' });
        div.append(el('h4', { text: `tier ${i}` }));
        const form = el('div', { class: 'ed-form', style: 'grid-template-columns:70px 1fr' });
        form.append(el('label', { text: '名称 name' }), textInput(t, 'name'));
        form.append(el('label', { text: '价格 cost' }), numInput(t, 'cost'));
        form.append(el('label', { text: '说明 desc' }), textInput(t, 'desc'));
        div.append(form);
        card.append(div);
      });
    } else {
      const form = el('div', { class: 'ed-form', style: 'grid-template-columns:70px 1fr' });
      form.append(el('label', { text: '名称 name' }), textInput(item, 'name'));
      form.append(el('label', { text: '价格 cost' }), numInput(item, 'cost'));
      form.append(el('label', { text: '说明 desc' }), textInput(item, 'desc'));
      card.append(form);
    }
    main.append(card);
  }
  main.append(el('p', { class: 'hint', text: 'key 被游戏代码引用，不可修改；仅名称 / 价格 / 说明可编辑。' }));
}

// --- tab 2：船舱 ---
function renderCabins() {
  const main = document.getElementById('cabins-main');
  main.innerHTML = '';
  const keys = Object.keys(equip.cabins);

  const card = el('div', { class: 'card' });
  card.append(el('h3', { text: '船舱类型（9 种）' }));
  const table = el('table', { class: 'ed-table' });
  table.append(el('tr', {},
    el('th', { text: 'key（只读）' }),
    el('th', { text: '名称 label' }),
    el('th', { text: '属性 stat' }),
    el('th', { text: '说明 desc' }),
  ));
  for (const k of keys) {
    const c = equip.cabins[k];
    table.append(el('tr', {},
      el('td', { text: k, style: 'font-family:monospace;color:#9db0c7' }),
      el('td', {}, textInput(c, 'label')),
      el('td', {}, statSelect(c, 'stat')),
      el('td', {}, textInput(c, 'desc')),
    ));
  }
  card.append(table);
  card.append(el('p', { class: 'hint', text: 'stat 为该船舱生效所依据的伙伴属性（leadership/seamanship/knowledge/intuition/courage/swordplay/luck/accounting/gunnery/navigation）。' }));
  main.append(card);

  const dcard = el('div', { class: 'card' });
  dcard.append(el('h3', { text: '新船默认船舱布局 cabinDefaults' }));
  const form = el('div', { class: 'ed-form', style: 'grid-template-columns:70px 200px' });
  equip.cabinDefaults.forEach((val, i) => {
    form.append(el('label', { text: `槽位 ${i + 1}` }));
    const sel = el('select', {});
    for (const k of keys) sel.append(el('option', { value: k, text: `${k}（${equip.cabins[k].label}）` }));
    sel.value = val;
    sel.onchange = () => { equip.cabinDefaults[i] = sel.value; dirty.mark(); };
    form.append(sel);
  });
  dcard.append(form);
  dcard.append(el('p', { class: 'hint', text: '新购船只的初始船舱布局，取值为上方 cabins 的 key。' }));
  main.append(dcard);
}

// --- tab 3：平衡参数 ---
function renderBalance() {
  const main = document.getElementById('balance-main');
  main.innerHTML = '';
  const groups = [
    {
      title: '时间与经济',
      hint: '航行时间与游戏日长度决定整体节奏；银行利率按日结算存款利息。',
      fields: [
        ['sailDayScale', '航行时间加速', {}],
        ['dayLengthSec', '每游戏日秒数', { min: 1 }],
        ['bankInterest', '银行日利率（小数）', { float: true, max: 1 }],
      ],
    },
    {
      title: '补给与疲劳',
      hint: '每日补给消耗 = drainBase + 船员数 × drainPerCrew；每次结算疲劳 +fatiguePerSettle，断粮时 ×starvingFatigueMul。',
      fields: [
        ['drainBase', '补给消耗基数', {}],
        // drainPerCrew 默认为 0.25（小数），不能用整数步进
        ['drainPerCrew', '每船员消耗（小数）', { float: true, step: 0.05 }],
        ['fatiguePerSettle', '疲劳增量', {}],
        ['starvingFatigueMul', '断粮疲劳倍率', {}],
      ],
    },
    {
      title: '疲劳致死',
      hint: '每日疲劳致死人数 = deathBase + 船员数 × (deathMinPct + random × deathRandPct)。',
      fields: [
        ['deathBase', '疲劳致死基数', {}],
        ['deathMinPct', '致死比例下限（小数）', { float: true, max: 1 }],
        ['deathRandPct', '致死随机幅度（小数）', { float: true, max: 1 }],
      ],
    },
  ];
  for (const grp of groups) {
    const card = el('div', { class: 'card' });
    card.append(el('h3', { text: grp.title }));
    const form = el('div', { class: 'ed-form', style: 'grid-template-columns:220px 110px' });
    for (const [k, label, opts] of grp.fields) {
      form.append(el('label', { text: `${label}（${k}）` }), numInput(balance, k, opts));
    }
    card.append(form, el('p', { class: 'hint', text: grp.hint }));
    main.append(card);
  }

  const card = el('div', { class: 'card' });
  card.append(el('h3', { text: '海盗' }));
  const form = el('div', { class: 'ed-form', style: 'grid-template-columns:220px 1fr' });
  form.append(el('label', { text: '海盗船型池（pirateShips）' }));
  const shipInp = el('input', { type: 'text', value: (balance.pirateShips || []).join(', '), style: 'width:100%' });
  shipInp.onchange = () => {
    balance.pirateShips = shipInp.value.split(',').map(s => s.trim()).filter(Boolean);
    shipInp.value = balance.pirateShips.join(', ');
    dirty.mark();
  };
  form.append(shipInp);
  form.append(el('label', { text: '海盗刷新间隔秒（pirateRate）' }), numInput(balance, 'pirateRate', { min: 0 }));
  card.append(form);
  card.append(el('p', { class: 'hint', text: '船型池用逗号分隔（保存时拆成数组并去除空格），须为 ships.json 中的船名；pirateRate 为 0 时不刷新海盗。' }));
  main.append(card);
}

// --- tabs ---
function setTab(t) {
  tab = t;
  for (const k of TABS) {
    document.getElementById('tab-' + k).classList.toggle('active', k === t);
    document.getElementById('pane-' + k).classList.toggle('active', k === t);
  }
  document.getElementById('btn-export').textContent = '导出 ' + TAB_FILE[t];
  if (t === 'outfit') renderOutfit();
  else if (t === 'cabins') renderCabins();
  else renderBalance();
}
for (const k of TABS) {
  document.getElementById('tab-' + k).onclick = () => setTab(k);
}

// --- 导入 / 导出（tab 1/2 共用 equipment.json，tab 3 用 balance.json） ---
const isNum = (v) => Number.isFinite(v);

function validateEquipment(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '应为对象 { outfit, cabins, cabinDefaults }';
  if (!Array.isArray(d.outfit) || !d.outfit.length) return 'outfit 应为非空数组';
  for (const item of d.outfit) {
    if (!item || typeof item !== 'object') return 'outfit 每项应为对象';
    if (typeof item.key !== 'string' || !item.key) return 'outfit 每项需含字符串 key';
    const entries = Array.isArray(item.tiers) ? item.tiers : [item];
    if (!entries.length) return `outfit.${item.key} 的 tiers 应为非空数组`;
    for (const t of entries) {
      if (!t || typeof t !== 'object') return `outfit.${item.key} 的条目应为对象`;
      if (typeof t.name !== 'string') return `outfit.${item.key} 缺少字符串 name`;
      if (!isNum(t.cost) || t.cost < 0) return `outfit.${item.key} 的 cost 应为 ≥0 的数值`;
      if (typeof t.desc !== 'string') return `outfit.${item.key} 缺少字符串 desc`;
    }
  }
  if (!d.cabins || typeof d.cabins !== 'object' || Array.isArray(d.cabins)) return 'cabins 应为对象';
  for (const [k, c] of Object.entries(d.cabins)) {
    if (!c || typeof c !== 'object') return `cabins.${k} 应为对象`;
    if (typeof c.label !== 'string') return `cabins.${k} 缺少字符串 label`;
    if (!STATS.includes(c.stat)) return `cabins.${k}.stat 须为伙伴属性名（${STATS.join('/')}）`;
    if (typeof c.desc !== 'string') return `cabins.${k} 缺少字符串 desc`;
  }
  if (!Array.isArray(d.cabinDefaults)) return 'cabinDefaults 应为数组';
  for (const k of d.cabinDefaults) {
    if (!d.cabins[k]) return `cabinDefaults 中的 "${k}" 不是 cabins 的 key`;
  }
  return null;
}

function validateBalance(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return '应为对象';
  for (const k of ['sailDayScale', 'dayLengthSec', 'bankInterest', 'drainBase', 'drainPerCrew',
    'fatiguePerSettle', 'starvingFatigueMul', 'deathBase', 'deathMinPct', 'deathRandPct', 'pirateRate']) {
    if (!isNum(d[k])) return `${k} 应为数值`;
  }
  if (!Array.isArray(d.pirateShips) || !d.pirateShips.every(s => typeof s === 'string')) {
    return 'pirateShips 应为字符串数组';
  }
  return null;
}

document.getElementById('btn-export').onclick = () => {
  if (tab === 'balance') saveFile('balance.json', toJSONBlob(balance));
  else saveFile('equipment.json', toJSONBlob(equip));
  dirty.clear();
};

document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(f.buffer));
    if (tab === 'balance') {
      const err = validateBalance(parsed);
      if (err) throw new Error(err);
      balance = parsed;
      renderBalance();
    } else {
      const err = validateEquipment(parsed);
      if (err) throw new Error(err);
      equip = parsed;
      if (tab === 'cabins') renderCabins();
      else renderOutfit();
    }
    dirty.mark();
    toast(`已导入 ${f.name} → ${TAB_FILE[tab]}`);
  } catch (e) {
    toast('导入失败: ' + e.message);
  }
};

setTab('outfit');
