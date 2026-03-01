/* ==========================================================
   Fictional Baseball League Simulator
   - Team Library (many teams)
   - Roster Builder (players + images + presets)
   - Game Simulator (pick Home/Away, play-by-play + highlights)
   Storage: IndexedDB (better than localStorage for lots of teams/images)
   ========================================================== */

/* ---------- Tiny helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const clamp01 = (x) => clamp(x, 0, 1);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : ("id_" + Math.random().toString(16).slice(2));
const now = () => Date.now();

function safeText(s){ return (s ?? "").toString().trim(); }

/* ---------- IndexedDB ---------- */
const DB_NAME = "bb_league_db_v1";
const DB_VERSION = 1;
const STORE_TEAMS = "teams";

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TEAMS)){
        const store = db.createObjectStore(STORE_TEAMS, { keyPath: "id" });
        store.createIndex("name", "name", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAllTeams(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEAMS, "readonly");
    const store = tx.objectStore(STORE_TEAMS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutTeam(team){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEAMS, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_TEAMS).put(team);
  });
}

async function dbDeleteTeam(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEAMS, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_TEAMS).delete(id);
  });
}

async function dbGetTeam(id){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TEAMS, "readonly");
    const req = tx.objectStore(STORE_TEAMS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- File helpers ---------- */
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadJSON(filename, data){
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function readJSONFile(file){
  const text = await file.text();
  return JSON.parse(text);
}

/* ---------- App state ---------- */
const app = {
  teams: [],
  activeTeamId: null,
  editingTeamId: null, // same as active, but kept separate for clarity
  homeTeamId: null,
  awayTeamId: null,
  game: null
};

/* ---------- Defaults ---------- */
function createBlankTeam(){
  return {
    id: uid(),
    name: "New Team",
    city: "",
    stadium: "",
    homeAdv: 0,
    colors: ["#3b82f6", "#22c55e", "#f59e0b"],
    logo: null,         // dataURL
    players: [],        // [{id,name,img,pos,isPitcher,isStar, stats...}]
    createdAt: now(),
    updatedAt: now()
  };
}

function calcPlayerOVR(p){
  // Simple but useful overall
  const bat = (p.HIT*0.45 + p.PWR*0.35 + p.SPD*0.20);
  const glove = (p.DEF*0.65 + p.ARM*0.35);
  const pitch = p.PIT || 0;
  const roleBoost = p.isPitcher ? pitch : bat;
  const base = (roleBoost*0.62 + glove*0.28 + pitch*0.10);
  return Math.round(base);
}

function calcTeamOVR(team){
  if (!team.players?.length) return 0;
  const ovr = team.players.map(calcPlayerOVR);
  const top = ovr.sort((a,b)=>b-a).slice(0, 9); // lineup-ish
  const avg = top.reduce((s,x)=>s+x,0) / top.length;
  return Math.round(avg);
}

function formatTeamLabel(t){
  const parts = [];
  if (t.city) parts.push(t.city);
  parts.push(t.name);
  return parts.join(" ");
}

/* ---------- Presets ---------- */
function applyPreset(preset){
  // Returns stats object. Keep it classic + readable.
  const base = {
    HIT: 65, PWR: 50, SPD: 55, DEF: 55, ARM: 55, PIT: 0
  };

  const presets = {
    custom: base,
    contact: { HIT: 82, PWR: 42, SPD: 60, DEF: 55, ARM: 52, PIT: 0 },
    slugger: { HIT: 62, PWR: 88, SPD: 45, DEF: 52, ARM: 55, PIT: 0 },
    speedster:{ HIT: 68, PWR: 40, SPD: 92, DEF: 60, ARM: 52, PIT: 0 },
    glove:    { HIT: 60, PWR: 45, SPD: 58, DEF: 92, ARM: 70, PIT: 0 },
    cannon:   { HIT: 58, PWR: 52, SPD: 55, DEF: 72, ARM: 92, PIT: 0 },
    ace:      { HIT: 30, PWR: 20, SPD: 40, DEF: 60, ARM: 65, PIT: 90 },
    reliever: { HIT: 25, PWR: 20, SPD: 45, DEF: 62, ARM: 70, PIT: 82 }
  };

  return presets[preset] || base;
}

/* ---------- Tabs ---------- */
function setTab(name){
  $$(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.tab === name));
  $("#tab-teams").classList.toggle("is-active", name === "teams");
  $("#tab-roster").classList.toggle("is-active", name === "roster");
  $("#tab-game").classList.toggle("is-active", name === "game");
}

/* ---------- UI: Team list + selects ---------- */
function renderTeamList(){
  const list = $("#teamList");
  const search = safeText($("#teamSearch").value).toLowerCase();
  const sort = $("#sortTeams").value;

  let teams = [...app.teams];

  if (search){
    teams = teams.filter(t => formatTeamLabel(t).toLowerCase().includes(search));
  }

  if (sort === "name"){
    teams.sort((a,b)=> formatTeamLabel(a).localeCompare(formatTeamLabel(b)));
  } else if (sort === "updated"){
    teams.sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));
  } else if (sort === "ovr"){
    teams.sort((a,b)=> calcTeamOVR(b) - calcTeamOVR(a));
  }

  list.innerHTML = "";
  if (!teams.length){
    list.innerHTML = `<div class="notice">No teams yet. Create one on the right. 🙂</div>`;
    return;
  }

  for (const t of teams){
    const ovr = calcTeamOVR(t);
    const el = document.createElement("div");
    el.className = "teamItem" + (t.id === app.activeTeamId ? " is-active" : "");
    el.innerHTML = `
      <img class="teamLogoMini" src="${t.logo || ""}" alt="" onerror="this.style.display='none'">
      <div class="teamInfo">
        <div class="teamName">${escapeHTML(formatTeamLabel(t))}</div>
        <div class="teamMeta">${escapeHTML((t.players?.length||0) + " players")} • Edited ${timeAgo(t.updatedAt)}</div>
      </div>
      <div class="ovrTag">OVR ${ovr}</div>
    `;
    el.addEventListener("click", () => selectTeam(t.id));
    list.appendChild(el);
  }
}

