// ---------- Storage ----------
const KEY = "bb_roster_v1";
function loadRoster(){ return JSON.parse(localStorage.getItem(KEY) || "[]"); }
function saveRoster(r){ localStorage.setItem(KEY, JSON.stringify(r)); }

// ---------- DOM ----------
const rosterEl = document.getElementById("roster");
const logEl = document.getElementById("log");
const hiImg = document.getElementById("highlightImg");
const hiText = document.getElementById("highlightText");

const elScore = document.getElementById("score");
const elInning = document.getElementById("inning");
const elOuts = document.getElementById("outs");

const sliders = ["HIT","PWR","SPD","DEF","ARM","PIT"];
for (const s of sliders){
  const input = document.getElementById(s);
  const out = document.getElementById(s+"v");
  input.addEventListener("input", ()=> out.textContent = input.value);
}

// ---------- Roster UI ----------
function renderRoster(){
  const roster = loadRoster();
  rosterEl.innerHTML = "";

  if (roster.length === 0){
    rosterEl.innerHTML = `<div style="opacity:.85">No players yet. Add some!</div>`;
    return;
  }

  roster.forEach((p, idx)=>{
    const div = document.createElement("div");
    div.className = "playerCard";
    div.innerHTML = `
      <img src="${p.img}" alt="" />
      <div style="flex:1">
        <div style="font-weight:700">${p.name}</div>
        <div style="opacity:.85;font-size:13px">HIT ${p.HIT} • PWR ${p.PWR} • SPD ${p.SPD} • DEF ${p.DEF} • ARM ${p.ARM} • PIT ${p.PIT}</div>
      </div>
      <button data-del="${idx}">Remove</button>
    `;
    rosterEl.appendChild(div);
  });

  rosterEl.querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const i = Number(btn.dataset.del);
      const roster = loadRoster();
      roster.splice(i,1);
      saveRoster(roster);
      renderRoster();
    });
  });
}

function logLine(text){
  const div = document.createElement("div");
  div.className = "logline";
  div.textContent = text;
  logEl.prepend(div);
}

function showHighlight(player, caption){
  hiImg.src = player.img;
  hiText.textContent = caption;
}

// ---------- Add Player ----------
document.getElementById("addPlayer").addEventListener("click", async ()=>{
  const name = document.getElementById("name").value.trim();
  const file = document.getElementById("photo").files[0];
  if (!name) return alert("Name required.");
  if (!file) return alert("Photo required.");

  const img = await fileToDataURL(file);
  const p = { name, img };
  for (const s of sliders) p[s] = Number(document.getElementById(s).value);

  const roster = loadRoster();
  roster.push(p);
  saveRoster(roster);

  document.getElementById("name").value = "";
  document.getElementById("photo").value = "";

  renderRoster();
});

document.getElementById("clearRoster").addEventListener("click", ()=>{
  localStorage.removeItem(KEY);
  renderRoster();
});

// Convert uploaded image -> data URL (so it can be saved)
function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Game Sim ----------
const HOME = { name:"Home", lineup:[], pitcher:null };
const AWAY = { name:"Away", lineup:[], pitcher:null };

const state = {
  inning: 1,
  top: true,
  outs: 0,
  scoreHome: 0,
  scoreAway: 0,
  bases: [null,null,null],
  idxHome: 0,
  idxAway: 0
};

