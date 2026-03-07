/* ============================================================
   Baseball Universe — app.js
   Complete game engine, team generator, narratives, drag-drop
   ============================================================ */

/* ---- Helpers ---- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const pick = a => a[Math.floor(Math.random() * a.length)];
const rand = (lo, hi) => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id_' + Math.random().toString(16).slice(2));
const esc = s => (s ?? '').toString().replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(msg, dur = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), dur);
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

function weightedChoice(items) {
  const total = items.reduce((s, i) => s + Math.max(0, i.w), 0);
  let r = Math.random() * total;
  for (const it of items) { r -= Math.max(0, it.w); if (r <= 0) return it.key; }
  return items[items.length - 1].key;
}

/* ---- IndexedDB ---- */
const DB_NAME = 'baseball_universe_v2', DB_VER = 1;
const STORE = 'teams';

function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id' });
        st.createIndex('name', 'name'); st.createIndex('updatedAt', 'updatedAt');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function dbAll() { const db = await openDB(); return new Promise((res,rej) => { const r = db.transaction(STORE,'readonly').objectStore(STORE).getAll(); r.onsuccess = () => res(r.result||[]); r.onerror = () => rej(r.error); }); }
async function dbPut(t) { const db = await openDB(); return new Promise((res,rej) => { const tx = db.transaction(STORE,'readwrite'); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); tx.objectStore(STORE).put(t); }); }
async function dbDel(id) { const db = await openDB(); return new Promise((res,rej) => { const tx = db.transaction(STORE,'readwrite'); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); tx.objectStore(STORE).delete(id); }); }

function fileToDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/* ---- App State ---- */
const app = {
  teams: [],          // user teams from DB
  genTeams: [],       // generated CPU teams (localStorage)
  activeTeamId: null,
  homeTeamId: null,
  awayTeamId: null,
  game: null,
  season: {},         // { teamId: { wins, losses, history:[] } }
  statsAccum: {},     // { teamId: { players: {pid: {...}}, pitchers: {pid: {...}} } }
  pendingPlayerImg: null,
};

/* ---- Presets ---- */
const PRESETS = {
  custom:   { HIT:65, PWR:50, SPD:55, DEF:55, ARM:55, PIT:0,  STM:70 },
  contact:  { HIT:85, PWR:42, SPD:62, DEF:58, ARM:52, PIT:0,  STM:75 },
  slugger:  { HIT:62, PWR:90, SPD:44, DEF:52, ARM:55, PIT:0,  STM:68 },
  speedster:{ HIT:70, PWR:38, SPD:95, DEF:62, ARM:50, PIT:0,  STM:80 },
  glove:    { HIT:60, PWR:44, SPD:60, DEF:95, ARM:72, PIT:0,  STM:72 },
  cannon:   { HIT:56, PWR:52, SPD:55, DEF:74, ARM:95, PIT:0,  STM:70 },
  ace:      { HIT:28, PWR:18, SPD:38, DEF:58, ARM:68, PIT:92, STM:85 },
  reliever: { HIT:22, PWR:18, SPD:42, DEF:60, ARM:72, PIT:82, STM:60 },
  utility:  { HIT:68, PWR:58, SPD:62, DEF:68, ARM:65, PIT:22, STM:74 },
  rookie:   { HIT:44, PWR:35, SPD:50, DEF:40, ARM:42, PIT:20, STM:55 },
  legend:   { HIT:95, PWR:92, SPD:88, DEF:90, ARM:88, PIT:88, STM:95 },
};

function calcOVR(p) {
  const bat = p.HIT * 0.42 + p.PWR * 0.33 + p.SPD * 0.14 + p.DEF * 0.08 + p.ARM * 0.03;
  const pit = p.PIT * 0.7 + p.ARM * 0.15 + p.STM * 0.15;
  const base = p.isPitcher ? pit * 0.75 + bat * 0.25 : bat * 0.80 + (p.DEF * 0.12 + p.ARM * 0.08);
  return Math.round(clamp(base, 0, 99));
}

function calcTeamOVR(team) {
  if (!team.players?.length) return 0;
  const top = [...team.players].map(calcOVR).sort((a,b)=>b-a).slice(0,9);
  return Math.round(top.reduce((s,x)=>s+x,0)/top.length);
}

function teamLabel(t) { return [t.city, t.name].filter(Boolean).join(' '); }

/* ================================================================
   TEAM GENERATOR — 300+ pre-built CPU opponents
   ================================================================ */
const GEN_CITIES = [
  'Riverside','Ironwood','Crestfall','Duskport','Sundale','Ashfield','Cobaltville',
  'Stormhaven','Redrock','Goldmoor','Silverton','Briarwood','Westgate','Fairhaven',
  'Northvale','Eastbrook','Southcrest','Lakewood','Hillcrest','Pinecrest','Oceanside',
  'Desertwind','Frostburg','Thunderpass','Shadowpeak','Sugarmill','Irongate','Copperhead',
  'Blackwater','Crimson Bay','Ember Falls','Falcon Ridge','Granite Bluff','Hazel Creek',
  'Ivory Shores','Jade River','Kestrel Point','Lunar Flats','Marble Cliff','Neon Harbor',
  'Obsidian Peak','Painted Rock','Quarry Bend','Ruby Mesa','Sapphire Lake','Twilight Cove',
  'Umber Hills','Violet Pines','Whisper Valley','Xenon City','Yonder Bluffs','Zephyr Coast',
  'Amber Fields','Bronze Peak','Cedar Run','Driftwood Bay','Echo Canyon','Fossil Ridge',
  'Granite Falls','Heron Bay','Indigo Bluff','Juniper Creek','Keystone Flats','Lapis City',
];
const GEN_NAMES = [
  'Thunder','Cyclones','Rockets','Phantoms','Vipers','Wolves','Ravens','Titans','Bears',
  'Eagles','Cobras','Falcons','Storm','Dragons','Sharks','Lions','Jaguars','Panthers',
  'Bulldogs','Knights','Mustangs','Blazers','Comets','Meteors','Tempest','Ghosts','Fury',
  'Outlaws','Bandits','Rustlers','Rangers','Voyagers','Drifters','Nomads','Pioneers',
  'Warlords','Guardians','Sentinels','Specters','Vipers','Stingers','Hornets','Wasps',
];
const GEN_DIVS = ['North Division','South Division','East Division','West Division','Central Division','Pacific League','Atlantic League'];
const GEN_COLORS = [
  ['#3b82f6','#1d4ed8'],['#ef4444','#b91c1c'],['#22c55e','#15803d'],
  ['#f59e0b','#b45309'],['#8b5cf6','#6d28d9'],['#ec4899','#be185d'],
  ['#06b6d4','#0e7490'],['#f97316','#c2410c'],['#14b8a6','#0f766e'],
  ['#6366f1','#4338ca'],['#84cc16','#4d7c0f'],['#e11d48','#9f1239'],
];
const GEN_FIRSTNAMES = ['Jake','Max','Rico','Dario','Blaze','Finn','Cruz','Ace','Dash','Rex','Kai','Zane','Tuck','Bo','Colt','Stone','Flint','Gray','Duke','Hawk','Buck','Chase','Brent','Nick','Troy','Lance','Brad','Cole','Kyle','Wade','Seth','Reid','Nate','Luke','Dex','Lex','Beau','Jett','Ty','Rip','Vin','Zak','Omar','Leo','Felix','Dante','Marco','Paulo','Sergio','Carlos'];
const GEN_LASTNAMES = ['Torres','Martinez','Johnson','Cruz','Rivera','Perez','Smith','Davis','Brown','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Garcia','Clark','Lewis','Walker','Hall','Allen','Young','Hernandez','King','Wright','Lopez','Hill','Scott','Green','Adams','Baker','Nelson','Carter','Mitchell','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins'];
const GEN_POSITIONS = ['C','1B','2B','3B','SS','LF','CF','RF','DH','P'];

function genPlayer(isPit) {
  const fn = pick(GEN_FIRSTNAMES), ln = pick(GEN_LASTNAMES);
  const base = isPit ? rand(50,90) : rand(40,88);
  const noise = () => clamp(base + rand(-18,18), 10, 99);
  return {
    id: uid(), name: fn + ' ' + ln, img: null,
    pos: isPit ? 'P' : pick(['C','1B','2B','3B','SS','LF','CF','RF','DH']),
    isPitcher: isPit, isStar: Math.random() < 0.12, isCaptain: false,
    HIT: isPit ? rand(15,40) : noise(),
    PWR: isPit ? rand(10,35) : noise(),
    SPD: isPit ? rand(20,50) : noise(),
    DEF: noise(),
    ARM: noise(),
    PIT: isPit ? clamp(base + rand(-10,10), 40, 99) : rand(0,25),
    STM: isPit ? rand(55,95) : rand(50,90),
  };
}

