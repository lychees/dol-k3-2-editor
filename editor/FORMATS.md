# UW 数据格式参考（编辑器用）

所有数据文件位于 `game/assets/`。编辑器通过 `../assets/` 相对路径读取。

## world_map.bin — 世界地图
- 2160 × 1080 字节，每字节一个 tile id，**1-based**，行优先（`id = bin[y*2160+x]`）。
- id 1–32 为可航行水域（游戏内约定），其余为陆地/特殊地形。
- 图块集：`tiles_day.png`（另有 dawn/dusk/night 三相位），16px 图块，每行 16 个，
  id 1 = 左上角第一格，行优先排列（`sx=(id-1)%16*16, sy=floor((id-1)/16)*16`）。
- 世界为环面（toroidal）：东西、南北均环绕。

## portmaps.bin — 港口地图
- 101 张地图 × 96×96 字节连续排列，共 930816 字节，**0-based** tile id。
- 游戏 shader 显示时 +1；编辑器存储时保持 0-based。
- 港口图块集：`portchips/NNN_<phase>.png`，`NNN = String(2*tileset).padStart(3,'0')`，
  phase ∈ dawn/day/dusk/night；tileset 来自 `port_meta.json` 中该港口的 `tileset` 字段（0–6）。
  图块 16px，16 列 × 15 行（256×240 px），显示 id = 文件 id + 1。
- 港口 id → portmap 索引映射（main.js `PORT_MAP_OVERRIDE`）：
  `mapIdx = { 131: 94, 132: 0 }[pid] ?? Math.min(pid - 1, 100)`。
  即 Tamsui(131) 用索引 94（Zeiton），Faro(132) 用索引 0（Lisbon）。

## ports.json — 港口坐标
- 数组：`[{ id, name, x, y }]`，x/y 为世界地图 tile 坐标（2160×1080）。

## port_meta.json — 港口元数据
- 对象：`{ "<id>": { name, tileset, region, buildings: { "<建筑id>": [x, y] }, maid? } }`
- `tileset`: 0–6，对应 portchips 文件（NNN = 2*tileset，3 位零填充）。
- `region`: 13 个区域之一（见 goods.json 的 regions 键）。
- `buildings`: 建筑 id → 港口地图 tile 坐标（96×96）。建筑 id 见 building_names.json：
  1 market, 2 bar, 3 dry_dock, 4 harbor, 5 inn, 6 palace, 7 job_house, 8 msc,
  9 bank, 10 item_shop, 11 church, 12 fortune_house, 13 cemetery, 14 teacher, 15 home。
- `maid`: maids.json 中的编号（可选）。

## ships.json — 船型
- 对象：`{ "<船名>": { durability, power, capacity, guns, min_crew, max_crew, price, tacking } }`

## mates.json — 伙伴
- 对象（键为字符串编号 "1"–"50"）：
  `{ name, nation, lv, leadership, seamanship, knowledge, intuition, courage, swordplay, luck, accounting, gunnery, navigation, image: [x, y] }`
- `image`: figures.png 中的 1-based [列, 行]（65×81 头像格，16 列 × 8 行）。

## maids.json — 酒吧女郎
- `{ "<id>": { name, image: [x, y] } }`，image 同上。

## mates_extra.json — 原创角色
- `{ "<id>": { ...同 mates, portrait: "./assets/waifu/x.png" } }`，id > 50（当前 51–54：
  Eudora / Mita / Sophia / Barbara，Isabella 的初始同伴，游戏开始自动入队）。
- `portrait` 为自定义头像图片路径，优先于 figures.png 的 image 格；删除该字段即回退图集头像。
- 技能（accounting/gunnery/navigation）为 0–100 量表（initMateSkills 中 ≥25 折算满级 10），
  与 mates.json 的 0–3 不同。
- 游戏启动时按 id 覆盖 main.js 内置的同名角色；文件缺失时保留内置数据。
- 编辑器内置副本 `editor/data/mates_extra.json` 供线上独立部署时回退。

## goods.json — 商品经济
- `{ regions: { "<区域>": { available: {商品: [buy,sell]}, prices: {商品: [buy,sell]} } }, specialties: { "<港口id>": { name, price } } }`
- 13 个区域：Iberia, Northern Europe, The Mediterranean, North Africa, Ottoman Empire,
  West Africa, Central America, South America, East Africa, Middle East, India,
  Southeast Asia, Far East。
- `prices` 含全部 46 种商品；`available` 为其子集（本地可购）。买价 0 = 不生产。
- `specialties` 键为港口 id（字符串）。

## villages.json — 发现物
- 数组：`[{ id, name, x, y, desc, img: [col, row], subject }]`（98 个）。
- x/y 为世界地图 tile 坐标；`img` 为 discoveries.png 中 1-based [列, 行]（49px 格，16 列 × 8 行，无前边距）。
- `subject` 为学科分类（biology / archaeology 等）。

## heroes.json — 主角与成长公式（养成）
- `{ attrs: [...7 位主角的六维], growth: {...} }`。
- `attrs[i]` = `{ str, agi, con, int, per, cha }`（3–18），索引同主角（0 João … 6 Isabella）。
- `growth` 公式系数（main.js 的 GROWTH，缺失时内置默认值）：
  - `maxHp = base + perLv×lv + con×conMul`；`maxSp = base + perLv×lv + int×intMul + per×perMul`
  - `atk = (base + perLv×lv + weaponBonus[武器tier] + floor(str/strDiv)) × (疲劳≥90 时 ×fatigueFactor)`
  - `def = floor(lv/defLvDiv) + armorBonus[护甲tier]`；升级 exp = `lv × expPerLv`
  - `weaponBonus` / `armorBonus`：tier 0–3 四档
  - `mateSkill`：伙伴技能 `lv = clamp(1..maxLv, floor(属性/statDiv) + 技能加成)`，升级 xp = `lv × xpPerLv`
