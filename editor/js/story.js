// story.js — 剧情编辑器 (story.json)
// story.json: [ { title, steps: [ { name, goal, reward, text } ] } ]（7 条，按主角索引）
// 结构固定：按索引覆盖游戏内置 STORYLINES 的展示文案，check/progress 逻辑不可数据化。
import { loadJSON, saveFile, toJSONBlob, pickFile, el, pageHeader, makeDirty, toast, assetURL, probeAssets } from './common.js';

pageHeader('剧情编辑器', 'story.json — 7 位主角的主线剧情');

const HEROES = [
  { name: 'João Ferrero',    img: 'dos/hero_joao.png' },
  { name: 'Catalina Erantzo', img: 'dos/hero_catalina.png' },
  { name: 'Otto Baynes',     img: 'dos/hero_otto.png' },
  { name: 'Ernst Von Bohr',  img: 'dos/hero_ernst.png' },
  { name: 'Pietro Conti',    img: 'dos/hero_pietro.png' },
  { name: 'Ali Vezas',       img: 'dos/hero_ali.png' },
  { name: 'Isabella',        img: 'waifu/isabella.png' },
];

const dirty = makeDirty();
await probeAssets();
// 优先读游戏 assets 里的 story.json；独立部署（线上）时游戏站点可能还没有该文件，
// 回退到编辑器内置的副本 editor/data/story.json（与游戏内置剧情一致）。
let data;
try {
  data = await loadJSON('story.json');
} catch {
  data = await (await fetch('./data/story.json')).json();
  toast('游戏站点暂无 story.json，已加载编辑器内置副本');
}
let heroIdx = 0;   // 当前主角 tab
let stepIdx = 0;   // 当前选中步骤（用于预览）

const tabsEl = document.getElementById('tabs');
const titleInp = document.getElementById('line-title');
const stepsEl = document.getElementById('steps');

function heroImgURL(i) {
  return encodeURI(assetURL(HEROES[i].img));
}

// --- tabs ---
function renderTabs() {
  tabsEl.innerHTML = '';
  data.forEach((line, i) => {
    const hero = HEROES[i] || { name: `#${i}` };
    const btn = el('button', {
      class: i === heroIdx ? 'active' : '',
      text: `${hero.name} — ${line.title}`,
    });
    btn.onclick = () => { heroIdx = i; stepIdx = 0; renderTabs(); renderEditor(); };
    tabsEl.append(btn);
  });
}

// --- editor ---
function renderEditor() {
  const line = data[heroIdx];
  titleInp.value = line.title;
  stepsEl.innerHTML = '';

  line.steps.forEach((step, si) => {
    const card = el('div', { class: 'step-card' + (si === stepIdx ? ' selected' : '') });
    card.onclick = () => { if (stepIdx !== si) { stepIdx = si; renderEditor(); } };

    card.append(el('div', { class: 'step-head', text: `第 ${si + 1} 章 / 共 ${line.steps.length} 章` }));

    const form = el('div', { class: 'ed-form' });

    form.append(el('label', { text: '章节名 name' }));
    const nameInp = el('input', { type: 'text', value: step.name });
    nameInp.onchange = () => { step.name = nameInp.value; dirty.mark(); renderPreview(); };
    form.append(nameInp);

    form.append(el('label', { text: '目标 goal' }));
    const goalInp = el('input', { type: 'text', value: step.goal });
    goalInp.onchange = () => { step.goal = goalInp.value; dirty.mark(); renderPreview(); };
    form.append(goalInp);

    form.append(el('label', { text: '奖励 reward' }));
    const rewardInp = el('input', { type: 'number', value: step.reward ?? 0, min: 0 });
    rewardInp.onchange = () => { step.reward = Math.max(0, Math.round(+rewardInp.value || 0)); rewardInp.value = step.reward; dirty.mark(); };
    form.append(rewardInp);

    form.append(el('label', { text: '剧情文本 text' }));
    const textInp = el('textarea', { text: step.text });
    textInp.value = step.text;
    textInp.onchange = () => { step.text = textInp.value; dirty.mark(); renderPreview(); };
    form.append(textInp);

    card.append(form);
    stepsEl.append(card);
  });
  renderPreview();
}

// --- preview ---
function renderPreview() {
  const step = data[heroIdx].steps[stepIdx];
  document.getElementById('pv-img').src = heroImgURL(heroIdx);
  document.getElementById('pv-name').textContent = `${HEROES[heroIdx].name} — ${step.name}`;
  document.getElementById('pv-goal').textContent = `目标：${step.goal}　奖励：${step.reward} 金币`;
  document.getElementById('pv-text').textContent = step.text;
}

titleInp.onchange = () => {
  data[heroIdx].title = titleInp.value;
  dirty.mark(); renderTabs();
};

// --- import / export ---
document.getElementById('btn-export').onclick = () => {
  saveFile('story.json', toJSONBlob(data));
  dirty.clear();
};
document.getElementById('btn-import').onclick = async () => {
  const f = await pickFile('.json');
  if (!f) return;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(f.buffer));
    if (!Array.isArray(parsed) || !parsed.every(l => l && typeof l.title === 'string' && Array.isArray(l.steps))) {
      throw new Error('格式不符：应为数组，且每项含 title（字符串）与 steps（数组）');
    }
    data = parsed;
    heroIdx = 0; stepIdx = 0;
    dirty.mark(); renderTabs(); renderEditor();
    toast(`已导入 ${f.name} → story.json`);
  } catch (e) { toast('导入失败: ' + e.message); }
};

renderTabs();
renderEditor();