function generateCPUTeam(idx) {
  const city = GEN_CITIES[idx % GEN_CITIES.length];
  const name = GEN_NAMES[Math.floor(idx / GEN_CITIES.length) % GEN_NAMES.length] || pick(GEN_NAMES);
  const [c1,c2] = GEN_COLORS[idx % GEN_COLORS.length];
  const div = GEN_DIVS[idx % GEN_DIVS.length];
  const players = [];
  // 2 starters, 1 reliever
  players.push(genPlayer(true), genPlayer(true));
  const rp = genPlayer(true); rp.pos = 'RP'; players.push(rp);
  // 8 fielders
  const poss = ['C','1B','2B','3B','SS','LF','CF','RF'];
  for (const pos of poss) { const p = genPlayer(false); p.pos = pos; players.push(p); }
  // DH + 1 extra
  players.push(genPlayer(false), genPlayer(false));
  return {
    id: 'cpu_' + idx, name, city, stadium: city + ' Park', homeAdv: rand(0,6),
    colors: [c1, c2, '#ffffff'], logo: null, motto: '',
    division: div, players, createdAt: 0, updatedAt: 0, isCPU: true,
  };
}

function getGenTeams() {
  const raw = localStorage.getItem('bb_gen_teams');
  if (raw) { try { return JSON.parse(raw); } catch {} }
  return [];
}

function setGenTeams(teams) {
  localStorage.setItem('bb_gen_teams', JSON.stringify(teams));
  app.genTeams = teams;
}

function generateAllTeams() {
  const teams = [];
  for (let i = 0; i < 320; i++) teams.push(generateCPUTeam(i));
  setGenTeams(teams);
  toast('✅ 320 CPU teams generated!');
  renderLeague();
  renderAllSelects();
}

function allTeams() { return [...app.teams, ...app.genTeams]; }

/* ================================================================
   NARRATIVE ENGINE — rich play-by-play descriptions
   ================================================================ */
const NARRATIVES = {
  HR: [
    (b,p,r) => `💥 ${b} absolutely CRUSHES one to deep center! That ball is GONE! ${r>1?`${r} runs score!`:'Solo shot!'}`,
    (b,p,r) => `🚀 ${b} unloads on a fastball and LAUNCHES it over the left field wall! HOME RUN! ${r>1?`${r} RBIs!`:''}`,
    (b,p,r) => `⚡ BACK BACK BACK… GONE! ${b} with a MONSTER home run to right! The crowd goes WILD!`,
    (b,p,r) => `🎯 ${b} turns on it — pure contact — that ball is OUT OF HERE! ${r>1?`Grand slam! ${r} runs!`:''}`,
    (b,p,r) => `🔥 ${p} thought that was a good pitch — ${b} DISAGREED in the most emphatic way possible! HOME RUN!`,
    (b,p,r) => `✨ ${b} watches it all the way… and it CLEARS the fence by a mile! ${r} run${r!==1?'s':''} score!`,
  ],
  TRIPLE: [
    (b,p,r) => `🏃 ${b} rips one into the gap and NEVER STOPS RUNNING — triple! ${r>0?`${r} run${r!==1?'s':''} score!`:''}`,
    (b,p,r) => `💨 ${b} hits it to the deepest part of the park and legs it into a stand-up triple! What speed!`,
    (b,p,r) => `🔥 LINE DRIVE to the corner! ${b} rounds first… rounds second… SAFE AT THIRD! Triple!`,
    (b,p,r) => `⭐ ${b} sends it to the warning track and blazes around the bases — triple city!`,
  ],
  DOUBLE: [
    (b,p,r) => `🎯 ${b} smokes a gapper into left-center! Stand-up double! ${r>0?`${r} run${r!==1?'s':''} score!`:''}`,
    (b,p,r) => `💥 ${b} BANGS one off the left field wall! The ball bounces back and ${b} slides into second!`,
    (b,p,r) => `📢 ${b} laces a frozen rope into the right-field corner — DOUBLE! ${r>0?`Runners score!`:''}`,
    (b,p,r) => `🔥 A scorching liner skips past the outfielder — ${b} pulls up easily at second!`,
    (b,p,r) => `✨ ${b} puts a perfect swing on that pitch and drives it into the gap for a double!`,
  ],
  SINGLE: [
    (b,p,r) => `🟢 ${b} slaps a clean single into left field! ${r>0?`${r} run${r!==1?'s':''} score!`:''}`,
    (b,p,r) => `📌 ${b} pokes one through the right side — base hit!`,
    (b,p,r) => `🎯 ${b} chops a grounder through the infield for a single! ${r>0?`A run comes around to score!`:''}`,
    (b,p,r) => `💡 ${b} works the count and flares one into shallow left — single!`,
    (b,p,r) => `🟢 Line drive by ${b}! Right at the outfielder but just out of reach — base hit!`,
    (b,p,r) => `✅ ${b} punches a fastball right up the middle — single to center!`,
    (b,p,r) => `📢 Soft liner from ${b} drops in front of the charging outfielder — single!`,
  ],
  WALK: [
    (b,p,r) => `🎯 ${b} works the count perfectly — ball four, take your base! ${r>0?`A run is forced in!`:''}`,
    (b,p,r) => `😤 ${p} couldn't find the strike zone — ${b} draws the walk!`,
    (b,p,r) => `📋 ${b} shows great plate discipline and earns a free pass on four pitches. ${r>0?`Bases loaded walk scores a run!`:''}`,
    (b,p,r) => `💡 ${b} lays off a slider in the dirt — ball four! Head to first!`,
  ],
  K: [
    (b,p,f) => `🔴 ${b} goes down swinging — that was a NASTY breaking ball from ${p}!`,
    (b,p,f) => `❌ Strike three! ${b} was completely fooled by the changeup — ${p} with another K!`,
    (b,p,f) => `🔴 ${p} blows a heater right past ${b} — caught looking! Strike three!`,
    (b,p,f) => `❌ ${b} swings over the top of it — strikeout! ${p} is dealing today!`,
    (b,p,f) => `🔴 A back-foot slider buckles ${b}'s knees — inning over!`,
    (b,p,f) => `❌ ${b} takes strike three right down the middle. Couldn't pull the trigger!`,
  ],
  OUT_GROUND: [
    (b,f) => `⚪ ${b} bounces one to ${f} who makes the routine play — out at first.`,
    (b,f) => `🟤 Ground ball to ${f}… scoops and throws — out! Nothing fancy.`,
    (b,f) => `⚪ ${b} hits a weak roller to ${f} — no chance, he's thrown out easily.`,
  ],
  OUT_FLY: [
    (b,f) => `🌤️ ${b} lifts a lazy fly ball to ${f} who camps under it — easy out.`,
    (b,f) => `⚪ Deep fly to ${f} at the warning track — caught at the wall! Good read by the outfielder!`,
    (b,f) => `🌤️ ${b} pops it up… ${f} drifts back and makes the catch. Inning alive.`,
  ],
  OUT_LINE: [
    (b,f) => `🔵 ${b} lines out sharply to ${f} who snags it on a dive! Spectacular!`,
    (b,f) => `⚪ Screaming liner by ${b} — but ${f} is right there for the out!`,
  ],
  DP: [
    (f1,f2,r) => `⚡ DOUBLE PLAY! ${f1} to ${f2} — they turn two and end the threat! The crowd erupts!`,
    (f1,f2,r) => `🔁 ${f1} fields it, steps on second, fires to first — 6-4-3 double play! Inning OVER!`,
    (f1,f2,r) => `⚡ Oh wow, around the horn double play! ${f1} starts it, ${f2} finishes it!`,
  ],
  STEAL_SUCCESS: [
    n => `💨 ${n} takes off on the first pitch — SAFE! Stolen base! What a read!`,
    n => `🏃 ${n} FLIES down the baseline — beats the throw easily! He's in!`,
    n => `💨 ${n} gets a great jump and the catcher's throw is too late — stolen base!`,
  ],
  STEAL_CAUGHT: [
    (n,f) => `🟥 ${n} is GUNNED DOWN by ${f}! Caught stealing — huge play by the defense!`,
    (n,f) => `❌ ${n} tried to go but ${f} fires a bullet — out at second! That arm is special!`,
  ],
  ERROR: [
    (b,f) => `😬 ${f} BOOTS IT! ${b} reaches safely on the error! The crowd groans!`,
    (b,f) => `🟡 ${f} had it — and he DROPPED IT! ${b} is safe on the miscue!`,
    (b,f) => `😬 Routine grounder right to ${f}… and it goes right THROUGH HIS LEGS! Error charged!`,
  ],
  HALF_END: [
    (inn,side) => `— End of the ${side} ${inn}. Switching sides. —`,
  ],
  GAME_END: [
    (wt, wScore, lt, lScore) => `🏆 FINAL: ${wt} ${wScore}, ${lt} ${lScore}. ${wt} wins! What a game!`,
    (wt, wScore, lt, lScore) => `🎉 BALLGAME! ${wt} defeats ${lt} by a score of ${wScore}–${lScore}!`,
    (wt, wScore, lt, lScore) => `⚾ That's all she wrote! ${wt} takes it ${wScore} to ${lScore}. See you next time!`,
  ],
  TIED_GAME: [
    (inn) => `🔥 We're TIED going into extra innings! Inning ${inn} coming up!`,
  ],
};