- 编辑器内置副本 `editor/data/heroes.json` 供线上回退。

## monsters.json — 陆地怪物（陆上探险战斗）
- 数组：`[{ name, img: [col,row], hp, atk, def, exp, gold }]`（8 只）。
- `img` 为 discoveries.png 的 1-based [列, 行]（49px 格）。
- 数组下标即难度 tier：野外离船越远遇到的 tier 越高；新增怪物会扩展难度梯度。
- 编辑器内置副本 `editor/data/monsters.json` 供线上回退。

## story.json — 主线剧情
- 数组，7 条剧情线（按主角索引 0–6：João / Catalina / Otto / Ernst / Pietro / Ali / Isabella）：
  `[{ title, steps: [{ name, goal, reward, text }] }]`
- 游戏启动时按索引覆盖 main.js 内置 STORYLINES 的展示字段（name/goal/reward/text）；
  完成条件 check() 与进度 progress() 是代码逻辑，不可数据化。
- 结构固定：步骤数量需与内置一致（多余项被忽略，缺失项保留内置文案）。
- 编辑器内置副本 `editor/data/story.json` 供线上独立部署时回退。

## gvo_map.json — GVO 素材映射
- `{ goods: { UW2商品名: 图标文件名 }, discoveries: { 村庄id: GVO发现物id } }`
- 游戏 gvo.js 启动时加载；GVO 素材包选中时，商品图标与发现物大图按此表跨域引用
  `https://lychees.github.io/dol-rev/`（Pages 带 ACAO:*）。
- 发现物大图 `assets/discovery/{id:04d}_a.png`（128px）、图标 `_i.png`（48px）。
- 由 gvo_ref/ 脚本初始生成；**editor/gvoimport.html 可向其中追加新导入的发现物**。
- 编辑器内置副本 `editor/data/gvo_map.json` 供线上回退。

## equipment.json — 舰船装备与船舱
- `{ outfit: [...], cabins: {...}, cabinDefaults: [...] }`
- `outfit`：6 项装备。sails/cannons 为 3 档 `tiers: [{name, cost, desc}]`；
  ram/figurehead/boarding/armor 为单件 `{key, name, cost, desc}`。key 被游戏代码引用，不可改。
- `cabins`：9 种船舱 `{ label, stat, desc }`；stat 为伙伴属性名（leadership/navigation 等）。
- `cabinDefaults`：新船默认船舱布局（cabins 的 key 数组）。
- 游戏启动时读取覆盖内置表；文件缺失回退内置。副本 `editor/data/equipment.json`。

## balance.json — 全局平衡参数
- sailDayScale（航行时间加速）、dayLengthSec（每游戏日秒数）、bankInterest（银行日利率）、
  drainBase/drainPerCrew（补给消耗 = (base + 船员×perCrew)/天）、fatiguePerSettle（疲劳增量）、
  starvingFatigueMul（断粮疲劳倍率）、deathBase/deathMinPct/deathRandPct（疲劳致死 =
  base + 船员×(minPct + random×randPct)）、pirateShips（海盗船型池）、pirateRate（海盗刷新秒，0=无）。
- 游戏启动时读取覆盖内置值；文件缺失回退内置。副本 `editor/data/balance.json`。

## towns.json — 内陆城镇
- 数组：`[{ id, name, x, z }]`（z 即世界地图 y 坐标）。

## ruins.json — 遗迹
- 数组：`[{ id, name, x, z, desc }]`。

## 图片资产（已验证尺寸）
- `figures.png` — 1047×655，头像格 pitch 65×81（16 列 × 8 行），1-based [列, 行]；
  游戏绘制时内缩 3px：`drawImage(img, (x-1)*65+3, (y-1)*81+3, 59, 75, ...)`。
- `tiles_day.png` — 256×128，16px 图块 16 列 × 8 行（共 128 个，id 1–128）。
- `portchips/NNN_day.png` — 256×240，16px 图块 16 列 × 15 行（共 240 个）。
- `discoveries.png` — 785×393，49px 格 16 列 × 8 行，无前边距。
- `heroes.png` — 544×612，68px 格 8 列 × 9 行。
- `npc_atlas.png` — 512×640；`ship-tileset.png` — 256×128；`person-tileset.png` — 1024×32。
- `heroes.png` — 6 主角 × 8 帧，68px 格。
- `npc_atlas.png` — Jephed NPC 图集，40 角色，行 = 方向（down/left/right/up）。
- `discoveries.png` — 发现物美术，49px 格。
- `ship-tileset.png`, `person-tileset.png` — 船/人行走图。
- `tiles_{dawn,day,dusk,night}.png` — 世界图块集四相位。
- `ships/`, `buildings/`, `dos/`, `waifu/`, `portchips/` — 子目录资产。
- `music/`, `sounds/` — 音频（ogg）。

## 存档说明
- 游戏存档在 localStorage（`uw-save-v1`）。修改 assets 不影响已有存档的部分数据
  （如已购船只属性按购买时快照保存），新游戏最可靠。