function renderTeamSelects(){
  const selects = [
    $("#activeTeamSelect"),
    $("#homeTeamSelect"),
    $("#awayTeamSelect"),
  ];

  for (const s of selects){
    const current = s.value;
    s.innerHTML = "";
    for (const t of app.teams.sort((a,b)=> formatTeamLabel(a).localeCompare(formatTeamLabel(b)))){
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${formatTeamLabel(t)} (OVR ${calcTeamOVR(t)})`;
      s.appendChild(opt);
    }
    // restore if possible
    if (current && app.teams.some(t=>t.id===current)) s.value = current;
  }

  // Set defaults if empty
  if (!app.activeTeamId && app.teams[0]) app.activeTeamId = app.teams[0].id;
  if (!app.homeTeamId && app.teams[0]) app.homeTeamId = app.teams[0].id;
  if (!app.awayTeamId && app.teams[1]) app.awayTeamId = app.teams[1].id;
  if (!app.awayTeamId && app.teams[0]) app.awayTeamId = app.teams[0].id;

  $("#activeTeamSelect").value = app.activeTeamId || "";
  $("#homeTeamSelect").value = app.homeTeamId || "";
  $("#awayTeamSelect").value = app.awayTeamId || "";
}

/* ---------- UI: Team editor ---------- */
function fillTeamEditor(team){
  $("#teamName").value = team?.name || "";
  $("#teamCity").value = team?.city || "";
  $("#teamStadium").value = team?.stadium || "";
  $("#teamHomeAdv").value = String(team?.homeAdv || 0);

  const colors = team?.colors || ["#3b82f6", "#22c55e", "#f59e0b"];
  $("#teamColor1").value = colors[0] || "#3b82f6";
  $("#teamColor2").value = colors[1] || "#22c55e";
  $("#teamColor3").value = colors[2] || "#f59e0b";

  const logoEl = $("#teamLogoPreview");
  if (team?.logo){
    logoEl.src = team.logo;
    logoEl.style.display = "block";
  } else {
    logoEl.removeAttribute("src");
    logoEl.style.display = "none";
  }

  $("#teamPreviewTitle").textContent = team ? formatTeamLabel(team) : "No team selected";
  $("#teamPreviewSub").textContent = team ? `${team.players?.length||0} players • OVR ${calcTeamOVR(team)}` : "Pick a team from the library or create one.";

  const chips = $("#teamPreviewChips");
  chips.innerHTML = "";
  if (team){
    chips.appendChild(makeChip(`🏟️ ${team.stadium || "No stadium"}`));
    chips.appendChild(makeChip(`🏠 Home adv +${team.homeAdv || 0}`));
    chips.appendChild(makeChip(`🎨 Colors saved`));
  }
}

function makeChip(text){
  const d = document.createElement("div");
  d.className = "chip";
  d.textContent = text;
  return d;
}

/* ---------- UI: Player form ---------- */
const statKeys = ["HIT","PWR","SPD","DEF","ARM","PIT"];
function setStatSliders(stats){
  for (const k of statKeys){
    const val = clamp(Number(stats[k] ?? 0), 0, 100);
    $("#" + k).value = String(val);
    $("#" + k + "v").textContent = String(val);
  }
}
function readStatSliders(){
  const out = {};
  for (const k of statKeys) out[k] = clamp(Number($("#" + k).value), 0, 100);
  return out;
}
function resetPlayerForm(){
  $("#playerName").value = "";
  $("#playerPhoto").value = "";
  $("#playerPos").value = "DH";
  $("#preset").value = "custom";
  $("#isPitcher").checked = false;
  $("#isStar").checked = false;
  setStatSliders(applyPreset("custom"));
}

/* ---------- UI: Roster list ---------- */
function renderRoster(){
  const team = app.teams.find(t => t.id === app.activeTeamId);
  const list = $("#rosterList");
  const filter = safeText($("#rosterFilter").value).toLowerCase();

  if (!team){
    $("#rosterMeta").textContent = "No team selected.";
    list.innerHTML = `<div class="notice">Pick a team first.</div>`;
    return;
  }

  $("#rosterMeta").textContent = `${formatTeamLabel(team)} • ${team.players.length} players • Team OVR ${calcTeamOVR(team)}`;

  let players = [...team.players];
  if (filter){
    players = players.filter(p => (p.name||"").toLowerCase().includes(filter) || (p.pos||"").toLowerCase().includes(filter));
  }

  // Keep pitchers visible near top, then stars, then OVR
  players.sort((a,b)=>{
    const ap = a.isPitcher ? 1 : 0;
    const bp = b.isPitcher ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const as = a.isStar ? 1 : 0;
    const bs = b.isStar ? 1 : 0;
    if (as !== bs) return bs - as;
    return calcPlayerOVR(b) - calcPlayerOVR(a);
  });

  list.innerHTML = "";
  if (!players.length){
    list.innerHTML = `<div class="notice">No players match that filter.</div>`;
    return;
  }

  for (const p of players){
    const card = document.createElement("div");
    card.className = "playerCard";
    const badges = [];
    if (p.isPitcher || p.pos === "P") badges.push(`<span class="badge pit">P</span>`);
    badges.push(`<span class="badge">${escapeHTML(p.pos || "DH")}</span>`);
    if (p.isStar) badges.push(`<span class="badge star">⭐ Star</span>`);

    card.innerHTML = `
      <img src="${p.img || ""}" alt="" onerror="this.style.display='none'">
      <div class="playerMain">
        <div class="playerName">${escapeHTML(p.name || "Unnamed")} ${badges.join(" ")}</div>
        <div class="playerStats">OVR ${calcPlayerOVR(p)} • HIT ${p.HIT} • PWR ${p.PWR} • SPD ${p.SPD} • DEF ${p.DEF} • ARM ${p.ARM} • PIT ${p.PIT}</div>
      </div>
      <div>
        <button class="btn ghost smallbtn" data-edit="${p.id}">Edit</button>
        <button class="btn danger smallbtn" data-del="${p.id}">Remove</button>
      </div>
    `;

    card.querySelector("[data-del]").addEventListener("click", async ()=>{
      team.players = team.players.filter(x => x.id !== p.id);
      await saveTeam(team);
      renderAll();
    });

    card.querySelector("[data-edit]").addEventListener("click", ()=>{
      // Populate form for quick edit (name/stats/pos/star/pitcher)
      $("#playerName").value = p.name || "";
      $("#playerPos").value = p.pos || "DH";
      $("#isPitcher").checked = !!(p.isPitcher || p.pos === "P");
      $("#isStar").checked = !!p.isStar;
      $("#preset").value = "custom";
      setStatSliders(p);

      // Editing uses "Add player" button as overwrite if same name+pos? We'll do safe overwrite by storing an editing id.
      $("#btnAddPlayer").dataset.editing = p.id;
      $("#btnAddPlayer").textContent = "Save changes";
      $("#btnResetPlayerForm").textContent = "Cancel edit";
      $("#btnResetPlayerForm").dataset.cancel = "1";
      logLine(`🛠️ Editing ${p.name}. Change stats then hit “Save changes”.`);
    });

    list.appendChild(card);
  }
}

/* ---------- Save team + refresh ---------- */
async function saveTeam(team){
  team.updatedAt = now();
  await dbPutTeam(team);
  // refresh local copy
  const idx = app.teams.findIndex(t=>t.id===team.id);
  if (idx >= 0) app.teams[idx] = team;
  else app.teams.push(team);
}

/* ---------- Selecting team ---------- */
function selectTeam(id){
  app.activeTeamId = id;
  app.editingTeamId = id;
  app.homeTeamId = app.homeTeamId || id;
  fillTeamEditor(app.teams.find(t=>t.id===id));
  renderAll();
}

/* ---------- Game Engine ---------- */
function makeGame(homeTeam, awayTeam){
  const g = {
    home: homeTeam,
    away: awayTeam,
    inning: 1,
    top: true,
    outs: 0,
    scoreHome: 0,
    scoreAway: 0,
    bases: [null,null,null],
    idxHome: 0,
    idxAway: 0,
    // choose pitchers
    pitcherHome: pickPitcher(homeTeam),
    pitcherAway: pickPitcher(awayTeam)
  };
  return g;
}

function pickPitcher(team){
  const pitchers = (team.players || []).filter(p => p.isPitcher || p.pos === "P");
  if (pitchers.length){
    return pitchers.sort((a,b)=> (b.PIT||0) - (a.PIT||0))[0];
  }
  // fallback: highest PIT
  return [...(team.players||[])].sort((a,b)=> (b.PIT||0) - (a.PIT||0))[0] || null;
}

function offenseTeam(g){ return g.top ? g.away : g.home; }
function defenseTeam(g){ return g.top ? g.home : g.away; }
function offensePitcher(g){ return g.top ? g.pitcherAway : g.pitcherHome; } // for highlights text
function defensePitcher(g){ return g.top ? g.pitcherHome : g.pitcherAway; }

function nextBatter(g, team){
  const key = team.id === g.home.id ? "idxHome" : "idxAway";
  const lineup = buildLineup(team);
  if (!lineup.length) return null;
  const batter = lineup[g[key] % lineup.length];
  g[key] = (g[key] + 1) % lineup.length;
  return batter;
}

function buildLineup(team){
  // Lineup = all non-pitchers first; if all are pitchers, just use everyone.
  const nonP = (team.players||[]).filter(p=> !(p.isPitcher || p.pos==="P"));
  return nonP.length ? nonP : (team.players||[]);
}

function batterVsPitcherResult(batter, pitcher, defenseTeam){
  // Stronger stat influence:
  // - Batter HIT/PWR vs Pitcher PIT
  // - Team defense affects in-play outs/errors a bit
  const hit = (batter.HIT ?? 50) / 100;
  const pwr = (batter.PWR ?? 50) / 100;
  const pit = (pitcher.PIT ?? 50) / 100;

  // defense quality helps convert balls in play to outs
  const defAvg = teamDefenseAvg(defenseTeam); // 0..1
  const defFactor = 0.85 + defAvg * 0.30;     // 0.85..1.15

  // Contact is much more driven by batter vs pitcher
  // (higher pit pulls contact down harder; higher hit pushes it up)
  let contact = hit * (1 - pit*0.70) + (hit - 0.50)*0.20;
  contact = clamp01(contact);

  // Walk/K also pulled by pitcher quality
  const walkW = clamp01(0.05 + (1 - pit) * 0.07);         // 0.05..0.12
  const strikeoutW = clamp01(0.10 + pit * 0.18);          // 0.10..0.28
  const inPlayW = clamp01(1 - walkW - strikeoutW);

  // In-play breakdown: defense shifts OUT weight up; power shifts HR/2B up
  const outW    = (1 - contact) * 1.15 * defFactor;
  const singleW = contact * (0.62 - pwr*0.18) / defFactor;
  const doubleW = contact * (0.22 + pwr*0.08) / defFactor;
  const tripleW = contact * (0.03 + ((batter.SPD ?? 50)/100)*0.03) / defFactor;
  const hrW     = contact * (0.05 + pwr*0.22) / defFactor;

  const inPlayOutcome = weightedChoice([
    { key:"OUT",    w: outW },
    { key:"SINGLE", w: singleW },
    { key:"DOUBLE", w: doubleW },
    { key:"TRIPLE", w: tripleW },
    { key:"HR",     w: hrW },
  ]);

  const primary = weightedChoice([
    { key:"WALK",   w: walkW },
    { key:"K",      w: strikeoutW },
    { key:"INPLAY", w: inPlayW }
  ]);

  if (primary === "WALK") return "WALK";
  if (primary === "K") return "K";
  return inPlayOutcome;
}

function calcDefenseStrength(team){
  const ps = team.players || [];
  if (!ps.length) return 50;
  const top = [...ps].sort((a,b)=> (b.DEF||0)-(a.DEF||0)).slice(0, 9);
  const avg = top.reduce((s,p)=> s + (p.DEF||0), 0) / top.length;
  return Math.round(avg);
}

function weightedChoice(items){
  const total = items.reduce((s,i)=>s + Math.max(0,i.w), 0);
  let r = Math.random() * total;
  for (const it of items){
    r -= Math.max(0,it.w);
    if (r <= 0) return it.key;
  }
  return items[items.length-1].key;
}

function addRun(g, n){
  if (g.top) g.scoreAway += n;
  else g.scoreHome += n;
}

function scoreRunner(g, runner, batter){
  if (!runner) return;
  const rLine = g.box.players[runner.id];
  if (rLine) rLine.R++;
  if (batter){
    const bLine = g.box.players[batter.id];
    if (bLine) bLine.RBI++;
  }
}

function addRunToTeam(g, n){
  if (g.top) g.scoreAway += n;
  else g.scoreHome += n;
  // also in box
  const teamId = g.top ? g.away.id : g.home.id;
  if (g.box.teams[teamId]) g.box.teams[teamId].R += n;
}

function advanceRunners(g, hitType, batter){
  // Simplified baserunning with RBI/R scoring
  let runs = 0;

  const scoreFromThird = (batterForRBI) => {
    if (g.bases[2]){
      scoreRunner(g, g.bases[2], batterForRBI);
      g.bases[2] = null;
      runs++;
    }
  };

  if (hitType === "WALK") {
    // bases loaded forces in a run
    if (g.bases[0] && g.bases[1] && g.bases[2]) { scoreRunner(g, g.bases[2], batter); runs++; g.bases[2]=null; }
    if (g.bases[1] && g.bases[0]) { g.bases[2] = g.bases[1]; g.bases[1]=null; }
    if (g.bases[0]) { g.bases[1] = g.bases[0]; g.bases[0]=null; }
    g.bases[0] = batter;
    addRunToTeam(g, runs);
    return runs;
  }

  if (hitType === "SINGLE") {
    scoreFromThird(batter);
    if (g.bases[1]) { g.bases[2] = g.bases[1]; g.bases[1]=null; }
    if (g.bases[0]) { g.bases[1] = g.bases[0]; g.bases[0]=null; }
    g.bases[0] = batter;
  }

  if (hitType === "DOUBLE") {
    if (g.bases[2]) { scoreRunner(g, g.bases[2], batter); g.bases[2]=null; runs++; }
    if (g.bases[1]) { scoreRunner(g, g.bases[1], batter); g.bases[1]=null; runs++; }
    if (g.bases[0]) { g.bases[2] = g.bases[0]; g.bases[0]=null; }
    g.bases[1] = batter;
  }

  if (hitType === "TRIPLE") {
    for (let i=0;i<3;i++){
      if (g.bases[i]){ scoreRunner(g, g.bases[i], batter); g.bases[i]=null; runs++; }
    }
    g.bases[2] = batter;
  }

  if (hitType === "HR") {
    for (let i=0;i<3;i++){
      if (g.bases[i]){ scoreRunner(g, g.bases[i], batter); g.bases[i]=null; runs++; }
    }
    // batter scores
    scoreRunner(g, batter, batter);
    runs++;
  }

  addRunToTeam(g, runs);
  return runs;
}

/* ---------- Flavor text ---------- */
const CROWD = ["🙌", "😱", "🔥", "👏", "😤", "🎺", "🧢", "🎯"];
function crowd(){ return pick(CROWD); }

function offenseFlavor(result, batter, runs){
  const lines = {
    WALK: [
      `${batter.name} works a walk. No panic. Just patience.`,
      `${batter.name} watches four go by — take your base!`
    ],
    K: [
      `${batter.name} goes down swinging — nasty pitch.`,
      `Strike three — ${batter.name} is retired.`
    ],
    SINGLE:[
      `${batter.name} slaps a clean single through the infield!`,
      `${batter.name} pokes one into right for a hit!`
    ],
    DOUBLE:[
      `${batter.name} smokes a double into the gap!`,
      `${batter.name} bangs one off the wall — stand-up double!`
    ],
    TRIPLE:[
      `${batter.name} runs forever and ends up with a triple!`,
      `${batter.name} splits the outfield — triple city!`
    ],
    HR: [
      `${batter.name} unloads… DEEP… GONE! Home run!`,
      `${batter.name} turns on it — goodbye baseball!`
    ],
    OUT: [
      `${batter.name} puts it in play, but it’s handled.`,
      `${batter.name} makes contact… just not enough.`
    ]
  };

  let t = pick(lines[result] || [`${batter.name} makes something happen.`]);
  if (runs > 0) t += ` (${runs} run${runs===1?"":"s"} score!) ${crowd()}`;
  return t;
}

function defenseFlavor(defTeam, batter){
  const candidates = (defTeam.players||[]).filter(p => !(p.isPitcher || p.pos==="P"));
  const fielder = candidates.length ? pick(candidates) : pick(defTeam.players||[batter]);
  const outs = [
    `${fielder.name} makes the routine play and retires ${batter.name}.`,
    `${batter.name} hits a sharp grounder — ${fielder.name} snags it and throws them out!`,
    `${fielder.name} camps under it and puts it away for the out.`
  ];
  return { fielder, text: pick(outs) };
}

/* ---------- Game UI ---------- */
function basesText(g){
  const b = g.bases.map(x => x ? "●" : "○").join("");
  // 1st 2nd 3rd
  return `Bases: ${b} (1st–3rd)`;
}

function updateGameUI(){
  const g = app.game;
  if (!g){
    $("#score").textContent = "Home 0 — 0 Away";
    $("#inning").textContent = "Inning 1 (Top)";
    $("#outs").textContent = "Outs 0";
    $("#bases").textContent = "Bases: —";
    return;
  }

  $("#score").textContent = `${formatTeamLabel(g.home)} ${g.scoreHome} — ${g.scoreAway} ${formatTeamLabel(g.away)}`;
  $("#inning").textContent = `Inning ${g.inning} (${g.top ? "Top" : "Bottom"})`;
  $("#outs").textContent = `Outs ${g.outs}`;
  $("#bases").textContent = basesText(g);
}

function updateStartButton(){
  const btn = $("#btnNewGame");
  if (!btn) return;

  const home = app.teams.find(t=>t.id===app.homeTeamId);
  const away = app.teams.find(t=>t.id===app.awayTeamId);

  let msg = "";
  if (!home || !away) msg = "Pick Home + Away teams";
  else if ((home.players||[]).length < 2) msg = `Add players to ${formatTeamLabel(home)} (need 2+)`;
  else if ((away.players||[]).length < 2) msg = `Add players to ${formatTeamLabel(away)} (need 2+)`;

  if (msg){
    btn.disabled = true;
    btn.title = msg;
    btn.textContent = "Start new game (fix setup)";
  } else {
    btn.disabled = false;
    btn.title = "Start a new game with the selected teams";
    btn.textContent = "Start new game";
  }
}

function logLine(text){
  const log = $("#log");
  const div = document.createElement("div");
  div.className = "logline";
  div.textContent = text;
  log.prepend(div);
}

function showHighlight(player, caption){
  const img = $("#highlightImg");
  const txt = $("#highlightText");
  if (player?.img){
    img.src = player.img;
  }
  txt.textContent = caption || "Highlight!";
}

function maybeAttemptSteal(g){
  // Try steals occasionally when runner on 1st or 2nd, <2 outs.
  if (g.outs >= 2) return false;
  const off = offenseTeam(g);
  const def = defenseTeam(g);
  const pitcher = (def.id === g.home.id) ? g.pitcherHome : g.pitcherAway;

  // Candidate runner: prefer 2nd steal 3rd? start with 1st -> 2nd
  let baseFrom = null;
  if (g.bases[0]) baseFrom = 0;
  else if (g.bases[1]) baseFrom = 1;
  else return false;

  const runner = g.bases[baseFrom];
  const runnerSPD = (runner.SPD ?? 50)/100;
  const defARMavg = clamp01(((def.players||[]).reduce((s,p)=>s+((p.ARM??50)/100),0) / Math.max(1,(def.players||[]).length)));
  const pit = (pitcher?.PIT ?? 50)/100;

  // Decide if we even try: faster runners attempt more
  const tryChance = clamp01(0.04 + runnerSPD*0.20 + (runner.isStar?0.06:0));
  if (Math.random() > tryChance) return false;

  // Success chance: runner speed vs defense arm & pitcher control
  let success = 0.55 + runnerSPD*0.35 - defARMavg*0.22 - pit*0.12;
  success = clamp01(success);

  // Roll
  if (Math.random() < success){
    // move runner up one base
    g.bases[baseFrom] = null;
    g.bases[baseFrom+1] = runner;
    g.box.players[runner.id].SB++;
    logLine(`🟦 ${runner.name} takes off… SAFE! Stolen base! ${crowd()}`);
    showHighlight(runner, `${runner.name} steals a base!`);
  } else {
    // caught stealing = out, runner removed
    g.bases[baseFrom] = null;
    g.outs++;
    g.box.players[runner.id].CS++;
    logLine(`🟥 ${runner.name} is gunned down trying to steal! Caught stealing. ${crowd()}`);
    // defense highlight: pick a strong arm fielder
    const armGuy = (def.players||[]).slice().sort((a,b)=>(b.ARM??0)-(a.ARM??0))[0] || pitcher;
    showHighlight(armGuy, `${armGuy?.name || "Defense"} throws out ${runner.name}!`);
    // half-inning may end
    if (g.outs >= 3){
      g.outs = 0;
      g.bases = [null,null,null];
      g.top = !g.top;
      if (g.top) g.inning++;
      logLine("— Half-inning over —");
    }
  }
  updateGameUI();
  updateStartButton();
  renderSeason();
  return true;
}

function applyHitStats(g, batter, result){
  const s = g.box.players[batter.id];
  if (!s) return;
  if (result === "WALK"){ s.BB++; return; }
  if (result === "K"){ s.AB++; s.K++; return; }
  if (result === "OUT"){ s.AB++; return; }
  // hit types
  s.AB++; s.H++;
  if (result === "DOUBLE") s._2B++;
  if (result === "TRIPLE") s._3B++;
  if (result === "HR") s.HR++;
  // team hit
  const teamId = s.teamId;
  if (g.box.teams[teamId]) g.box.teams[teamId].H++;
}

function chargeError(g, defTeam){
  const teamId = defTeam.id;
  if (g.box.teams[teamId]) g.box.teams[teamId].E++;
}

function maybeErrorOnBallInPlay(g, defTeam){
  // Error chance is mostly controlled by defense (higher DEF -> fewer errors)
  const defAvg = teamDefenseAvg(defTeam); // 0..1
  const err = clamp01(0.045 - (defAvg-0.5)*0.05); // ~0.02..0.07
  return Math.random() < err;
}

function maybeDoublePlay(g, defTeam, batter){
  // Only on ground-ball style outs: runner on 1st and <2 outs
  if (g.outs >= 2) return false;
  if (!g.bases[0]) return false;

  // Faster runner beats it sometimes
  const runner = g.bases[0];
  const runnerSPD = (runner.SPD ?? 50)/100;
  const defAvg = teamDefenseAvg(defTeam);
  const dpChance = clamp01(0.22 + defAvg*0.18 - runnerSPD*0.20);

  if (Math.random() < dpChance){
    // double play: batter + runner out
    g.bases[0] = null;
    g.outs += 2;
    logLine(`⚡ Double play! ${defTeam.name} turns two and wipes out the inning threat. ${crowd()}`);
    const fielder = (defTeam.players||[]).slice().sort((a,b)=>(b.DEF??0)-(a.DEF??0))[0] || defTeam.players?.[0];
    if (fielder) showHighlight(fielder, `${fielder.name} starts the double play!`);
    // batter AB
    const bs = g.box.players[batter.id]; if (bs){ bs.AB++; }
    return true;
  }
  return false;
}

function nextPlay(){
  const g = app.game;
  if (!g){ logLine("Pick teams and start a new game first."); return; }

  // Steal attempts happen before some pitches
  if (maybeAttemptSteal(g)) return;

  const off = offenseTeam(g);
  const def = defenseTeam(g);
  const batter = nextBatter(g, off);
  const pitcher = (def.id === g.home.id) ? g.pitcherHome : g.pitcherAway;

  if (!batter || !pitcher){
    logLine("This team needs at least 1 batter + 1 pitcher (or a player with PIT).");
    return;
  }

  // pitcher faced a batter
  const pLine = g.box.players[pitcher.id];
  if (pLine){ pLine.BF++; }

  const result = batterVsPitcherResult(batter, pitcher, def);

  const highlightChance = batter.isStar ? 0.60 : 0.30;

  if (result === "K"){
    g.outs++;
    applyHitStats(g, batter, "K");
    if (pLine){ pLine.P_K++; pLine.P_OUTS++; }
    logLine(`${offenseFlavor("K", batter, 0)} ${crowd()}`);
    if (Math.random() < highlightChance) showHighlight(pitcher, `${pitcher.name} paints the corner for a strikeout!`);
  }
  else if (result === "OUT"){
    // Check double play chance first
    if (maybeDoublePlay(g, def, batter)){
      if (pLine){ pLine.P_OUTS += 2; }
    } else {
      // Possible error instead of a clean out
      if (maybeErrorOnBallInPlay(g, def)){
        applyHitStats(g, batter, "OUT"); // AB counts
        chargeError(g, def);
        // batter reaches on error; runners may advance one base sometimes
        const adv = Math.random() < 0.35 ? 2 : 1;
        if (adv === 2 && g.bases[2]){ /* keep simple */ }
        // treat as a single-like advance but not a hit
        logLine(`😬 Error! ${def.name} boots the ball and ${batter.name} reaches safely. ${crowd()}`);
        showHighlight(batter, `${batter.name} reaches on an error!`);
        // advance runners similar to walk but with a bit more movement
        if (g.bases[2]){ /* runner holds */ }
        if (g.bases[1] && Math.random()<0.55){ g.bases[2] = g.bases[1]; g.bases[1]=null; }
        if (g.bases[0] && Math.random()<0.55){ g.bases[1] = g.bases[0]; g.bases[0]=null; }
        g.bases[0] = batter;
      } else {
        g.outs++;
        applyHitStats(g, batter, "OUT");
        if (pLine){ pLine.P_OUTS++; }
        const { fielder, text } = defenseFlavor(def, batter);
        logLine(`${text} ${crowd()}`);
        if (Math.random() < 0.35) showHighlight(fielder, `${fielder.name} flashes the glove!`);
      }
    }
  }
  else if (result === "WALK"){
    const runs = advanceRunners(g, "WALK", batter);
    applyHitStats(g, batter, "WALK");
    if (pLine){ pLine.P_BB++; }
    logLine(offenseFlavor("WALK", batter, runs));
    if (Math.random() < highlightChance) showHighlight(batter, `${batter.name} draws a big-time walk.`);
  }
  else {
    const runs = advanceRunners(g, result, batter);
    applyHitStats(g, batter, result);
    if (pLine){ pLine.P_H++; }
    logLine(offenseFlavor(result, batter, runs));
    if (Math.random() < highlightChance) showHighlight(batter, `${batter.name} with the ${result.toLowerCase()}! ${crowd()}`);
  }

  // End half inning
  if (g.outs >= 3){
    g.outs = 0;
    g.bases = [null,null,null];
    g.top = !g.top;
    if (g.top) g.inning++;
    logLine("— Half-inning over —");
  }

  updateGameUI();
  updateStartButton();
  renderSeason();
}

function simHalfInning(){
  const g = app.game;
  if (!g){ logLine("Start a game first."); return; }
  const startTop = g.top;
  const startInning = g.inning;
  while (g.top === startTop && g.inning === startInning){
    nextPlay();
  }
}

function simFullGame(){
  const g = app.game;
  if (!g){ logLine("Start a game first."); return; }
  // Sim 9 innings minimum, extend if tied
  while (g.inning <= 9 || g.scoreHome === g.scoreAway){
    // sim until end of half-inning
    simHalfInning();
    // stop if game is over after bottom 9+ and not tied
    if (!g.top && g.inning >= 9 && g.scoreHome !== g.scoreAway){
      // we are in bottom; half inning just ended, now top toggles to true and inning++ happens on toggle to top
      // our logic increments inning when toggling to top, so check:
    }
    if (g.inning > 12) break; // safety
  }
  logLine(`🏁 Final: ${formatTeamLabel(g.home)} ${g.scoreHome} — ${g.scoreAway} ${formatTeamLabel(g.away)}`);
}

/* ---------- Utilities ---------- */
function escapeHTML(s){
  return (s ?? "").toString().replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function timeAgo(ts){
  if (!ts) return "just now";
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff/60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs/24);
  return `${days}d ago`;
}

/* ---------- Actions ---------- */
async function loadAll(){
  app.teams = await dbGetAllTeams();

  // First run: make a starter team so it's not empty
  if (!app.teams.length){
    const t = createBlankTeam();
    t.name = "Starter Squad";
    t.city = "Home";
    t.stadium = "Practice Park";
    await dbPutTeam(t);
    app.teams = [t];
  }

  // Ensure selected ids still exist
  if (app.activeTeamId && !app.teams.some(t=>t.id===app.activeTeamId)) app.activeTeamId = null;
  if (app.homeTeamId && !app.teams.some(t=>t.id===app.homeTeamId)) app.homeTeamId = null;
  if (app.awayTeamId && !app.teams.some(t=>t.id===app.awayTeamId)) app.awayTeamId = null;

  if (!app.activeTeamId) app.activeTeamId = app.teams[0]?.id || null;
  app.editingTeamId = app.activeTeamId;

  renderAll();
}

function renderAll(){
  renderTeamSelects();
  renderTeamList();
  fillTeamEditor(app.teams.find(t=>t.id===app.activeTeamId));
  renderRoster();
  updateGameUI();
  updateStartButton();
  renderSeason();
}

async function createNewTeam(){
  const t = createBlankTeam();
  t.name = "New Team";
  await saveTeam(t);
  app.activeTeamId = t.id;
  app.editingTeamId = t.id;
  renderAll();
  setTab("teams");
  logLine("🆕 New team created. Give it a name and save!");
}

async function saveTeamFromEditor(){
  const team = app.teams.find(t=>t.id===app.activeTeamId) || createBlankTeam();
  team.name = safeText($("#teamName").value) || "Unnamed Team";
  team.city = safeText($("#teamCity").value);
  team.stadium = safeText($("#teamStadium").value);
  team.homeAdv = Number($("#teamHomeAdv").value || 0);
  team.colors = [$("#teamColor1").value, $("#teamColor2").value, $("#teamColor3").value];

  // logo upload (optional)
  const logoFile = $("#teamLogo").files[0];
  if (logoFile){
    team.logo = await fileToDataURL(logoFile);
    $("#teamLogo").value = "";
  }

  await saveTeam(team);
  app.activeTeamId = team.id;
  renderAll();
}

async function duplicateTeam(){
  const src = app.teams.find(t=>t.id===app.activeTeamId);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = src.name + " Copy";
  copy.createdAt = now();
  copy.updatedAt = now();
  // new ids for players
  copy.players = (copy.players||[]).map(p => ({...p, id: uid()}));
  await saveTeam(copy);
  app.activeTeamId = copy.id;
  renderAll();
}

async function deleteTeam(){
  const id = app.activeTeamId;
  if (!id) return;
  const t = app.teams.find(x=>x.id===id);
  if (!t) return;

  const ok = confirm(`Delete team "${formatTeamLabel(t)}"? This cannot be undone (unless you exported it).`);
  if (!ok) return;

  await dbDeleteTeam(id);
  app.teams = app.teams.filter(x => x.id !== id);
  app.activeTeamId = app.teams[0]?.id || null;
  renderAll();
}

function exportTeam(){
  const t = app.teams.find(x=>x.id===app.activeTeamId);
  if (!t) return;
  downloadJSON(`${formatTeamLabel(t).replace(/\s+/g,"_")}.team.json`, { type:"bb_team", version:1, team:t });
}

async function importTeam(file){
  try{
    const data = await readJSONFile(file);
    if (!data || data.type !== "bb_team" || !data.team) throw new Error("Not a team export.");
    const t = data.team;

    // sanitize + new ids if collision
    t.id = app.teams.some(x=>x.id===t.id) ? uid() : t.id;
    t.name = safeText(t.name) || "Imported Team";
    t.updatedAt = now();
    t.createdAt = t.createdAt || now();
    t.players = (t.players||[]).map(p => ({...p, id: uid()}));

    await saveTeam(t);
    app.activeTeamId = t.id;
    renderAll();
    setTab("teams");
  } catch(e){
    alert("Import failed: " + (e?.message || e));
  }
}

async function addOrEditPlayer(){
  const team = app.teams.find(t=>t.id===app.activeTeamId);
  if (!team) return alert("Pick a team first.");

  const name = safeText($("#playerName").value);
  if (!name) return alert("Player name required.");

  // If editing, photo is optional; if adding, photo required
  const editingId = $("#btnAddPlayer").dataset.editing || "";
  const existing = editingId ? team.players.find(p=>p.id===editingId) : null;

  let img = existing?.img || null;
  const file = $("#playerPhoto").files[0];
  if (file) img = await fileToDataURL(file);
  if (!img) return alert("Player photo required (upload an image).");

  const pos = $("#playerPos").value || "DH";
  const isPitcher = $("#isPitcher").checked || pos === "P";
  const isStar = $("#isStar").checked;

  const stats = readStatSliders();

  const player = {
    id: existing?.id || uid(),
    name,
    img,
    pos,
    isPitcher,
    isStar,
    ...stats
  };

  if (existing){
    team.players = team.players.map(p => p.id === existing.id ? player : p);
  } else {
    team.players.push(player);
  }

  await saveTeam(team);
  renderAll();
  resetPlayerForm();

  // reset edit mode
  $("#btnAddPlayer").textContent = "Add player";
  delete $("#btnAddPlayer").dataset.editing;
  $("#btnResetPlayerForm").textContent = "Reset form";
  delete $("#btnResetPlayerForm").dataset.cancel;

  logLine(existing ? `✅ Updated ${player.name}.` : `✅ Added ${player.name} to ${formatTeamLabel(team)}.`);
}

async function clearRoster(){
  const team = app.teams.find(t=>t.id===app.activeTeamId);
  if (!team) return;
  const ok = confirm(`Clear roster for "${formatTeamLabel(team)}"?`);
  if (!ok) return;
  team.players = [];
  await saveTeam(team);
  renderAll();
}

async function autoLineup(){
  const team = app.teams.find(t=>t.id===app.activeTeamId);
  if (!team) return;
  // Sort by OVR and keep that order (non-pitchers first)
  const ps = [...team.players];
  ps.sort((a,b)=> calcPlayerOVR(b) - calcPlayerOVR(a));
  team.players = ps;
  await saveTeam(team);
  renderAll();
}

async function shuffleLineup(){
  const team = app.teams.find(t=>t.id===app.activeTeamId);
  if (!team) return;
  const ps = [...team.players];
  for (let i=ps.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [ps[i],ps[j]] = [ps[j],ps[i]];
  }
  team.players = ps;
  await saveTeam(team);
  renderAll();
}

function setPresetToSliders(){
  const preset = $("#preset").value;
  const stats = applyPreset(preset);
  setStatSliders(stats);
  // If preset implies pitcher, toggle
  if (preset === "ace" || preset === "reliever"){
    $("#isPitcher").checked = true;
    $("#playerPos").value = "P";
  }
}

/* ---------- Start game ---------- */
function startNewGame(){
  const home = app.teams.find(t=>t.id===app.homeTeamId);
  const away = app.teams.find(t=>t.id===app.awayTeamId);
  if (!home || !away){ logLine("Pick BOTH a Home team and an Away team."); alert("Pick BOTH a Home team and an Away team (Game tab → Home/Away dropdowns)."); return; }
  if ((home.players||[]).length < 2 || (away.players||[]).length < 2){
    logLine("Each team needs at least 2 players (and ideally 1 pitcher)."); alert("Each team needs at least 2 players. Go to Teams → add players, then try again.");
    return;
  }

  // Choose pitchers (highest PIT among pitchers, else highest PIT overall)
  const pickPitcher = (team) => {
    const ps = (team.players||[]).filter(Boolean);
    const pits = ps.filter(p=>isPitcher(p));
    const pool = pits.length ? pits : ps;
    return pool.reduce((best,p)=> ((p.PIT??0) > (best.PIT??0) ? p : best), pool[0]);
  };

  const pitcherHome = pickPitcher(home);
  const pitcherAway = pickPitcher(away);

  const g = {
    id: uid(),
    home, away,
    pitcherHome, pitcherAway,
    inning: 1,
    top: true,
    outs: 0,
    scoreHome: 0,
    scoreAway: 0,
    bases: [null,null,null],
    idxHome: 0,
    idxAway: 0,
    // game stat tracking
    box: {
      teams: {
        [home.id]: { R:0, H:0, E:0 },
        [away.id]: { R:0, H:0, E:0 },
      },
      players: {} // playerId -> stat line
    }
  };

  // init player stat lines
  const initPlayer = (p) => {
    g.box.players[p.id] = g.box.players[p.id] || {
      name: p.name, teamId: null,
      AB:0, H:0, _2B:0, _3B:0, HR:0, BB:0, K:0, R:0, RBI:0,
      SB:0, CS:0,
      // pitching-ish (outs pitched)
      BF:0, P_OUTS:0, P_H:0, P_BB:0, P_K:0, ER:0
    };
  };

  (home.players||[]).forEach(p=>{ initPlayer(p); g.box.players[p.id].teamId = home.id; });
  (away.players||[]).forEach(p=>{ initPlayer(p); g.box.players[p.id].teamId = away.id; });

  app.game = g;
  $("#log").innerHTML = "";
  logLine(`🎲 New game: ${formatTeamLabel(home)} vs ${formatTeamLabel(away)}!`);
  updateGameUI();
  updateStartButton();
  renderSeason();
}

function swapTeams(){
  const h = $("#homeTeamSelect").value;
  const a = $("#awayTeamSelect").value;
  $("#homeTeamSelect").value = a;
  $("#awayTeamSelect").value = h;
}

/* ---------- Wire up events ---------- */
function bindEvents(){
  // Tabs
  $$(".tab").forEach(b => b.addEventListener("click", ()=> setTab(b.dataset.tab)));

  // Team list controls
  $("#teamSearch").addEventListener("input", renderTeamList);
  $("#sortTeams").addEventListener("change", renderTeamList);

  $("#btnNewTeam").addEventListener("click", createNewTeam);
  $("#btnSaveTeam").addEventListener("click", saveTeamFromEditor);
  $("#btnGoRoster").addEventListener("click", ()=> setTab("roster"));

  $("#btnDuplicateTeam").addEventListener("click", duplicateTeam);
  $("#btnDeleteTeam").addEventListener("click", deleteTeam);
  $("#btnExportTeam").addEventListener("click", exportTeam);

  $("#importTeamFile").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if (file) await importTeam(file);
    e.target.value = "";
  });

  // Team selects
  $("#activeTeamSelect").addEventListener("change", (e)=> selectTeam(e.target.value));
  $("#homeTeamSelect").addEventListener("change", (e)=> { app.homeTeamId = e.target.value; updateStartButton(); });
  $("#awayTeamSelect").addEventListener("change", (e)=> { app.awayTeamId = e.target.value; updateStartButton(); });

  // Roster
  $("#rosterFilter").addEventListener("input", renderRoster);
  $("#btnAutoLineup").addEventListener("click", autoLineup);
  $("#btnShuffleLineup").addEventListener("click", shuffleLineup);
  $("#btnClearRoster").addEventListener("click", clearRoster);

  // Player form sliders
  statKeys.forEach(k => {
    $("#" + k).addEventListener("input", ()=> $("#" + k + "v").textContent = $("#" + k).value);
  });

  $("#preset").addEventListener("change", setPresetToSliders);
  $("#btnRandomStats").addEventListener("click", ()=>{
    const r = {};
    for (const k of statKeys) r[k] = Math.floor(35 + Math.random()*61);
    setStatSliders(r);
  });
  $("#btnMaxHype").addEventListener("click", ()=>{
    // fun button: boosts but keeps it within 100
    const s = readStatSliders();
    for (const k of statKeys) s[k] = clamp(s[k] + 10, 0, 100);
    setStatSliders(s);
    $("#isStar").checked = true;
  });

  $("#btnAddPlayer").addEventListener("click", addOrEditPlayer);

  $("#btnResetPlayerForm").addEventListener("click", ()=>{
    if ($("#btnResetPlayerForm").dataset.cancel){
      // cancel edit
      $("#btnAddPlayer").textContent = "Add player";
      delete $("#btnAddPlayer").dataset.editing;
      $("#btnResetPlayerForm").textContent = "Reset form";
      delete $("#btnResetPlayerForm").dataset.cancel;
      resetPlayerForm();
      logLine("🧼 Edit cancelled.");
      return;
    }
    resetPlayerForm();
  });

  // Game
  $("#btnNewGame").addEventListener("click", ()=>{
    setTab("game");
    startNewGame();
  });
  $("#btnSwapTeams").addEventListener("click", swapTeams);

  $("#nextPlay").addEventListener("click", nextPlay);
  $("#simHalf").addEventListener("click", simHalfInning);
  $("#simGame").addEventListener("click", simFullGame);
  $("#btnResetLog").addEventListener("click", ()=>{
    $("#log").innerHTML = "";
    logLine("🧾 Play-by-play cleared.");
  });
}

/* ---------- Init ---------- */
bindEvents();
resetPlayerForm();
setTab("teams");


/* ==========================================================
   Season Mode (League + Standings + Schedule)
   ========================================================== */

app.season = null;

function blankSeason(){
  return {
    id: uid(),
    name: "New Season",
    createdAt: now(),
    updatedAt: now(),
    teamIds: [],
    gamesPerTeam: 20,
    // schedule: array of {id, homeId, awayId, played, scoreHome, scoreAway, dateIdx}
    schedule: [],
    cursor: 0, // next unplayed game index
    // records by teamId
    records: {}, // {W,L,RS,RA}
    // season player stats (aggregate across games)
    playerStats: {} // playerId -> statline
  };
}

function seasonEnsureRecords(season){
  season.teamIds.forEach(tid=>{
    season.records[tid] = season.records[tid] || { W:0, L:0, RS:0, RA:0 };
  });
}

function renderSeasonTeamPick(){
  const wrap = $("#seasonTeamPick");
  if (!wrap) return;
  wrap.innerHTML = "";
  const s = app.season || blankSeason();

  // show all teams as selectable pills
  (app.teams||[]).forEach(t=>{
    const on = s.teamIds.includes(t.id);
    const div = document.createElement("div");
    div.className = "pill" + (on ? " on" : "");
    div.innerHTML = `<span class="dot"></span><span>${escapeHTML(formatTeamLabel(t))}</span>`;
    div.addEventListener("click", ()=>{
      const season = app.season || blankSeason();
      if (season.teamIds.includes(t.id)) season.teamIds = season.teamIds.filter(x=>x!==t.id);
      else season.teamIds.push(t.id);
      app.season = season;
      renderSeason();
    });
    wrap.appendChild(div);
  });
}

function genScheduleRoundRobin(teamIds, gamesPerTeam){
  // Simple schedule generator:
  // build a list of matchups and then shuffle.
  const matchups = [];
  for (let i=0;i<teamIds.length;i++){
    for (let j=i+1;j<teamIds.length;j++){
      matchups.push([teamIds[i], teamIds[j]]);
    }
  }
  // How many total games to target
  const totalTarget = Math.max(1, Math.floor(teamIds.length * gamesPerTeam / 2));
  // Repeat matchups as needed
  const games = [];
  let dateIdx = 0;
  while (games.length < totalTarget){
    // shuffle matchups each cycle
    const shuffled = matchups.slice().sort(()=>Math.random()-0.5);
    for (const [a,b] of shuffled){
      const homeFirst = Math.random()<0.5;
      games.push({
        id: uid(),
        homeId: homeFirst ? a : b,
        awayId: homeFirst ? b : a,
        played: false,
        scoreHome: 0,
        scoreAway: 0,
        dateIdx
      });
      dateIdx++;
      if (games.length >= totalTarget) break;
    }
  }
  return games;
}

function seasonCreateFromUI(){
  const s = app.season || blankSeason();
  s.name = safeText($("#seasonName")?.value) || "Season";
  s.gamesPerTeam = Number($("#seasonGamesPerTeam")?.value || 20);

  // if user hasn't selected teams yet, auto-use all teams
  if (!s.teamIds.length){
    s.teamIds = (app.teams||[]).map(t=>t.id);
  }

  if (s.teamIds.length < 2){
    logLine("Season needs at least 2 teams.");
    return;
  }

  s.records = {};
  s.playerStats = {};
  seasonEnsureRecords(s);

  s.schedule = genScheduleRoundRobin(s.teamIds, s.gamesPerTeam);
  s.cursor = 0;
  s.updatedAt = now();
  app.season = s;

  logLine(`📅 Season created: ${s.name} with ${s.teamIds.length} teams and ${s.schedule.length} scheduled games.`);
  renderSeason();
}

function seasonReset(){
  app.season = blankSeason();
  renderSeason();
}

function seasonExport(){
  const s = app.season;
  if (!s){ alert("No season loaded."); return; }
  const blob = new Blob([JSON.stringify(s, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(s.name||"season").replace(/[^\w\-]+/g,"_")}.season.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function seasonImportFile(file){
  const text = await file.text();
  const s = JSON.parse(text);
  // minimal validation
  if (!s || !Array.isArray(s.teamIds) || !Array.isArray(s.schedule)){
    alert("That doesn't look like a season file.");
    return;
  }
  app.season = s;
  renderSeason();
  logLine(`⬆️ Imported season: ${s.name || "Season"}`);
}

function seasonNextUnplayedIndex(s){
  // advance cursor to next unplayed
  let i = s.cursor || 0;
  while (i < s.schedule.length && s.schedule[i].played) i++;
  s.cursor = i;
  return i;
}

function mergePlayerStats(season, game){
  // Add game.box players into season.playerStats
  for (const [pid, line] of Object.entries(game.box.players || {})){
    season.playerStats[pid] = season.playerStats[pid] || {
      name: line.name,
      teamId: line.teamId,
      AB:0,H:0,_2B:0,_3B:0,HR:0,BB:0,K:0,R:0,RBI:0,SB:0,CS:0,
      BF:0,P_OUTS:0,P_H:0,P_BB:0,P_K:0,ER:0
    };
    const sLine = season.playerStats[pid];
    for (const k of Object.keys(sLine)){
      if (k==="name" || k==="teamId") continue;
      sLine[k] += (line[k] || 0);
    }
  }
}

function simGameForSeason(homeTeam, awayTeam){
  // Use the same in-memory game sim, but run it quickly with stronger stat influence.
  app.homeTeamId = homeTeam.id;
  app.awayTeamId = awayTeam.id;
  startNewGame();

  const g = app.game;
  if (!g) return null;

  // Quick sim: do full game
  // Also: reduce randomness slightly by running to completion with our weighted engine.
  while (g.inning <= 9 || g.scoreHome === g.scoreAway){
    // simulate half innings until ends
    simHalfInning();
    // Safety
    if (g.inning > 14) break;
  }

  // Earned runs approximation: treat all runs as ER (simple)
  const pitHome = g.box.players[g.pitcherHome.id];
  const pitAway = g.box.players[g.pitcherAway.id];
  if (pitHome) pitHome.ER += g.scoreAway;
  if (pitAway) pitAway.ER += g.scoreHome;

  return g;
}

function seasonPlayGames(n){
  const s = app.season;
  if (!s || !s.schedule?.length){ logLine("Create a season schedule first."); return; }

  let played = 0;
  while (played < n){
    const idx = seasonNextUnplayedIndex(s);
    if (idx >= s.schedule.length) break;

    const gameRec = s.schedule[idx];
    const home = app.teams.find(t=>t.id===gameRec.homeId);
    const away = app.teams.find(t=>t.id===gameRec.awayId);
    if (!home || !away){
      gameRec.played = true;
      s.cursor = idx+1;
      continue;
    }

    const g = simGameForSeason(home, away);
    if (!g){
      gameRec.played = true;
      s.cursor = idx+1;
      continue;
    }

    gameRec.played = true;
    gameRec.scoreHome = g.scoreHome;
    gameRec.scoreAway = g.scoreAway;

    // Update records
    const rh = s.records[home.id] || (s.records[home.id]={W:0,L:0,RS:0,RA:0});
    const ra = s.records[away.id] || (s.records[away.id]={W:0,L:0,RS:0,RA:0});
    rh.RS += g.scoreHome; rh.RA += g.scoreAway;
    ra.RS += g.scoreAway; ra.RA += g.scoreHome;

    if (g.scoreHome > g.scoreAway){ rh.W++; ra.L++; }
    else { ra.W++; rh.L++; }

    // Merge player stats
    mergePlayerStats(s, g);

    s.cursor = idx+1;
    s.updatedAt = now();
    played++;
  }

  renderSeason();
  if (played) logLine(`📣 Season sim: played ${played} game${played===1?"":"s"}.`);
  else logLine("Season is finished!");
}

function seasonLeaders(season){
  const stats = Object.values(season.playerStats || {});
  const bat = stats
    .filter(p=> (p.AB||0) >= 10)
    .map(p=>{
      const avg = (p.H||0) / Math.max(1,p.AB||0);
      return { ...p, AVG: avg };
    })
    .sort((a,b)=> (b.HR - a.HR) || (b.RBI - a.RBI) || (b.AVG - a.AVG))
    .slice(0,8);

  const pit = stats
    .filter(p=> (p.BF||0) >= 10)
    .map(p=>{
      const ip = (p.P_OUTS||0) / 3;
      const era = (p.ER||0) * 9 / Math.max(0.1, ip);
      return { ...p, IP: ip, ERA: era };
    })
    .sort((a,b)=> (a.ERA - b.ERA) || (b.P_K - a.P_K))
    .slice(0,8);

  return { bat, pit };
}

function renderSeason(){
  const s = app.season || blankSeason();
  app.season = s;

  // Fill inputs
  if ($("#seasonName")) $("#seasonName").value = s.name || "";
  if ($("#seasonGamesPerTeam")) $("#seasonGamesPerTeam").value = s.gamesPerTeam || 20;

  renderSeasonTeamPick();

  const info = $("#seasonInfo");
  if (info){
    const done = (s.schedule||[]).filter(g=>g.played).length;
    info.textContent = s.schedule?.length
      ? `Teams: ${s.teamIds.length} • Games: ${done}/${s.schedule.length} played`
      : `Pick teams and create a schedule.`;
  }

  // Standings
  const tbody = $("#seasonStandings tbody");
  if (tbody){
    tbody.innerHTML = "";
    const rows = s.teamIds.map(tid=>{
      const r = s.records[tid] || {W:0,L:0,RS:0,RA:0};
      const pct = (r.W + r.L) ? (r.W/(r.W+r.L)) : 0;
      const diff = r.RS - r.RA;
      const team = app.teams.find(t=>t.id===tid);
      return { tid, team, ...r, pct, diff };
    }).sort((a,b)=> (b.pct - a.pct) || (b.diff - a.diff) || (b.RS - a.RS));

    for (const row of rows){
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHTML(formatTeamLabel(row.team||{name:"Unknown"}))}</td>
        <td>${row.W}</td>
        <td>${row.L}</td>
        <td>${row.pct.toFixed(3).replace("0."," .")}</td>
        <td>${row.RS}</td>
        <td>${row.RA}</td>
        <td>${row.diff}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // Recent results (last 10 played)
  const res = $("#seasonResults");
  if (res){
    res.innerHTML = "";
    const played = (s.schedule||[]).filter(g=>g.played).slice(-10).reverse();
    if (!played.length){
      res.innerHTML = `<div class="muted small">No games played yet.</div>`;
    } else {
      played.forEach(gm=>{
        const home = app.teams.find(t=>t.id===gm.homeId);
        const away = app.teams.find(t=>t.id===gm.awayId);
        const div = document.createElement("div");
        div.className = "result";
        div.innerHTML = `
          <div>
            <div><strong>${escapeHTML(formatTeamLabel(away||{name:"Away"}))}</strong> ${gm.scoreAway} @ <strong>${escapeHTML(formatTeamLabel(home||{name:"Home"}))}</strong> ${gm.scoreHome}</div>
            <div class="small">Game #${(s.schedule||[]).indexOf(gm)+1}</div>
          </div>
          <div class="small">${gm.scoreHome===gm.scoreAway ? "T" : (gm.scoreHome>gm.scoreAway ? "Home W" : "Away W")}</div>
        `;
        res.appendChild(div);
      });
    }
  }

  // Leaders
  const { bat, pit } = seasonLeaders(s);
  const batEl = $("#batLeaders");
  if (batEl){
    batEl.innerHTML = "";
    bat.forEach(p=>{
      const team = app.teams.find(t=>t.id===p.teamId);
      const div = document.createElement("div");
      div.className = "leader";
      div.innerHTML = `<div><strong>${escapeHTML(p.name)}</strong> <span class="small">(${escapeHTML(team?formatTeamLabel(team):"")})</span></div>
                       <div class="small">HR ${p.HR} • RBI ${p.RBI} • AVG ${(p.AVG||0).toFixed(3).slice(1)}</div>`;
      batEl.appendChild(div);
    });
    if (!bat.length) batEl.innerHTML = `<div class="muted small">Play some games to see leaders.</div>`;
  }

  const pitEl = $("#pitLeaders");
  if (pitEl){
    pitEl.innerHTML = "";
    pit.forEach(p=>{
      const team = app.teams.find(t=>t.id===p.teamId);
      const div = document.createElement("div");
      div.className = "leader";
      div.innerHTML = `<div><strong>${escapeHTML(p.name)}</strong> <span class="small">(${escapeHTML(team?formatTeamLabel(team):"")})</span></div>
                       <div class="small">ERA ${(p.ERA||0).toFixed(2)} • K ${p.P_K} • IP ${(p.IP||0).toFixed(1)}</div>`;
      pitEl.appendChild(div);
    });
    if (!pit.length) pitEl.innerHTML = `<div class="muted small">Play some games to see leaders.</div>`;
  }
}

function wireSeasonUI(){
  $("#seasonNew")?.addEventListener("click", ()=>{ app.season = blankSeason(); renderSeason(); setTab("season"); });
  $("#seasonCreate")?.addEventListener("click", seasonCreateFromUI);
  $("#seasonReset")?.addEventListener("click", seasonReset);

  $("#seasonPlayOne")?.addEventListener("click", ()=>seasonPlayGames(1));
  $("#seasonPlaySeven")?.addEventListener("click", ()=>seasonPlayGames(7));
  $("#seasonSimAll")?.addEventListener("click", ()=>{
    const s = app.season;
    if (!s || !s.schedule?.length){ logLine("Create a season schedule first."); return; }
    // play remaining
    const remaining = s.schedule.filter(g=>!g.played).length;
    seasonPlayGames(remaining);
  });

  $("#seasonExport")?.addEventListener("click", seasonExport);
  $("#seasonImport")?.addEventListener("change", (e)=>{
    const f = e.target.files?.[0];
    if (f) seasonImportFile(f);
    e.target.value = "";
  });
}

loadAll();
logLine("Welcome! Create teams, add players, then start a game. ⚾");