function narrative(type, ...args) {
  const pool = NARRATIVES[type];
  if (!pool) return '';
  return pick(pool)(...args);
}


/* ================================================================
   GAME ENGINE
   ================================================================ */
function pickPitcher(team) {
  const pits = (team.players || []).filter(p => p.isPitcher || p.pos === 'P');
  return pits.sort((a,b) => (b.PIT||0) - (a.PIT||0))[0]
    || [...(team.players||[])].sort((a,b) => (b.PIT||0) - (a.PIT||0))[0]
    || null;
}

function buildLineup(team) {
  const nonPit = (team.players || []).filter(p => !(p.isPitcher || p.pos === 'P' || p.pos === 'RP'));
  return nonPit.length ? nonPit : (team.players || []);
}

function makeGame(home, away) {
  const ensureBox = (team) => {
    const b = { R:0, H:0, E:0, players:{}, pitchers:{} };
    for (const p of (team.players||[])) {
      b.players[p.id] = { name:p.name, pos:p.pos, isPitcher:p.isPitcher, AB:0, H:0, HR:0, RBI:0, R:0, BB:0, K:0, SB:0, CS:0, _2B:0, _3B:0, teamId:team.id };
    }
    return b;
  };
  return {
    home, away,
    inning:1, top:true, outs:0,
    scoreHome:0, scoreAway:0,
    balls:0, strikes:0,
    bases:[null,null,null],
    idxHome:0, idxAway:0,
    pitcherHome: pickPitcher(home),
    pitcherAway: pickPitcher(away),
    box: { home: ensureBox(home), away: ensureBox(away) },
    done:false,
  };
}

function offTeam(g) { return g.top ? g.away : g.home; }
function defTeam(g) { return g.top ? g.home : g.away; }
function offBox(g)  { return g.top ? g.box.away : g.box.home; }
function defBox(g)  { return g.top ? g.box.home : g.box.away; }
function curPitcher(g) { return g.top ? g.pitcherHome : g.pitcherAway; }

function nextBatter(g) {
  const team = offTeam(g);
  const lineup = buildLineup(team);
  if (!lineup.length) return null;
  const key = team.id === g.home.id ? 'idxHome' : 'idxAway';
  const b = lineup[g[key] % lineup.length];
  g[key] = (g[key]+1) % lineup.length;
  return b;
}

function teamDefAvg(team) {
  const ps = team.players||[];
  if (!ps.length) return 0.5;
  return ps.slice().sort((a,b)=>(b.DEF||0)-(a.DEF||0)).slice(0,9).reduce((s,p)=>s+(p.DEF||0)/100,0)/Math.min(9,ps.length);
}

function pickFielder(team, preferHigh = 'DEF') {
  const nonPit = (team.players||[]).filter(p=>!p.isPitcher && p.pos!=='P' && p.pos!=='RP');
  const pool = nonPit.length ? nonPit : (team.players||[]);
  return pool.slice().sort((a,b)=>(b[preferHigh]||0)-(a[preferHigh]||0))[0] || pool[0] || null;
}

function atBatResult(batter, pitcher, defense) {
  const hit  = (batter.HIT||50)/100;
  const pwr  = (batter.PWR||50)/100;
  const spd  = (batter.SPD||50)/100;
  const pit  = (pitcher.PIT||50)/100;
  const def  = teamDefAvg(defense);

  const strikeW = clamp(0.10 + pit*0.22 - hit*0.10, 0.06, 0.34);
  const walkW   = clamp(0.05 + (1-pit)*0.09 - hit*0.02, 0.02, 0.14);
  const inplayW = clamp(1 - strikeW - walkW, 0.20, 0.88);

  const contact  = clamp(hit*(1-pit*0.65) + (hit-0.5)*0.15, 0.05, 0.92);
  const defBoost = 0.82 + def*0.36;

  const outW    = (1-contact)*1.2*defBoost;
  const singleW = contact*(0.60-pwr*0.16)/defBoost;
  const doubleW = contact*(0.20+pwr*0.08)/defBoost;
  const tripleW = contact*(0.025+spd*0.03)/defBoost;
  const hrW     = contact*(0.04+pwr*0.25)/defBoost;

  const prim = weightedChoice([{key:'K',w:strikeW},{key:'WALK',w:walkW},{key:'INPLAY',w:inplayW}]);
  if (prim==='K') return 'K';
  if (prim==='WALK') return 'WALK';
  return weightedChoice([{key:'OUT',w:outW},{key:'SINGLE',w:singleW},{key:'DOUBLE',w:doubleW},{key:'TRIPLE',w:tripleW},{key:'HR',w:hrW}]);
}

function advanceRunners(g, hitType, batter) {
  let runs = 0;
  const bx = offBox(g);

  const score = (runner, rbi_batter) => {
    if (!runner) return;
    runs++;
    if (bx.players[runner.id]) bx.players[runner.id].R++;
    if (rbi_batter && bx.players[rbi_batter.id]) bx.players[rbi_batter.id].RBI++;
    if (g.top) g.scoreAway++; else g.scoreHome++;
    if (bx) bx.R++;
  };

  if (hitType === 'WALK') {
    if (g.bases[0]&&g.bases[1]&&g.bases[2]) { score(g.bases[2], batter); g.bases[2]=null; }
    if (g.bases[1]&&g.bases[0]) { g.bases[2]=g.bases[1]; g.bases[1]=null; }
    if (g.bases[0]) { g.bases[1]=g.bases[0]; g.bases[0]=null; }
    g.bases[0] = batter;
  } else if (hitType === 'SINGLE') {
    if (g.bases[2]) { score(g.bases[2], batter); g.bases[2]=null; }
    if (g.bases[1]) { g.bases[2]=g.bases[1]; g.bases[1]=null; }
    if (g.bases[0]) { g.bases[1]=g.bases[0]; g.bases[0]=null; }
    g.bases[0] = batter;
    if (bx.players[batter.id]) { bx.players[batter.id].H++; bx.H++; }
  } else if (hitType === 'DOUBLE') {
    if (g.bases[2]) { score(g.bases[2], batter); g.bases[2]=null; }
    if (g.bases[1]) { score(g.bases[1], batter); g.bases[1]=null; }
    if (g.bases[0]) { g.bases[2]=g.bases[0]; g.bases[0]=null; }
    g.bases[1] = batter;
    if (bx.players[batter.id]) { bx.players[batter.id].H++; bx.players[batter.id]._2B++; bx.H++; }
  } else if (hitType === 'TRIPLE') {
    for (let i=0;i<3;i++) { if (g.bases[i]) { score(g.bases[i], batter); g.bases[i]=null; } }
    g.bases[2] = batter;
    if (bx.players[batter.id]) { bx.players[batter.id].H++; bx.players[batter.id]._3B++; bx.H++; }
  } else if (hitType === 'HR') {
    for (let i=0;i<3;i++) { if (g.bases[i]) { score(g.bases[i], batter); g.bases[i]=null; } }
    score(batter, batter);
    if (bx.players[batter.id]) { bx.players[batter.id].H++; bx.players[batter.id].HR++; bx.H++; }
  }
  return runs;
}

function tryDoublePlay(g, def, batter) {
  if (g.outs >= 2 || !g.bases[0]) return false;
  const runner = g.bases[0];
  const defAvg = teamDefAvg(def);
  const runSpd = (runner.SPD||50)/100;
  const dpChance = clamp(0.18+defAvg*0.22-runSpd*0.20, 0.02, 0.45);
  if (Math.random() > dpChance) return false;
  const f1 = pickFielder(def,'DEF'), f2 = pickFielder(def,'ARM');
  g.bases[0] = null;
  g.outs += 2;
  const bx = offBox(g);
  if (bx.players[batter.id]) bx.players[batter.id].AB++;
  return { f1:f1?.name||def.name, f2:f2?.name||def.name };
}

