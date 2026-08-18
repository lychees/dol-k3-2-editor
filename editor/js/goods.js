// goods.js — 商品经济编辑器 (goods.json)
// Schema:
// {
//   regions: { "<区域>": { available: {商品: [buy,sell]}, prices: {商品: [buy,sell]} } },  // 13 个区域
//   specialties: { "<港口id>": { name: 商品, price: 价格 } }
// }
// prices 包含全部 46 种商品；available 是 prices 的子集（本地可买到的商品）。
import { loadJSON, saveFile, toJSONBlob, pickFile, el, pageHeader, makeDirty, toast } from './common.js';

pageHeader('商品经济编辑器', 'goods.json — 13 区域 × 46 商品 + 港口特产');

const dirty = makeDirty();
let goods = await loadJSON('goods.json');
let ports = await loadJSON('ports.json').catch(() => []);
const portName = {};
for (const p of ports) portName[p.id] = p.name;

const ALL_GOODS = [...new Set(
  Object.values(goods.regions).flatMap(r => Object.keys(r.prices))
)].sort();

let curRegion = Object.keys(goods.regions)[0];

// ---------- 区域价格 ----------
const regionSelect = document.getElementById('region-select');
const goodsTbody = document.querySelector('#goods-table tbody');

function renderRegionSelect() {
  regionSelect.innerHTML = '';
  for (const r of Object.keys(goods.regions)) {
    regionSelect.append(el('option', { value: r, text: r, ...(r === curRegion ? { selected: '' } : {}) }));
  }
}
regionSelect.onchange = () => { curRegion = regionSelect.value; renderGoodsTable(); };

function renderGoodsTable() {
  goodsTbody.innerHTML = '';
  const reg = goods.regions[curRegion];
  for (const g of ALL_GOODS) {
    if (!reg.prices[g]) reg.prices[g] = [0, 0];
    const [buy, sell] = reg.prices[g];
    const avail = Object.prototype.hasOwnProperty.call(reg.available, g);

    const chk = el('input', { type: 'checkbox' });
    chk.checked = avail;
    chk.onchange = () => {
      if (chk.checked) {
        reg.available[g] = [+buyInp.value || 0, +sellInp.value || 0];
        reg.prices[g][0] = +buyInp.value || 0;
      } else {
        delete reg.available[g];
        reg.prices[g][0] = 0;
        buyInp.value = 0;
      }
      dirty.mark();
      nameTd.className = chk.checked ? '' : 'avail-off';
    };

    const nameTd = el('td', { text: g, class: avail ? '' : 'avail-off' });

    const buyInp = el('input', { type: 'number', value: buy, min: 0 });
    buyInp.onchange = () => {
      const v = Math.max(0, Math.round(+buyInp.value || 0));
      buyInp.value = v;
      reg.prices[g][0] = v;
      if (avail && reg.available[g]) reg.available[g][0] = v;
      dirty.mark();
    };
    const sellInp = el('input', { type: 'number', value: sell, min: 0 });
    sellInp.onchange = () => {
      const v = Math.max(0, Math.round(+sellInp.value || 0));
      sellInp.value = v;
      reg.prices[g][1] = v;
      if (avail && reg.available[g]) reg.available[g][1] = v;
      dirty.mark();
    };

    goodsTbody.append(el('tr', {},
      el('td', {}, chk), nameTd, el('td', {}, buyInp), el('td', {}, sellInp)));
  }
}

// ---------- 港口特产 ----------
const specTbody = document.querySelector('#spec-table tbody');

function renderSpecTable() {
  specTbody.innerHTML = '';
  const ids = Object.keys(goods.specialties).sort((a, b) => +a - +b);
  for (const pid of ids) {
    const spec = goods.specialties[pid];
    const sel = el('select');
    for (const g of ALL_GOODS) sel.append(el('option', { value: g, text: g, ...(g === spec.name ? { selected: '' } : {}) }));
    sel.onchange = () => { spec.name = sel.value; dirty.mark(); };

    const price = el('input', { type: 'number', value: spec.price, min: 0 });
    price.onchange = () => { spec.price = Math.max(0, Math.round(+price.value || 0)); price.value = spec.price; dirty.mark(); };

    const del = el('button', { class: 'danger', text: '删除' });
    del.onclick = () => { if (confirm(`删除港口 ${pid} 的特产？`)) { delete goods.specialties[pid]; dirty.mark(); renderSpecTable(); } };

    specTbody.append(el('tr', {},
      el('td', { text: pid }),
      el('td', { text: portName[pid] || '(未知港口)' }),
      el('td', {}, sel),
      el('td', {}, price),
      el('td', {}, del),
    ));
  }
}

document.getElementById('btn-add-spec').onclick = () => {
  const pid = prompt('港口 id（1–132，见 ports.json）：');
  if (!pid) return;
  if (goods.specialties[pid]) { toast('该港口已有特产'); return; }
  goods.specialties[pid] = { name: ALL_GOODS[0], price: 100 };
  dirty.mark(); renderSpecTable();
};

// ---------- tabs ----------
const tabR = document.getElementById('tab-regions');
const tabS = document.getElementById('tab-specialties');
function setTab(t) {
  tabR.classList.toggle('active', t === 'r');
  tabS.classList.toggle('active', t === 's');
  document.getElementById('pane-regions').style.display = t === 'r' ? '' : 'none';
  document.getElementById('pane-specialties').style.display = t === 's' ? '' : 'none';
}
tabR.onclick = () => setTab('r');
tabS.onclick = () => setTab('s');

// ---------- import / export ----------
document.getElementById('btn-export').onclick = () => { saveFile('goods.json', toJSONBlob(goods)); dirty.clear(); };
document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    goods = JSON.parse(new TextDecoder().decode(f.buffer));
    curRegion = Object.keys(goods.regions)[0];
    dirty.mark(); renderRegionSelect(); renderGoodsTable(); renderSpecTable();
    toast(`已导入 ${f.name}`);
  } catch (e) { toast('JSON 解析失败: ' + e.message); }
};

renderRegionSelect();
renderGoodsTable();
renderSpecTable();