function uiUpdate(){
  elScore.textContent = `${HOME.name} ${state.scoreHome} — ${state.scoreAway} ${AWAY.name}`;
  elInning.textContent = `Inning ${state.inning} (${state.top ? "Top" : "Bottom"})`;
  elOuts.textContent = `Outs ${state.outs}`;
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function weightedChoice(items){
  const total = items.reduce((s,i)=>s+i.w,0);
  let r = Math.random()*total;
  for (const it of items){ r -= it.w; if (r<=0) return it.key; }
  return items[items.length-1].key;
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function syncRosterIntoTeams(){
  const roster = loadRoster();
  if (roster.length < 3) {
    logLine("Add at least 3 players to run games.");
    return false;
  }

  // Simple rule:
  // - highest PIT becomes pitcher
  // - rest are lineup
  const sorted = [...roster].sort((a,b)=>b.PIT - a.PIT);
  HOME.pitcher = sorted[0];
  HOME.lineup = sorted.slice(1);

  // Away team = same roster but slightly randomized stats (so you always have an opponent)
  // Later you can build a real away roster too.
  AWAY.pitcher = {
    ...sorted[0],
    name: sorted[0].name + " (Rival)",
    HIT: sorted[0].HIT, PWR: sorted[0].PWR, SPD: sorted[0].SPD, DEF: sorted[0].DEF, ARM: sorted[0].ARM,
    PIT: clampStat(sorted[0].PIT - 5 + Math.floor(Math.random()*11))
  };
  AWAY.lineup = HOME.lineup.map(p => ({
    ...p,
    name: p.name + " (Rival)",
    HIT: clampStat(p.HIT - 5 + Math.floor(Math.random()*11)),
    PWR: clampStat(p.PWR - 5 + Math.floor(Math.random()*11)),
    SPD: clampStat(p.SPD - 5 + Math.floor(Math.random()*11)),
    DEF: clampStat(p.DEF - 5 + Math.floor(Math.random()*11)),
    ARM: clampStat(p.ARM - 5 + Math.floor(Math.random()*11)),
    PIT: clampStat(p.PIT)
  }));

  return true;
}

function clampStat(x){ return Math.max(0, Math.min(100, x)); }

function offenseTeam(){ return state.top ? AWAY : HOME; }
function defenseTeam(){ return state.top ? HOME : AWAY; }

function nextBatter(team){
  const key = (team === HOME) ? "idxHome" : "idxAway";
  const batter = team.lineup[state[key] % team.lineup.length];
  state[key] = (state[key] + 1) % team.lineup.length;
  return batter;
}

function batterVsPitcherResult(batter, pitcher){
  const hit = batter.HIT / 100;
  const pwr = batter.PWR / 100;
  const pit = pitcher.PIT / 100;

  const walkW = 0.06 + (1 - pit)*0.05;
  const strikeoutW = 0.12 + pit*0.12;
  const inPlayW = clamp01(1 - walkW - strikeoutW);

  const contact = clamp01(hit * (1 - (pit*0.55)));

  const inPlayOutcome = weightedChoice([
    { key:"OUT",    w: (1 - contact) * 1.0 },
    { key:"SINGLE", w: contact * (0.62 - pwr*0.15) },
    { key:"DOUBLE", w: contact * (0.22 + pwr*0.05) },
    { key:"TRIPLE", w: contact * (0.03 + (batter.SPD/100)*0.02) },
    { key:"HR",     w: contact * (0.06 + pwr*0.18) },
  ]);

  const primary = weightedChoice([
    { key:"WALK", w: walkW },
    { key:"K",    w: strikeoutW },
    { key:"INPLAY", w: inPlayW }
  ]);

  if (primary === "WALK") return "WALK";
  if (primary === "K") return "K";
  return inPlayOutcome;
}

function addRun(n){
  if (state.top) state.scoreAway += n;
  else state.scoreHome += n;
}

function advanceRunners(hitType, batter){
  let runs = 0;

  const scoreThird = ()=>{ if (state.bases[2]){ runs++; state.bases[2]=null; } };

  if (hitType === "WALK"){
    if (state.bases[0] && state.bases[1] && state.bases[2]) runs++;
    if (state.bases[1] && state.bases[0]) state.bases[2] = state.bases[1];
    if (state.bases[0]) state.bases[1] = state.bases[0];
    state.bases[0] = batter;
    addRun(runs);
    return runs;
  }

  if (hitType === "SINGLE"){
    scoreThird();
    if (state.bases[1]) state.bases[2] = state.bases[1];
    if (state.bases[0]) state.bases[1] = state.bases[0];
    state.bases[0] = batter;
  }

  if (hitType === "DOUBLE"){
    if (state.bases[2]){ runs++; state.bases[2]=null; }
    if (state.bases[1]){ runs++; state.bases[1]=null; }
    if (state.bases[0]) state.bases[2] = state.bases[0];
    state.bases[1] = batter;
    state.bases[0] = null;
  }

  if (hitType === "TRIPLE"){
    for (let i=0;i<3;i++){ if (state.bases[i]){ runs++; state.bases[i]=null; } }
    state.bases[2] = batter;
  }

  if (hitType === "HR"){
    for (let i=0;i<3;i++){ if (state.bases[i]){ runs++; state.bases[i]=null; } }
    runs++;
  }

  addRun(runs);
  return runs;
}

function offenseFlavor(result, batter, runs){
  const lines = {
    WALK: [`${batter.name} works a walk and takes first.`, `${batter.name} won’t chase — ball four.`],
    K:    [`${batter.name} goes down swinging!`, `Strike three — ${batter.name} is retired.`],
    SINGLE:[`${batter.name} lines a single up the middle!`, `${batter.name} pokes one into right for a hit!`],
    DOUBLE:[`${batter.name} smokes a double into the gap!`, `${batter.name} bangs one off the wall — double!`],
    TRIPLE:[`${batter.name} legs out a triple!`, `${batter.name} drives it deep and clears the bases with a triple!`],
    HR:   [`${batter.name} unloads… GONE! Home run!`, `${batter.name} launches one — goodbye!`]
  };
  let t = pick(lines[result] || [`${batter.name} makes something happen.`]);
  if (runs > 0) t += ` (${runs} run${runs===1?"":"s"} score!)`;
  return t;
}

function defenseFlavor(defTeam, batter){
  const fielder = pick(defTeam.lineup);
  const outs = [
    `${fielder.name} makes the play and retires ${batter.name}.`,
    `${batter.name} hits a sharp grounder — ${fielder.name} snags it and throws them out!`,
    `${fielder.name} camps under it and puts it away for the out.`
  ];
  return { fielder, text: pick(outs) };
}

function nextPlay(){
  if (!HOME.pitcher && !syncRosterIntoTeams()) return;

  const off = offenseTeam();
  const def = defenseTeam();

  const batter = nextBatter(off);
  const pitcher = def.pitcher;

  const result = batterVsPitcherResult(batter, pitcher);

  if (result === "K"){
    state.outs++;
    logLine(offenseFlavor("K", batter, 0));
    showHighlight(pitcher, `${pitcher.name} strikes out ${batter.name}!`);
  } else if (result === "OUT"){
    state.outs++;
    const { fielder, text } = defenseFlavor(def, batter);
    logLine(text);
    showHighlight(fielder, `${fielder.name} makes the play!`);
  } else if (result === "WALK"){
    const runs = advanceRunners("WALK", batter);
    logLine(offenseFlavor("WALK", batter, runs));
    showHighlight(batter, `${batter.name} draws a walk.`);
  } else {
    const runs = advanceRunners(result, batter);
    logLine(offenseFlavor(result, batter, runs));
    showHighlight(batter, `${batter.name} with the ${result.toLowerCase()}!`);
  }

  if (state.outs >= 3){
    state.outs = 0;
    state.bases = [null,null,null];
    state.top = !state.top;
    if (state.top) state.inning++;
    logLine("— Half-inning over —");
  }

  uiUpdate();
}

document.getElementById("nextPlay").addEventListener("click", nextPlay);
document.getElementById("simHalf").addEventListener("click", ()=>{
  if (!HOME.pitcher && !syncRosterIntoTeams()) return;
  const startTop = state.top;
  const startInning = state.inning;
  while (state.top === startTop && state.inning === startInning) nextPlay();
});

renderRoster();
uiUpdate();
logLine("Upload players + stats, then click Next Play!");