function trySteal(g) {
  if (g.outs >= 2) return false;
  const off = offTeam(g);
  const def = defTeam(g);
  const pit = curPitcher(g);
  let baseFrom = g.bases[0] ? 0 : (g.bases[1] ? 1 : -1);
  if (baseFrom === -1 || g.bases[baseFrom+1]) return false;

  const runner = g.bases[baseFrom];
  const spd = (runner.SPD||50)/100;
  const tryChance = clamp(0.03 + spd*0.18 + (runner.isStar?0.06:0), 0, 0.25);
  if (Math.random() > tryChance) return false;

  const armAvg = (def.players||[]).reduce((s,p)=>s+(p.ARM||50)/100,0)/Math.max(1,(def.players||[]).length);
  const pitCtrl = (pit?.PIT||50)/100;
  const success = clamp(0.55 + spd*0.32 - armAvg*0.20 - pitCtrl*0.10, 0.2, 0.85);

  if (Math.random() < success) {
    g.bases[baseFrom] = null;
    g.bases[baseFrom+1] = runner;
    const bx = offBox(g);
    if (bx.players[runner.id]) bx.players[runner.id].SB++;
    return { success:true, runner:runner.name, fielder:null };
  } else {
    g.bases[baseFrom] = null;
    g.outs++;
    const bx = offBox(g);
    if (bx.players[runner.id]) bx.players[runner.id].CS++;
    const catcher = (def.players||[]).find(p=>p.pos==='C') || pickFielder(def,'ARM');
    return { success:false, runner:runner.name, fielder:catcher?.name||def.name };
  }
}

function endHalfInning(g) {
  g.outs = 0;
  g.balls = 0;
  g.strikes = 0;
  g.bases = [null,null,null];
  const wasTop = g.top;
  g.top = !g.top;
  if (g.top) g.inning++;
  return wasTop;
}

function isGameOver(g) {
  if (g.inning < 9) return false;
  if (g.inning === 9 && g.top === false && g.scoreHome > g.scoreAway) return true; // walk-off
  if (g.inning >= 9 && !g.top && g.scoreHome !== g.scoreAway) return true;
  if (g.inning > 12) return true;
  return false;
}


/* ================================================================
   PLAY EXECUTION
   ================================================================ */
function doNextPlay() {
  const g = app.game;
  if (!g || g.done) { logMsg('Pick teams and press ▶ Play Ball! to start.', 'log-event'); return; }

  // Steal attempt first
  const steal = trySteal(g);
  if (steal) {
    if (steal.success) {
      logMsg(narrative('STEAL_SUCCESS', steal.runner), 'log-event');
      showHighlight(offTeam(g).players.find(p=>p.name===steal.runner), `${steal.runner} steals a base!`, 'STOLEN BASE');
    } else {
      logMsg(narrative('STEAL_CAUGHT', steal.runner, steal.fielder), 'log-k');
      const catPlayer = defTeam(g).players.find(p=>p.name===steal.fielder);
      showHighlight(catPlayer, `${steal.fielder} guns down ${steal.runner}!`, 'CAUGHT STEALING');
      if (g.outs >= 3) { endHalfInning(g); logHalf(g); }
    }
    updateGameUI();
    return;
  }

  const batter  = nextBatter(g);
  const pitcher = curPitcher(g);
  const def     = defTeam(g);

  if (!batter || !pitcher) {
    logMsg('⚠️ Team needs at least 1 batter and 1 pitcher (PIT > 0).', 'log-event');
    return;
  }

  const result = atBatResult(batter, pitcher, def);
  const bx = offBox(g);
  const pbx = bx.players[batter.id];
  const starChance = batter.isStar ? 0.70 : 0.35;

  if (result === 'K') {
    g.outs++;
    if (pbx) { pbx.AB++; pbx.K++; }
    logMsg(narrative('K', batter.name, pitcher.name), 'log-k');
    if (Math.random() < starChance) showHighlight(pitcher, `${pitcher.name} fans ${batter.name}!`, 'STRIKEOUT');
  }
  else if (result === 'OUT') {
    const dpResult = tryDoublePlay(g, def, batter);
    if (dpResult) {
      const f1 = pickFielder(def,'DEF'), f2 = pickFielder(def,'ARM');
      logMsg(narrative('DP', dpResult.f1, dpResult.f2), 'log-event');
      if (f1) showHighlight(f1, `${dpResult.f1} turns the double play!`, 'DOUBLE PLAY');
    } else if (Math.random() < 0.05) {
      // Error!
      const errFielder = pickFielder(def,'DEF');
      logMsg(narrative('ERROR', batter.name, errFielder?.name||def.name), 'log-event');
      if (g.bases[1] && Math.random()<0.5) { g.bases[2]=g.bases[1]; g.bases[1]=null; }
      if (g.bases[0] && Math.random()<0.5) { g.bases[1]=g.bases[0]; g.bases[0]=null; }
      g.bases[0] = batter;
      if (pbx) pbx.AB++;
      defBox(g).E++;
      showHighlight(batter, `${batter.name} reaches on an error!`, 'ERROR');
    } else {
      g.outs++;
      if (pbx) pbx.AB++;
      const fielder = pickFielder(def,'DEF');
      const outType = Math.random() < 0.5 ? 'OUT_GROUND' : (Math.random()<0.6 ? 'OUT_FLY' : 'OUT_LINE');
      logMsg(narrative(outType, batter.name, fielder?.name||def.name), 'log-out');
      if (Math.random() < 0.25) showHighlight(fielder, `${fielder?.name||def.name} makes the play!`, 'OUT');
    }
  }
  else if (result === 'WALK') {
    const runs = advanceRunners(g, 'WALK', batter);
    if (pbx) pbx.BB++;
    logMsg(narrative('WALK', batter.name, pitcher.name, runs), 'log-walk');
    if (runs > 0 || Math.random() < starChance) showHighlight(batter, `${batter.name} draws the walk!`, 'WALK');
  }
  else {
    // Hit
    const runs = advanceRunners(g, result, batter);
    const cls = result === 'HR' ? 'log-hr' : 'log-hit';
    logMsg(narrative(result, batter.name, pitcher.name, runs), cls);
    const caption = result === 'HR' ? `${batter.name} goes YARD! 🎉` :
                    result === 'TRIPLE' ? `${batter.name} triples!` :
                    result === 'DOUBLE' ? `${batter.name} doubles!` :
                    `${batter.name} singles!`;
    if (result === 'HR' || Math.random() < starChance) {
      showHighlight(batter, caption, result);
    }
  }

  // End half-inning?
  if (g.outs >= 3) {
    const wasTop = endHalfInning(g);
    logHalf(g);
    // Check walk-off
    if (isGameOver(g)) {
      g.done = true;
      endGame(g);
      return;
    }
  } else if (isGameOver(g)) {
    g.done = true;
    endGame(g);
    return;
  }

  updateGameUI();
}

function logHalf(g) {
  const side = g.top ? 'bottom of' : 'top of';
  const inn = g.top ? g.inning : g.inning - 1;
  logMsg(`— End of the ${side} inning ${inn}. Score: ${teamLabel(g.home)} ${g.scoreHome} – ${g.scoreAway} ${teamLabel(g.away)} —`, 'log-half');
}

function endGame(g) {
  const homeWin = g.scoreHome > g.scoreAway;
  const tied    = g.scoreHome === g.scoreAway;
  const winner  = homeWin ? g.home : g.away;
  const loser   = homeWin ? g.away : g.home;
  const msg = tied
    ? `🤝 FINAL — TIE GAME! ${teamLabel(g.home)} ${g.scoreHome} – ${g.scoreAway} ${teamLabel(g.away)}`
    : narrative('GAME_END', teamLabel(winner), homeWin ? g.scoreHome : g.scoreAway, teamLabel(loser), homeWin ? g.scoreAway : g.scoreHome);
  logMsg(msg, 'log-final');
  updateGameUI();

  // Record to season
  for (const teamId of [g.home.id, g.away.id]) {
    if (!app.season[teamId]) app.season[teamId] = { wins:0, losses:0, ties:0, history:[] };
    const isHome = teamId === g.home.id;
    const myScore = isHome ? g.scoreHome : g.scoreAway;
    const oppScore = isHome ? g.scoreAway : g.scoreHome;
    const oppTeam = isHome ? g.away : g.home;
    const result = myScore > oppScore ? 'W' : (myScore < oppScore ? 'L' : 'T');
    if (result === 'W') app.season[teamId].wins++;
    else if (result === 'L') app.season[teamId].losses++;
    else app.season[teamId].ties++;
    app.season[teamId].history.unshift({ result, myScore, oppScore, opp: teamLabel(oppTeam) });
    if (app.season[teamId].history.length > 50) app.season[teamId].history.pop();
  }
  localStorage.setItem('bb_season', JSON.stringify(app.season));
  renderStats();
}

function simHalfInning() {
  const g = app.game;
  if (!g || g.done) return;
  const startTop = g.top, startInn = g.inning;
  while (!g.done && g.top === startTop && g.inning === startInn) doNextPlay();
}

