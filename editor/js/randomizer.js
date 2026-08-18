// Seeded randomizer (inspired by Gilmok/UWNHRando).
// Deterministic: same seed + same options -> same world.

// --- seed hashing + PRNG -----------------------------------------------------
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (rnd, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// --- market randomization -----------------------------------------------------
// Per UWNHRando: every good available somewhere, buy < sell per region,
// specialties never duplicate the home region's market.
function randomizeMarkets(rnd, goodsData) {
  const regions = Object.keys(goodsData.regions);
  const allGoods = Object.keys(goodsData.regions[regions[0]].prices);
  const covered = new Set();

  // guarantee coverage: deal all goods to regions first
  const hands = regions.map(() => []);
  allGoods.forEach((g, i) => hands[i % regions.length].push(g));

  const out = {};
  regions.forEach((region, i) => {
    // 8-12 goods: the dealt hand + random extras
    const n = 8 + Math.floor(rnd() * 5);
    const avail = new Set(hands[i]);
    for (const g of shuffle(rnd, allGoods)) {
      if (avail.size >= n) break;
      avail.add(g);
    }
    avail.forEach(g => covered.add(g));

    const available = {};
    const prices = {};
    for (const g of allGoods) {
      const [b0, s0] = goodsData.regions[region].prices[g];
      if (avail.has(g)) {
        const buy = Math.max(1, Math.round(b0 * (0.7 + rnd() * 0.6)));
        const sell = Math.max(buy + 1, Math.round(buy * (1.1 + rnd() * 0.5)));
        available[g] = [buy, sell];
        prices[g] = [buy, sell];
      } else {
        const sell = Math.max(1, Math.round(s0 * (0.9 + rnd() * 0.6)));
        prices[g] = [0, sell];
      }
    }
    out[region] = { available, prices };
  });

  // any good that ended up covered nowhere: force it into a random region
  for (const g of allGoods) {
    if (!covered.has(g)) {
      const region = pick(rnd, regions);
      const [b0, s0] = out[region].prices[g];
      const buy = Math.max(1, Math.round((b0 || s0) * 0.8));
      out[region].available[g] = [buy, Math.max(buy + 1, Math.round(buy * 1.3))];
    }
  }
  return out;
}

function randomizeSpecialties(rnd, regionsRnd, portRegion, ports) {
  const allGoods = Object.keys(regionsRnd[Object.keys(regionsRnd)[0]].prices);
  const specs = {};
  for (const p of ports) {
    const region = portRegion(p.id);
    const homeAvail = region ? Object.keys(regionsRnd[region].available) : [];
    const candidates = allGoods.filter(g => !homeAvail.includes(g));
    const good = pick(rnd, candidates.length ? candidates : allGoods);
    const base = region ? (regionsRnd[region].prices[good]?.[1] ?? 50) : 50;
    specs[p.id] = { name: good, price: Math.max(1, Math.round(base * 0.8)) };
  }
  return specs;
}

// --- geography randomization ---------------------------------------------------
function randomizePorts(rnd, ports, snapCoast) {
  const used = [];
  return ports.map(p => {
    let [x, y] = snapCoast(rnd);
    // keep ports apart
    for (let tries = 0; tries < 20; tries++) {
      if (used.every(([ux, uy]) => Math.hypot(ux - x, uy - y) >= 8)) break;
      [x, y] = snapCoast(rnd);
    }
    used.push([x, y]);
    return { ...p, x, y };
  });
}

function randomizeDiscoveries(rnd, villages, snapLand) {
  return villages.map(v => {
    const [x, y] = snapLand(rnd);
    return { ...v, x, y };
  });
}

// --- world map structure generation ---------------------------------------------
// 3-octave value noise -> threshold at a land-percentage quantile, then
// flood-fill the ocean so all water is reachable (circumnavigable).
function valueNoise(rnd, gw, gh, cols, rows) {
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const s = t => t * t * (3 - 2 * t);
  return (x, z) => {
    // wrap-aware sampling: the map is a torus (edges connect)
    const gx = x / cols * gw, gz = z / rows * gh;
    const x0 = Math.floor(gx) % gw, z0 = Math.floor(gz) % gh;
    const x1 = (x0 + 1) % gw, z1 = (z0 + 1) % gh;
    const fx0 = gx - Math.floor(gx), fz0 = gz - Math.floor(gz);
    const fx = s(fx0), fz = s(fz0);
    const v00 = grid[z0 * gw + x0], v10 = grid[z0 * gw + x1];
    const v01 = grid[z1 * gw + x0], v11 = grid[z1 * gw + x1];
    return v00 + (v10 - v00) * fx + (v01 - v00) * fz + (v00 - v10 - v01 + v11) * fx * fz;
  };
}

export function generateWorldMap(rnd, COLS, ROWS, seaId, landIds, opts = {}) {
  // continent scale: bigger base grid -> smaller, islander continents
  const gw = opts.continents === 'small' ? 18 : opts.continents === 'medium' ? 12 : 8;
  const gh = Math.round(gw * 0.6);
  const n1 = valueNoise(rnd, gw, gh, COLS, ROWS);
  const n2 = valueNoise(rnd, gw * 3, gh * 3, COLS, ROWS);
  const n3 = valueNoise(rnd, gw * 8, gh * 8, COLS, ROWS);
  const val = new Float32Array(COLS * ROWS);
  const LAND_PCT = opts.landPct ?? (0.16 + rnd() * 0.08);
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x;
      val[i] = 0.55 * n1(x, z) + 0.3 * n2(x, z) + 0.15 * n3(x, z);
    }
  }
  const sorted = Float32Array.from(val).sort();
  const thr = sorted[Math.floor((1 - LAND_PCT) * sorted.length)];
  const data = new Uint8Array(COLS * ROWS).fill(seaId);
  const n4 = valueNoise(rnd, 40, 20, COLS, ROWS);
  const POLAR = opts.polar === false ? 0 : 0.045;
  for (let i = 0; i < data.length; i++) {
    if (val[i] >= thr) {
      const z = (i / COLS) | 0;
      if (Math.min(z, ROWS - 1 - z) < ROWS * POLAR) {
        data[i] = landIds[2];            // polar land renders as snow
        continue;
      }
      const t = n4((i % COLS), z);
      data[i] = t < 0.7 ? landIds[0] : (t < 0.95 || POLAR === 0) ? landIds[1] : landIds[2];
    }
  }
  // ocean connectivity: flood fill from every WATER tile on the map edge.
  // (starting in a random inland lake would seal the MAIN ocean instead!)
  const reach = new Uint8Array(COLS * ROWS);
  const q = [];
  const seedAt = (x, z) => {
    const i = wrapI(x, z);
    if (data[i] === seaId && !reach[i]) { reach[i] = 1; q.push([x, z]); }
  };
  const wrapI = (x, z) => ((z % ROWS + ROWS) % ROWS) * COLS + ((x % COLS + COLS) % COLS);
  for (let x = 0; x < COLS; x++) { seedAt(x, 0); seedAt(x, ROWS - 1); }
  for (let z = 0; z < ROWS; z++) { seedAt(0, z); seedAt(COLS - 1, z); }
  // edges might be all ice: fall back to the first water tile anywhere
  if (!q.length) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === seaId) { reach[i] = 1; q.push([i % COLS, Math.floor(i / COLS)]); break; }
    }
  }
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (x + dx + COLS) % COLS, nz = (z + dz + ROWS) % ROWS;
      const ni = nz * COLS + nx;
      if (!reach[ni] && data[ni] === seaId) { reach[ni] = 1; q.push([nx, nz]); }
    }
  }
  let sealed = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === seaId && !reach[i]) { data[i] = landIds[0]; sealed++; }
  }

  // de-speckle: majority filter so landmasses become solid and coastlines clean
  // (raw noise is full of 1-tile specks that make every coast a sandstorm)
  for (let pass = 0; pass < 2; pass++) {
    const src = Uint8Array.from(data);
    const at = (x, z) => src[((z + ROWS) % ROWS) * COLS + ((x + COLS) % COLS)];
    for (let z = 0; z < ROWS; z++) {
      for (let x = 0; x < COLS; x++) {
        let water = 0, land = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (at(x + dx, z + dz) === seaId) water++; else land++;
          }
        }
        const i = z * COLS + x;
        // flip only clear minorities, keep everything else as-is
        if (water >= 7 && land > 0 && src[i] !== seaId) data[i] = seaId;
        else if (land >= 7 && water > 0 && src[i] === seaId) data[i] = landIds[0];
      }
    }
  }

  // rivers: meander inland from the coast (the coast pass edges them for free)
  const MOUNT = [53, 54, 55, 56, 61, 62];
  const at2 = (x, z) => data[((z + ROWS) % ROWS) * COLS + ((x + COLS) % COLS)];
  const setAt = (x, z, v) => { data[((z + ROWS) % ROWS) * COLS + ((x + COLS) % COLS)] = v; };
  const nRivers = opts.riverCount ?? (8 + Math.floor(rnd() * 8));
  if (typeof window !== 'undefined') window.__riverLog = { planned: nRivers, started: 0, carved: 0 };
  for (let r = 0; r < nRivers; r++) {
    // start on a water tile next to land, walk inland
    let x = -1, z = -1, dir = null;
    for (let t = 0; t < 300 && dir === null; t++) {
      const tx = Math.floor(rnd() * COLS), tz = Math.floor(rnd() * ROWS);
      if (at2(tx, tz) !== seaId) continue;
      // walk INLAND: toward the land neighbor, not away from it
      for (const [dx, dz, d] of [[1, 0, 'e'], [-1, 0, 'w'], [0, 1, 's'], [0, -1, 'n']]) {
        if (at2(tx + dx, tz + dz) !== seaId) { x = tx; z = tz; dir = d; break; }
      }
    }
    if (dir === null) continue;
    if (typeof window !== 'undefined') window.__riverLog.started++;
    const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
    const TURNS = {
      n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'],
    };
    for (let len = 0; len < 20 + rnd() * 50; len++) {
      const [dx, dz] = DIRS[dir];
      x += dx; z += dz;
      const t = at2(x, z);
      if (t === seaId) break;                    // reached open water/lake
      setAt(x, z, seaId);                        // carve the river channel
      if (typeof window !== 'undefined') window.__riverLog.carved++;
      if (rnd() < 0.35) dir = TURNS[dir][rnd() < 0.5 ? 0 : 1];   // meander
    }
  }

  // mountains: random clusters on land (hills, peaks, volcanoes)
  const nMount = opts.mountCount ?? (15 + Math.floor(rnd() * 10));
  for (let m = 0; m < nMount; m++) {
    let x = -1, z = -1;
    for (let t = 0; t < 200; t++) {
      const tx = Math.floor(rnd() * COLS), tz = Math.floor(rnd() * ROWS);
      if (at2(tx, tz) !== seaId && at2(tx, tz) !== 82) { x = tx; z = tz; break; }
    }
    if (x < 0) continue;
    const size = 8 + Math.floor(rnd() * 24);
    for (let len = 0; len < size; len++) {
      if (at2(x, z) !== seaId && at2(x, z) !== 82) {
        setAt(x, z, MOUNT[Math.floor(rnd() * MOUNT.length)]);
      }
      // wander but stay on land when possible
      for (let tries = 0; tries < 4; tries++) {
        const nx = x + [-1, 0, 1][Math.floor(rnd() * 3)];
        const nz = z + [-1, 0, 1][Math.floor(rnd() * 3)];
        if (at2(nx, nz) !== seaId) { x = nx; z = nz; break; }
      }
    }
  }

  // smooth coastlines (marching squares): each sea tile touching land gets
  // the shore tile whose land-edge signature matches its neighbors
  const SIG_MAP = {
    0: [1], 1: [11, 27], 2: [6, 14, 30], 3: [12, 20, 28], 4: [8, 16, 32],
    6: [9, 17, 25], 8: [5, 13, 21, 29], 9: [10, 18, 26], 11: [2, 3],
    12: [7, 15, 23, 31], 15: [4],
  };
  // shore tiles are color-matched to the adjacent land (grass/sand/snow)
  const SNOW_SHORE = new Set([18, 20, 22, 23, 24, 25]);
  if (opts.coastSmoothing === false) return { data, sealedLakes: sealed };
  const shoreClass = t => t >= 26 ? 'sand' : SNOW_SHORE.has(t) ? 'snow' : 'grass';
  const landClass = t => t === 82 ? 'snow' : t === 90 ? 'sand' : 'grass';
  // snapshot first: converting in place would cascade "land neighbor" across
  // the whole ocean (shore tiles are not seaId and look like land)
  const pre = Uint8Array.from(data);
  const POLAR_BAND = POLAR;
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x;
      if (pre[i] !== seaId) continue;
      const at = (dx, dz) => pre[((z + dz + ROWS) % ROWS) * COLS + ((x + dx + COLS) % COLS)];
      let sig = 0;
      const lands = [];
      if (at(0, -1) !== seaId) { sig |= 1; lands.push(at(0, -1)); }
      if (at(1, 0) !== seaId)  { sig |= 2; lands.push(at(1, 0)); }
      if (at(0, 1) !== seaId)  { sig |= 4; lands.push(at(0, 1)); }
      if (at(-1, 0) !== seaId) { sig |= 8; lands.push(at(-1, 0)); }
      const polarBand = Math.min(z, ROWS - 1 - z) < ROWS * POLAR_BAND;
      if (!sig) {
        // polar open water gets ice chunks occasionally
        if (polarBand && rnd() < 0.3) data[i] = 19;
        continue;
      }
      const cands = SIG_MAP[sig] ?? [1];
      // dominant adjacent land class decides the shore color
      const cls = landClass(lands[Math.floor(rnd() * lands.length)]);
      const match = cands.filter(t => shoreClass(t) === cls);
      const pool = match.length ? match : cands;
      data[i] = pool[Math.floor(rnd() * pool.length)];
    }
  }
  return { data, sealedLakes: sealed };
  return { data, sealedLakes: sealed };
}