function simFullGame() {
  const g = app.game;
  if (!g || g.done) return;
  while (!g.done) simHalfInning();
}


/* ================================================================
   UI — Game
   ================================================================ */
function updateGameUI() {
  const g = app.game;
  if (!g) {
    $('#scoreNumHome').textContent = '0';
    $('#scoreNumAway').textContent = '0';
    $('#inningDisplay').textContent = 'PRE-GAME';
    $('#countDisplay').textContent = '';
    updateDiamond(null);
    return;
  }
  $('#scoreNumHome').textContent = g.scoreHome;
  $('#scoreNumAway').textContent = g.scoreAway;
  $('#scoreNameHome').textContent = teamLabel(g.home);
  $('#scoreNameAway').textContent = teamLabel(g.away);

  const side = g.top ? '▲' : '▼';
  const status = g.done ? 'FINAL' : `${side} INN ${g.inning}`;
  $('#inningDisplay').textContent = status;
  $('#countDisplay').textContent = `Outs: ${g.outs}`;

  if (g.home.logo) { $('#scoreLogoHome').src = g.home.logo; $('#scoreLogoHome').style.display=''; }
  else $('#scoreLogoHome').style.display='none';
  if (g.away.logo) { $('#scoreLogoAway').src = g.away.logo; $('#scoreLogoAway').style.display=''; }
  else $('#scoreLogoAway').style.display='none';

  updateDiamond(g);

  // Pitcher cards
  if (g.pitcherHome && g.pitcherAway) {
    $('#pitcherCard').style.display = '';
    const ph = g.pitcherHome, pa = g.pitcherAway;
    $('#pitcherHomeCard').innerHTML = `<div class="pitcher-mini-name">🏠 ${esc(ph.name)}</div><div class="pitcher-mini-stat">PIT ${ph.PIT} · STM ${ph.STM}</div>`;
    $('#pitcherAwayCard').innerHTML = `<div class="pitcher-mini-name">✈️ ${esc(pa.name)}</div><div class="pitcher-mini-stat">PIT ${pa.PIT} · STM ${pa.STM}</div>`;
  }
}

function updateDiamond(g) {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.setAttribute('display', on?'':'none'); };
  show('runner-1st', g?.bases[0]);
  show('runner-2nd', g?.bases[1]);
  show('runner-3rd', g?.bases[2]);
  // Highlight occupied bases
  const colorBase = (id, on) => { const el = document.getElementById(id); if(el) el.setAttribute('opacity', on ? '0.9' : '0.4'); };
  colorBase('base-1st', g?.bases[0]);
  colorBase('base-2nd', g?.bases[1]);
  colorBase('base-3rd', g?.bases[2]);
}

let logAll = [];
function logMsg(text, cls = '') {
  logAll.unshift({ text, cls });
  renderLog();
}

function renderLog() {
  const filterOn = $('#filterHighlights')?.checked;
  const log = $('#log');
  if (!log) return;
  const items = filterOn ? logAll.filter(l => ['log-hr','log-hit','log-event','log-final'].includes(l.cls)) : logAll;
  log.innerHTML = items.slice(0, 200).map(l => `<div class="log-line ${l.cls}">${esc(l.text)}</div>`).join('');
}

function showHighlight(player, caption, eventType = '') {
  const img = $('#highlightImg');
  const cap = $('#highlightCaption');
  const typ = $('#highlightType');
  const noHL = $('#noHighlight');

  if (player?.img) {
    img.src = player.img;
    img.style.display = '';
    noHL.style.display = 'none';
  } else {
    img.style.display = 'none';
    noHL.style.display = 'flex';
    noHL.innerHTML = `<span style="font-size:40px">⚾</span><span>${esc(caption)}</span>`;
  }
  cap.textContent = caption || '';
  typ.textContent = eventType;

  const card = $('#highlightCard');
  card.classList.remove('highlight-flash');
  void card.offsetWidth; // reflow
  card.classList.add('highlight-flash');
}

/* ================================================================
   UI — Tabs
   ================================================================ */
function setTab(name) {
  $$('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
}

/* ================================================================
   UI — Teams
   ================================================================ */
function renderTeamList() {
  const list = $('#teamList');
  const search = ($('#teamSearch')?.value || '').toLowerCase();
  const sort = $('#sortTeams')?.value || 'name';
  let teams = [...app.teams];
  if (search) teams = teams.filter(t => teamLabel(t).toLowerCase().includes(search));
  if (sort==='name') teams.sort((a,b)=>teamLabel(a).localeCompare(teamLabel(b)));
  else if (sort==='updated') teams.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
  else if (sort==='ovr') teams.sort((a,b)=>calcTeamOVR(b)-calcTeamOVR(a));

  $('#teamCount').textContent = teams.length + ' team' + (teams.length!==1?'s':'');

  if (!teams.length) {
    list.innerHTML = '<div class="tip-box">No teams yet! Click "+ New Team" to create one.</div>';
    return;
  }
  list.innerHTML = '';
  for (const t of teams) {
    const ovr = calcTeamOVR(t);
    const ovrCls = ovr>=80?'high':ovr>=60?'mid':'low';
    const div = document.createElement('div');
    div.className = 'team-item' + (t.id===app.activeTeamId?' selected':'');
    div.innerHTML = `
      <img class="team-logo-mini" src="${t.logo||''}" alt="" onerror="this.style.display='none'">
      <div class="team-item-info">
        <div class="team-item-name">${esc(teamLabel(t))}</div>
        <div class="team-item-meta">${t.players?.length||0} players · ${timeAgo(t.updatedAt)}</div>
      </div>
      <div class="ovr-pill ${ovrCls}">OVR ${ovr}</div>`;
    div.addEventListener('click', () => selectTeam(t.id));
    list.appendChild(div);
  }
}

function fillTeamEditor(team) {
  if (!team) {
    $('#previewName').textContent = 'No team selected';
    $('#previewSub').textContent = 'Create or pick a team.';
    $('#previewChips').innerHTML = '';
    $('#teamLogoPreview').style.display = 'none';
    return;
  }
  $('#teamName').value  = team.name || '';
  $('#teamCity').value  = team.city || '';
  $('#teamStadium').value = team.stadium || '';
  $('#teamHomeAdv').value = String(team.homeAdv||0);
  $('#teamMotto').value  = team.motto || '';
  $('#teamDivision').value = team.division || '';
  const [c1,c2,c3] = team.colors||['#3b82f6','#22c55e','#f59e0b'];
  $('#teamColor1').value = c1; $('#teamColor2').value = c2; $('#teamColor3').value = c3;

  const logo = $('#teamLogoPreview');
  if (team.logo) { logo.src = team.logo; logo.style.display=''; } else logo.style.display='none';

  $('#previewName').textContent = teamLabel(team);
  $('#previewSub').textContent = `${team.players?.length||0} players · OVR ${calcTeamOVR(team)}`;

  const chips = $('#previewChips');
  chips.innerHTML = [
    team.stadium ? `🏟️ ${team.stadium}` : '',
    team.division ? `📁 ${team.division}` : '',
    `🏠 Home +${team.homeAdv||0}%`,
    team.motto ? `💬 "${team.motto}"` : '',
  ].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join('');
}

function selectTeam(id) {
  app.activeTeamId = id;
  fillTeamEditor(app.teams.find(t=>t.id===id));
  renderTeamList();
  renderRoster();
}

/* ================================================================
   UI — Selects (dropdowns for home/away/active)
   ================================================================ */
function renderAllSelects() {
  const all = allTeams().sort((a,b)=>teamLabel(a).localeCompare(teamLabel(b)));
  for (const selId of ['activeTeamSelect','homeTeamSelect','awayTeamSelect','statsTeamSelect']) {
    const sel = document.getElementById(selId);
    if (!sel) continue;
    const cur = sel.value;
    sel.innerHTML = all.map(t => `<option value="${t.id}">${esc(teamLabel(t))} (OVR ${calcTeamOVR(t)})</option>`).join('');
    if (cur && all.some(t=>t.id===cur)) sel.value = cur;
  }
  if (!app.activeTeamId && app.teams[0]) app.activeTeamId = app.teams[0].id;
  if (!app.homeTeamId && app.teams[0]) app.homeTeamId = app.teams[0].id;
  if (!app.awayTeamId) {
    const opp = allTeams().find(t=>t.id!==app.homeTeamId);
    if (opp) app.awayTeamId = opp.id;
  }
  $('#activeTeamSelect').value = app.activeTeamId || '';
  $('#homeTeamSelect').value   = app.homeTeamId   || '';
  $('#awayTeamSelect').value   = app.awayTeamId   || '';
  if ($('#statsTeamSelect')) $('#statsTeamSelect').value = app.activeTeamId || '';
}


/* ================================================================
   UI — Roster
   ================================================================ */
const STAT_KEYS = ['HIT','PWR','SPD','DEF','ARM','PIT','STM'];

function setSliders(stats) {
  for (const k of STAT_KEYS) {
    const val = clamp(Number(stats[k]??0),0,100);
    const el = document.getElementById(k);
    const vEl = document.getElementById(k+'v');
    const bar = document.getElementById(k+'bar');
    if (el) el.value = String(val);
    if (vEl) vEl.textContent = String(val);
    if (bar) bar.style.width = val+'%';
  }
}

function readSliders() {
  const out = {};
  for (const k of STAT_KEYS) out[k] = clamp(Number(document.getElementById(k)?.value||0),0,100);
  return out;
}

function resetPlayerForm() {
  $('#playerName').value = '';
  $('#playerPos').value = 'DH';
  $('#preset').value = 'custom';
  $('#isPitcher').checked = false;
  $('#isStar').checked = false;
  $('#isCaptain').checked = false;
  setSliders(PRESETS.custom);
  app.pendingPlayerImg = null;
  const prev = $('#playerDropPreview');
  prev.src = ''; prev.classList.remove('has-img');
  $('#playerDropLabel').style.display = 'flex';
  $('#btnAddPlayer').dataset.editing = '';
  $('#btnAddPlayer').textContent = '+ Add Player';
}

function renderRoster() {
  const team = app.teams.find(t=>t.id===app.activeTeamId);
  const list = $('#rosterList');
  const filter = ($('#rosterFilter')?.value||'').toLowerCase();

  if (!team) {
    $('#rosterMeta').textContent = 'No team selected';
    list.innerHTML = '<div class="tip-box">Select a team on the Teams tab first.</div>';
    return;
  }

  $('#rosterMeta').textContent = `${teamLabel(team)} · ${team.players.length} players · OVR ${calcTeamOVR(team)}`;

  let players = [...team.players];
  if (filter) players = players.filter(p=>(p.name||'').toLowerCase().includes(filter)||(p.pos||'').toLowerCase().includes(filter));

  players.sort((a,b)=>{
    const ap=a.isPitcher?1:0, bp=b.isPitcher?1:0;
    if(ap!==bp) return bp-ap;
    const as=a.isStar?1:0, bs=b.isStar?1:0;
    if(as!==bs) return bs-as;
    return calcOVR(b)-calcOVR(a);
  });

  list.innerHTML = '';
  if (!players.length) { list.innerHTML = '<div class="tip-box">No players match the filter.</div>'; return; }

  for (const p of players) {
    const ovr = calcOVR(p);
    const card = document.createElement('div');
    card.className = 'player-card' + (p.isStar?' star-card':'');
    const badges = [
      `<span class="pbadge pos">${esc(p.pos||'DH')}</span>`,
      p.isPitcher ? `<span class="pbadge pit">P</span>` : '',
      p.isStar    ? `<span class="pbadge star">⭐</span>` : '',
      p.isCaptain ? `<span class="pbadge cap">🦁</span>` : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
      <img class="player-photo" src="${p.img||''}" alt="${esc(p.name)}" onerror="this.style.visibility='hidden'">
      <div class="player-info">
        <div class="player-name-row">${esc(p.name||'Unnamed')} <div class="player-badges">${badges}</div></div>
        <div class="player-stats-row">OVR ${ovr} · HIT ${p.HIT} · PWR ${p.PWR} · SPD ${p.SPD} · DEF ${p.DEF} · ARM ${p.ARM} · PIT ${p.PIT}</div>
      </div>
      <div class="player-actions">
        <button class="btn btn-ghost sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn-danger sm" data-del="${p.id}">✕</button>
      </div>`;

    card.querySelector('[data-del]').addEventListener('click', async () => {
      team.players = team.players.filter(x=>x.id!==p.id);
      await saveTeam(team); renderRoster();
    });
    card.querySelector('[data-edit]').addEventListener('click', () => {
      $('#playerName').value = p.name||'';
      $('#playerPos').value  = p.pos||'DH';
      $('#isPitcher').checked = !!(p.isPitcher||p.pos==='P');
      $('#isStar').checked   = !!p.isStar;
      $('#isCaptain').checked = !!p.isCaptain;
      $('#preset').value     = 'custom';
      setSliders(p);
      app.pendingPlayerImg = p.img || null;
      const prev = $('#playerDropPreview');
      if (p.img) { prev.src=p.img; prev.classList.add('has-img'); $('#playerDropLabel').style.display='none'; }
      $('#btnAddPlayer').dataset.editing = p.id;
      $('#btnAddPlayer').textContent = '💾 Save Changes';
      setTab('roster');
      toast(`Editing ${p.name}…`);
    });
    list.appendChild(card);
  }
}

/* ================================================================
   UI — League Browser
   ================================================================ */
let leagueSelected = null;

function renderLeague() {
  const search = ($('#leagueSearch')?.value||'').toLowerCase();
  const sortBy = $('#leagueSort')?.value||'name';
  const divFilter = $('#leagueDivFilter')?.value||'';

  const all = allTeams();
  // Populate division filter
  const divs = [...new Set(all.map(t=>t.division||'').filter(Boolean))].sort();
  const df = $('#leagueDivFilter');
  if (df) {
    const cur = df.value;
    df.innerHTML = '<option value="">All Divisions</option>' + divs.map(d=>`<option value="${esc(d)}">${esc(d)}</option>`).join('');
    if (cur) df.value = cur;
  }

  let teams = [...all];
  if (search) teams = teams.filter(t=>teamLabel(t).toLowerCase().includes(search)||(t.division||'').toLowerCase().includes(search));
  if (divFilter) teams = teams.filter(t=>(t.division||'')=== divFilter);
  if (sortBy==='name') teams.sort((a,b)=>teamLabel(a).localeCompare(teamLabel(b)));
  else if (sortBy==='ovr') teams.sort((a,b)=>calcTeamOVR(b)-calcTeamOVR(a));
  else if (sortBy==='division') teams.sort((a,b)=>(a.division||'').localeCompare(b.division||''));

  const grid = $('#leagueGrid');
  if (!teams.length) { grid.innerHTML='<div class="tip-box">No teams found. Generate CPU teams or create some!</div>'; return; }

  grid.innerHTML = '';
  for (const t of teams) {
    const ovr = calcTeamOVR(t);
    const ovrCls = ovr>=80?'high':ovr>=60?'mid':'low';
    const [c1,c2] = t.colors||['#3b82f6','#22c55e'];
    const card = document.createElement('div');
    card.className = 'league-card';
    card.style.borderTopColor = c1;
    card.innerHTML = `
      <div class="lc-name">${esc(teamLabel(t))}</div>
      <div class="lc-city">${esc(t.city||'')}</div>
      <div class="lc-div">${esc(t.division||'')}</div>
      <div class="lc-ovr ovr-pill ${ovrCls}" style="width:fit-content">OVR ${ovr}</div>
      <div class="lc-colors">
        <div class="lc-dot" style="background:${c1}"></div>
        <div class="lc-dot" style="background:${c2}"></div>
        <span class="lc-city">${t.players?.length||0} players</span>
      </div>`;
    card.addEventListener('click', () => openLeagueModal(t));
    grid.appendChild(card);
  }
}

function openLeagueModal(team) {
  leagueSelected = team;
  const ovr = calcTeamOVR(team);
  const [c1] = team.colors||['#3b82f6'];
  const playerList = (team.players||[]).map(p => `
    <div class="modal-player">
      <img src="${p.img||''}" alt="" onerror="this.style.display='none'" />
      <div>
        <div class="modal-player-name">${esc(p.name)} <span class="pbadge pos">${esc(p.pos)}</span>${p.isStar?'<span class="pbadge star">⭐</span>':''}</div>
        <div class="modal-player-stats">HIT ${p.HIT} · PWR ${p.PWR} · SPD ${p.SPD} · DEF ${p.DEF} · ARM ${p.ARM} · PIT ${p.PIT}</div>
      </div>
    </div>`).join('');

  $('#leagueModalContent').innerHTML = `
    <div class="modal-team-header">
      <img class="modal-logo" src="${team.logo||''}" alt="" onerror="this.style.display='none'" style="background:${c1}22"/>
      <div>
        <div class="modal-team-name">${esc(teamLabel(team))}</div>
        <div class="modal-team-sub">${esc(team.division||'')} · OVR ${ovr} · ${team.players?.length||0} players</div>
        ${team.stadium ? `<div class="modal-team-sub">🏟️ ${esc(team.stadium)}</div>` : ''}
      </div>
    </div>
    <div class="modal-players">${playerList||'<div class="tip-box">No players</div>'}</div>`;

  $('#leagueModal').classList.remove('hidden');
}

/* ================================================================
   UI — Stats Tab
   ================================================================ */
function renderStats() {
  const teamId = $('#statsTeamSelect')?.value || app.activeTeamId;
  if (!teamId) return;
  const s = app.season[teamId] || { wins:0, losses:0, ties:0, history:[] };
  const total = s.wins + s.losses + s.ties;
  const pct = total ? (s.wins/total).toFixed(3) : '—';

  $('#seasonW').textContent = s.wins;
  $('#seasonL').textContent = s.losses;
  $('#seasonPct').textContent = pct;

  // Streak
  let streak = 0, streakType = '';
  for (const h of (s.history||[])) {
    if (!streakType) { streakType=h.result; streak=1; }
    else if (h.result===streakType) streak++;
    else break;
  }
  $('#seasonStreak').textContent = streakType ? `${streakType}${streak} streak` : '';

  // History
  const hist = $('#gameHistory');
  if (!(s.history?.length)) { hist.innerHTML = '<div class="tip-box">No games played yet.</div>'; }
  else {
    hist.innerHTML = s.history.slice(0,30).map(h=>`
      <div class="history-item">
        <span class="hist-result ${h.result}">${h.result}</span>
        <span>${h.myScore}–${h.oppScore}</span>
        <span>vs ${esc(h.opp)}</span>
      </div>`).join('');
  }

  // Player stats from accumulated game box scores
  const team = allTeams().find(t=>t.id===teamId);
  if (team) {
    const batters = (team.players||[]).filter(p=>!p.isPitcher);
    const pitchers = (team.players||[]).filter(p=>p.isPitcher||p.pos==='P'||p.pos==='RP');

    // For now, use last game box if available
    const box = app.lastGameBox?.[teamId];
    const pb = box?.players || {};

    $('#playerStatBody').innerHTML = batters.length ? batters.map(p => {
      const s = pb[p.id] || {};
      const avg = (s.AB||0) > 0 ? (((s.H||0)/(s.AB||1)).toFixed(3)) : '.000';
      return `<tr>
        <td>${esc(p.name)}</td><td>${esc(p.pos)}</td>
        <td>${s.AB||0}</td><td>${s.H||0}</td>
        <td>${s.HR||0}</td><td>${s.RBI||0}</td><td>${s.R||0}</td>
        <td>${avg}</td><td>${s.SB||0}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="9" style="color:var(--muted2);padding:12px">Add batters to your roster.</td></tr>';

    $('#pitcherStatBody').innerHTML = pitchers.length ? pitchers.map(p => {
      const s = pb[p.id] || {};
      return `<tr>
        <td>${esc(p.name)}</td>
        <td>${((s.P_OUTS||0)/3).toFixed(1)}</td>
        <td>${s.P_K||0}</td><td>${s.P_BB||0}</td><td>${s.P_H||0}</td>
        <td>—</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" style="color:var(--muted2);padding:12px">Add pitchers to your roster.</td></tr>';
  }
}


/* ================================================================
   DB / TEAM SAVE HELPERS
   ================================================================ */
async function saveTeam(team) {
  team.updatedAt = Date.now();
  await dbPut(team);
  const idx = app.teams.findIndex(t=>t.id===team.id);
  if (idx>=0) app.teams[idx]=team; else app.teams.push(team);
}

/* ================================================================
   DRAG-AND-DROP SETUP
   ================================================================ */
function setupDropZone(zoneId, inputId, onFile, previewId, labelId) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  if (!zone || !input) return;

  zone.addEventListener('click', e => { if (e.target!==input) input.click(); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) onFile(file);
  });
  input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); });

  async function onFile(file) {
    const dataURL = await fileToDataURL(file);
    if (previewId) {
      const prev = document.getElementById(previewId);
      if (prev) { prev.src=dataURL; prev.classList.add('has-img'); }
    }
    if (labelId) {
      const lbl = document.getElementById(labelId);
      if (lbl) lbl.style.display = 'none';
    }
    zone._data = dataURL;
    if (zoneId === 'playerDropZone') { app.pendingPlayerImg = dataURL; }
    if (zoneId === 'logoDropZone') { zone._logoData = dataURL; const lbl = document.getElementById('logoDropLabel'); if(lbl) lbl.textContent = '✅ Logo loaded. Save team to apply.'; }
  }
}

/* ================================================================
   BOOTSTRAP / EVENT WIRING
   ================================================================ */
async function boot() {
  // Load user teams
  app.teams = await dbAll();
  if (!app.teams.length) {
    const starter = {
      id: uid(), name: 'Thunder Hawks', city: 'Riverside',
      stadium: 'Hawks Nest Arena', homeAdv: 2,
      colors: ['#3b82f6','#22c55e','#f59e0b'],
      logo: null, motto: 'Fear the Thunder!', division: 'East Division',
      players: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    await dbPut(starter);
    app.teams = [starter];
  }

  // Load generated teams
  app.genTeams = getGenTeams();

  // Load season
  try { const raw = localStorage.getItem('bb_season'); if(raw) app.season = JSON.parse(raw); } catch {}

  app.activeTeamId = app.teams[0]?.id || null;
  app.homeTeamId   = app.teams[0]?.id || null;

  // Wire tabs
  $$('.nav-tab').forEach(btn => btn.addEventListener('click', () => {
    setTab(btn.dataset.tab);
    if (btn.dataset.tab==='league') renderLeague();
    if (btn.dataset.tab==='stats') renderStats();
  }));

  // Drop zones
  setupDropZone('playerDropZone', 'playerPhoto', ()=>{}, 'playerDropPreview', 'playerDropLabel');
  setupDropZone('logoDropZone',   'teamLogo',    ()=>{}, null, 'logoDropLabel');

  // Stat sliders live update
  for (const k of STAT_KEYS) {
    const el = document.getElementById(k);
    if (el) el.addEventListener('input', () => {
      const v = el.value;
      const vEl = document.getElementById(k+'v');
      const bar = document.getElementById(k+'bar');
      if (vEl) vEl.textContent = v;
      if (bar) bar.style.width = v+'%';
    });
  }

  // Preset selector
  $('#preset').addEventListener('change', () => {
    const p = PRESETS[$('#preset').value] || PRESETS.custom;
    setSliders(p);
  });

  // Random / Max buttons
  $('#btnRandomStats').addEventListener('click', () => {
    const r = {};
    for (const k of STAT_KEYS) r[k] = rand(20, 90);
    setSliders(r);
  });
  $('#btnMaxStats').addEventListener('click', () => {
    const r = {};
    for (const k of STAT_KEYS) r[k] = rand(80, 99);
    setSliders(r);
  });

  // Add / Save player
  $('#btnAddPlayer').addEventListener('click', async () => {
    const team = app.teams.find(t=>t.id===app.activeTeamId);
    if (!team) { toast('⚠️ Select a team first!'); return; }

    const name = $('#playerName').value.trim();
    if (!name) { toast('⚠️ Enter a player name!'); return; }

    const editId = $('#btnAddPlayer').dataset.editing;
    const stats  = readSliders();
    const player = {
      id: editId || uid(),
      name, img: app.pendingPlayerImg || null,
      pos: $('#playerPos').value,
      isPitcher: $('#isPitcher').checked || $('#playerPos').value==='P'||$('#playerPos').value==='RP',
      isStar:    $('#isStar').checked,
      isCaptain: $('#isCaptain').checked,
      ...stats,
    };

    if (editId) {
      const idx = team.players.findIndex(p=>p.id===editId);
      if (idx>=0) { if (!app.pendingPlayerImg) player.img = team.players[idx].img; team.players[idx]=player; }
      else team.players.push(player);
    } else {
      team.players.push(player);
    }

    await saveTeam(team);
    resetPlayerForm();
    renderRoster();
    renderAllSelects();
    toast(`✅ ${name} ${editId?'updated':'added'}!`);
  });

  $('#btnResetPlayerForm').addEventListener('click', resetPlayerForm);

  // Roster filter
  $('#rosterFilter').addEventListener('input', renderRoster);

  // Auto lineup / Shuffle / Clear
  $('#btnAutoLineup').addEventListener('click', async () => {
    const team = app.teams.find(t=>t.id===app.activeTeamId);
    if (!team) return;
    team.players.sort((a,b)=>calcOVR(b)-calcOVR(a));
    await saveTeam(team); renderRoster(); toast('✅ Auto-lineup applied!');
  });
  $('#btnShuffle').addEventListener('click', async () => {
    const team = app.teams.find(t=>t.id===app.activeTeamId);
    if (!team) return;
    for (let i=team.players.length-1;i>0;i--){const j=rand(0,i);[team.players[i],team.players[j]]=[team.players[j],team.players[i]];}
    await saveTeam(team); renderRoster(); toast('🔀 Lineup shuffled!');
  });
  $('#btnClearRoster').addEventListener('click', async () => {
    const team = app.teams.find(t=>t.id===app.activeTeamId);
    if (!team||!team.players.length) return;
    if (!confirm(`Clear all ${team.players.length} players from ${teamLabel(team)}?`)) return;
    team.players=[];
    await saveTeam(team); renderRoster(); toast('🗑️ Roster cleared.');
  });

  // Active team select (roster tab)
  $('#activeTeamSelect').addEventListener('change', () => {
    app.activeTeamId = $('#activeTeamSelect').value;
    renderRoster();
    fillTeamEditor(app.teams.find(t=>t.id===app.activeTeamId));
  });

  // Teams tab buttons
  $('#btnNewTeam').addEventListener('click', async () => {
    const t = { id:uid(), name:'New Team', city:'', stadium:'', homeAdv:0, colors:['#3b82f6','#22c55e','#f59e0b'], logo:null, motto:'', division:'', players:[], createdAt:Date.now(), updatedAt:Date.now() };
    await saveTeam(t);
    app.activeTeamId = t.id;
    fillTeamEditor(t); renderTeamList(); renderAllSelects();
    toast('🆕 New team created!');
  });

  $('#btnSaveTeam').addEventListener('click', async () => {
    const team = app.teams.find(t=>t.id===app.activeTeamId);
    if (!team) { toast('⚠️ Select or create a team first.'); return; }
    team.name     = $('#teamName').value.trim() || 'Unnamed Team';
    team.city     = $('#teamCity').value.trim();
    team.stadium  = $('#teamStadium').value.trim();
    team.homeAdv  = Number($('#teamHomeAdv').value||0);
    team.motto    = $('#teamMotto').value.trim();
    team.division = $('#teamDivision').value.trim();
    team.colors   = [$('#teamColor1').value,$('#teamColor2').value,$('#teamColor3').value];
    const logoZone = document.getElementById('logoDropZone');
    if (logoZone?._logoData) { team.logo = logoZone._logoData; logoZone._logoData=null; }
    await saveTeam(team);
    fillTeamEditor(team); renderTeamList(); renderAllSelects();
    toast('💾 Team saved!');
  });

  $('#btnGoRoster').addEventListener('click', () => setTab('roster'));

  $('#teamSearch').addEventListener('input', renderTeamList);
  $('#sortTeams').addEventListener('change', renderTeamList);

  $('#btnDuplicateTeam').addEventListener('click', async () => {
    const src = app.teams.find(t=>t.id===app.activeTeamId);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id=uid(); copy.name=src.name+' Copy'; copy.createdAt=Date.now(); copy.updatedAt=Date.now();
    copy.players=(copy.players||[]).map(p=>({...p,id:uid()}));
    await saveTeam(copy);
    app.activeTeamId=copy.id; renderTeamList(); renderAllSelects(); fillTeamEditor(copy);
    toast('📋 Team duplicated!');
  });

  $('#btnDeleteTeam').addEventListener('click', async () => {
    const t = app.teams.find(x=>x.id===app.activeTeamId);
    if (!t) return;
    if (!confirm(`Delete "${teamLabel(t)}"? This cannot be undone.`)) return;
    await dbDel(t.id);
    app.teams = app.teams.filter(x=>x.id!==t.id);
    app.activeTeamId = app.teams[0]?.id||null;
    fillTeamEditor(app.teams[0]||null); renderTeamList(); renderAllSelects();
    toast('🗑️ Team deleted.');
  });

  $('#btnExportTeam').addEventListener('click', () => {
    const t = app.teams.find(x=>x.id===app.activeTeamId);
    if (!t) return;
    const blob = new Blob([JSON.stringify({type:'bb_team',version:2,team:t},null,2)],{type:'application/json'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=teamLabel(t).replace(/\s+/g,'_')+'.team.json'; a.click();
    toast('📤 Team exported!');
  });

  $('#importTeamFile').addEventListener('change', async () => {
    const file = $('#importTeamFile').files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const t = data.team;
      if (!t||!t.name) throw new Error('Invalid');
      t.id = app.teams.some(x=>x.id===t.id) ? uid() : t.id;
      t.updatedAt=Date.now(); t.createdAt=t.createdAt||Date.now();
      t.players=(t.players||[]).map(p=>({...p,id:uid()}));
      await saveTeam(t);
      app.activeTeamId=t.id; fillTeamEditor(t); renderTeamList(); renderAllSelects();
      toast('📥 Team imported!');
    } catch { toast('❌ Could not import that file.'); }
    $('#importTeamFile').value='';
  });

  // Game tab
  $('#homeTeamSelect').addEventListener('change', () => { app.homeTeamId=$('#homeTeamSelect').value; });
  $('#awayTeamSelect').addEventListener('change', () => { app.awayTeamId=$('#awayTeamSelect').value; });

  $('#btnNewGame').addEventListener('click', () => {
    const home = allTeams().find(t=>t.id===app.homeTeamId);
    const away = allTeams().find(t=>t.id===app.awayTeamId);
    if (!home||!away) { toast('⚠️ Select both teams!'); return; }
    if ((home.players||[]).length<2) { toast(`⚠️ ${teamLabel(home)} needs at least 2 players!`); return; }
    if ((away.players||[]).length<2) { toast(`⚠️ ${teamLabel(away)} needs at least 2 players!`); return; }
    app.game = makeGame(home, away);
    logAll = [];
    renderLog();
    showHighlight(null, 'Game started! Click Next Play.', '');
    updateGameUI();
    toast(`⚾ ${teamLabel(home)} vs ${teamLabel(away)} — Play Ball!`);
  });

  $('#btnSwapTeams').addEventListener('click', () => {
    [app.homeTeamId, app.awayTeamId] = [app.awayTeamId, app.homeTeamId];
    $('#homeTeamSelect').value = app.homeTeamId||'';
    $('#awayTeamSelect').value = app.awayTeamId||'';
    toast('⇄ Teams swapped!');
  });

  $('#nextPlay').addEventListener('click', doNextPlay);
  $('#simHalf').addEventListener('click', () => { simHalfInning(); });
  $('#simGame').addEventListener('click', () => { simFullGame(); });
  $('#btnResetLog').addEventListener('click', () => { logAll=[]; renderLog(); });
  $('#filterHighlights').addEventListener('change', renderLog);

  // League tab
  $('#btnGenTeams').addEventListener('click', generateAllTeams);
  $('#btnGenClear').addEventListener('click', () => {
    if (!confirm('Remove all 300 generated CPU teams?')) return;
    setGenTeams([]); renderLeague(); renderAllSelects(); toast('🗑️ Generated teams removed.');
  });
  $('#leagueSearch').addEventListener('input', renderLeague);
  $('#leagueSort').addEventListener('change', renderLeague);
  $('#leagueDivFilter').addEventListener('change', renderLeague);
  $('#leagueModalClose').addEventListener('click', () => $('#leagueModal').classList.add('hidden'));
  $('#leagueModal').addEventListener('click', e => { if(e.target===$('#leagueModal')) $('#leagueModal').classList.add('hidden'); });
  $('#btnChallengeLeague').addEventListener('click', () => {
    if (!leagueSelected) return;
    // Set as away team and switch to game tab
    // Make sure it's in genTeams (it might be)
    app.awayTeamId = leagueSelected.id;
    if (!app.genTeams.some(t=>t.id===leagueSelected.id)) {
      // It's a user team, fine
    }
    renderAllSelects();
    $('#awayTeamSelect').value = leagueSelected.id;
    app.awayTeamId = leagueSelected.id;
    $('#leagueModal').classList.add('hidden');
    setTab('game');
    toast(`⚾ Challenging ${teamLabel(leagueSelected)}!`);
  });
  $('#btnImportLeague').addEventListener('click', async () => {
    if (!leagueSelected) return;
    const copy = JSON.parse(JSON.stringify(leagueSelected));
    copy.id=uid(); copy.isCPU=false; copy.createdAt=Date.now(); copy.updatedAt=Date.now();
    copy.players=(copy.players||[]).map(p=>({...p,id:uid()}));
    await saveTeam(copy);
    app.activeTeamId=copy.id; renderTeamList(); renderAllSelects();
    $('#leagueModal').classList.add('hidden');
    toast(`📥 ${teamLabel(copy)} imported to My Teams!`);
  });

  // Stats tab
  $('#statsTeamSelect')?.addEventListener('change', renderStats);

  // Initial render
  renderTeamList();
  renderAllSelects();
  fillTeamEditor(app.teams[0]||null);
  renderRoster();
  renderLeague();
  renderStats();
  updateGameUI();
}

/* ---- Start ---- */
document.addEventListener('DOMContentLoaded', boot);