// --- main entry ------------------------------------------------------------------
/**
 * Apply the randomizer to the game's data objects (mutates them).
 * opts: { seed, markets, specialties, startShip, portDev, portLocations, discoveries }
 * deps: { goodsData, villages, ports, portMeta, snapCoast, snapLand, ships }
 * Returns a summary of what was randomized.
 */
export function applyRandomizer(opts, deps) {
  const seed = hashSeed(opts.seed ?? Math.floor(Math.random() * 1e9));
  const rnd = mulberry32(seed);
  const summary = { seed };

  const regionsRnd = opts.markets ? randomizeMarkets(rnd, deps.goodsData)
                                  : deps.goodsData.regions;
  if (opts.markets) {
    for (const r of Object.keys(regionsRnd)) deps.goodsData.regions[r] = regionsRnd[r];
    summary.markets = true;
  }
  if (opts.specialties) {
    deps.goodsData.specialties =
      randomizeSpecialties(rnd, regionsRnd, deps.portRegion, deps.ports);
    summary.specialties = true;
  }
  if (opts.portDev) {
    for (const p of deps.ports) {
      deps.portDev[p.id] = { dev: 100 + Math.floor(rnd() * 500), mine: 0 };
    }
    summary.portDev = true;
  }
  if (opts.portLocations) {
    const moved = randomizePorts(rnd, deps.ports, deps.snapCoast);
    deps.ports.forEach((p, i) => { p.x = moved[i].x; p.y = moved[i].y; });
    summary.portLocations = true;
  }
  if (opts.discoveries) {
    const moved = randomizeDiscoveries(rnd, deps.villages, deps.snapLand);
    deps.villages.forEach((v, i) => { v.x = moved[i].x; v.y = moved[i].y; });
    summary.discoveries = true;
  }
  if (opts.startShip) {
    const small = deps.ships.slice(0, 6);
    summary.startShip = pick(rnd, small).name;
  }
  return summary;
}
