// Ship build tool: modules, upgrades, commander + skills, talents, conditional buffs, signals, active consumables,
// and an optimizer. Runs the site's own calculation code (assets/lib/*.js) in the browser.
import { computeConfiguration, upgradeGroups, setConsumableTitles } from "../lib/ship.js";
import { flatten, metricInfo } from "../lib/metrics.js";
import { captainSkills, canAddSkill, canRemoveSkill, conditionalItems, buildModifiers, SKILL, MAX_SKILL_POINTS } from "../lib/builder.js";
import { metricTitle, fmtVal, esc } from "../lib/site.js";

const KEY = ["survivability.hit_points", "maneuverability.max_speed_knots", "maneuverability.rudder_shift_time_s", "maneuverability.turning_circle_radius_m",
  "concealment.detectability_by_ships_km", "concealment.detectability_by_planes_km", "main_battery.range_km", "main_battery.reload_s", "main_battery.turret_180_turn_time_s",
  "main_battery.dispersion_at_max_range_horizontal_m", "main_battery.he_damage_per_minute", "main_battery.ap_damage_per_minute", "main_battery.sap_damage_per_minute",
  "main_battery.shells.he.fire_chance_pct", "main_battery.shells.he.penetration_mm", "main_battery.he_potential_fires_per_minute", "secondaries.range_km",
  "torpedoes.reload_s", "torpedoes.torpedoes.primary.range_km", "torpedoes.torpedoes.primary.detectability_km", "anti_air.total_continuous_damage_per_s", "anti_air.max_range_km"];

const json = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.json(); });

export async function mountBuildTool(root) {
  const base = root.dataset.base ?? "";
  const index = root.dataset.ship || new URLSearchParams(location.search).get("ship");
  if (!index) { root.innerHTML = `<p>Choose a ship first: open any ship page and use “Customize this ship”.</p>`; return; }
  root.innerHTML = `<p class="note">Loading the build tool…</p>`;
  const [common, data] = await Promise.all([json(`${base}/api/build/common.json`), json(`${base}/api/build/ships/${index}.json`)]);
  const nationCaptains = await json(`${base}/api/build/captains/${data.nation}.json`).catch(() => ({ captains: [] }));
  setConsumableTitles(common.consumable_titles);
  const L = { ...common.L, ...data.L };
  const ctx = { projectiles: data.projectiles, aircraft: data.aircraft, abilities: data.abilities, L, name: (k) => (k ? L[String(k).toUpperCase()] ?? null : null) };
  const ship = data.ship, cls = ship.shipClass;
  const groups = upgradeGroups(ship);
  const captains = [common.default_captain, ...nationCaptains.captains.map((c) => {
    const skills = { ...common.default_captain.skills, ...c.skills_override };
    for (const k of c.skills_missing ?? []) delete skills[k];
    return { ...c, skills };
  })];
  const consumableSlots = {};
  for (const c of ship.shipConsumable ?? []) (consumableSlots[c.slot] ??= []).push({ key: `${c.consumableName} ${c.consumableVariantName}`, name: c.consumableName });
  const consumableLabel = (o) => { const a = data.abilities[o.key]; return (a && common.consumable_titles[a.index]) || o.name; };
  const special = ship.specialAbility?.modifiers?.some((m) => (m.affectedProperties ?? []).length) ? ship.specialAbility : null;

  // ---------- state (also stored in the URL, so builds can be shared) ----------
  const blank = () => ({ modules: Object.fromEntries(Object.entries(groups).map(([t, l]) => [t, l[l.length - 1].name])), upgrades: {}, captain: captains[0].index, skills: [], cond: {}, ar: 100, talents: {}, signals: [], cons: {}, special: false });
  let state = blank();
  try { const h = new URLSearchParams(location.hash.slice(1)).get("build"); if (h) state = { ...state, ...JSON.parse(decodeURIComponent(escape(atob(h)))) }; } catch { /* ignore a broken link */ }
  const save = () => { const s = btoa(unescape(encodeURIComponent(JSON.stringify(state)))); history.replaceState(null, "", `${location.pathname}${location.search}#build=${s}`); };

  const captain = () => captains.find((c) => c.index === state.captain) ?? captains[0];
  const skillList = () => captainSkills(captain(), cls, L);
  const chosenSkills = () => { const all = skillList(); return state.skills.map((k) => all.find((s) => s.key === k)).filter(Boolean); };
  const cfgOf = (st) => Object.fromEntries(Object.entries(groups).map(([t, l]) => [t, l.find((u) => u.name === st.modules[t]) ?? l[l.length - 1]]));
  const upgradeObjs = (st) => data.upgrades.map((sl) => sl.options.find((o) => o.index === st.upgrades[sl.slot])).filter(Boolean);
  function modsOf(st) {
    const cap = captains.find((c) => c.index === st.captain) ?? captains[0];
    const all = captainSkills(cap, cls, L);
    const skills = st.skills.map((k) => all.find((s) => s.key === k)).filter(Boolean);
    const mods = buildModifiers({
      upgrades: upgradeObjs(st), signals: common.signals.filter((f) => st.signals.includes(f.index)),
      skills, cls, conditional: st.cond, arHpPct: st.ar, talents: cap.talents ?? [], talentState: st.talents,
      consumables: Object.values(st.cons).filter(Boolean).map((k) => ({ ability: data.abilities[k], name: k.split(" ")[0] })),
    });
    if (st.special && special) mods.push(...special.modifiers);
    return mods;
  }
  const calc = (st, accel = true) => flatten(computeConfiguration(ctx, ship, cfgOf(st), modsOf(st), { tables: false, accel }));

  // ---------- rendering ----------
  root.innerHTML = `<div class="bt">
    <div class="bt-controls">
      <div class="bt-bar"><button type="button" class="btn" data-act="reset">Reset</button> <button type="button" class="btn" data-act="share">Copy link to this build</button> <span class="note" data-out="msg" role="status"></span></div>
      <details open><summary>Modules</summary><div data-out="modules"></div></details>
      <details open><summary>Upgrades</summary><div data-out="upgrades"></div></details>
      <details open><summary>Commander and skills <span class="note" data-out="points"></span></summary><div data-out="captain"></div><div data-out="skills"></div></details>
      <details open><summary>Conditional buffs (switch on what is active in battle)</summary><div data-out="buffs"></div></details>
      <details><summary>Signal flags <span class="note" data-out="sigcount"></span></summary><div data-out="signals"></div></details>
      <details><summary>Optimizer: find the best build for one stat</summary><div data-out="opt"></div></details>
    </div>
    <div class="bt-results" aria-live="polite"><div data-out="results"></div></div>
  </div>`;
  const $ = (n) => root.querySelector(`[data-out="${n}"]`);
  const sel = (name, opts, value, label) => `<label class="bt-field"><span>${esc(label)}</span><select data-k="${esc(name)}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;

  function renderControls() {
    $("modules").innerHTML = Object.entries(groups).length ? Object.entries(groups).map(([t, l]) => sel(`mod:${t}`, l.map((u) => [u.name, `${L[u.name.toUpperCase()] ?? moduleName(t, u)}`]), state.modules[t], prettyType(t))).join("") : `<p class="note">This ship has no researchable modules.</p>`;
    $("upgrades").innerHTML = data.upgrades.map((sl) => sel(`up:${sl.slot}`, [["", "— none —"], ...sl.options.map((o) => [o.index, o.name])], state.upgrades[sl.slot] ?? "", `Slot ${sl.slot + 1}`)).join("") || `<p class="note">No upgrade slots.</p>`;
    $("captain").innerHTML = sel("captain", captains.map((c) => [c.index, c.name + (c.talents?.length ? " (talents)" : "")]), state.captain, "Commander");
    const all = skillList(), chosen = chosenSkills();
    const points = chosen.reduce((n, s) => n + s.cost, 0);
    $("points").textContent = `${points}/${MAX_SKILL_POINTS} points`;
    const rows = [0, 1, 2, 3].map((t) => `<div class="bt-skillrow"><span class="bt-cost">${t + 1} pt</span>${all.filter((s) => s.tier === t).map((s) => {
      const on = state.skills.includes(s.key);
      const ok = on ? canRemoveSkill(chosen, s) : canAddSkill(chosen, s);
      return `<button type="button" class="bt-skill${on ? " on" : ""}" data-skill="${esc(s.key)}" aria-pressed="${on}" ${ok ? "" : "disabled"} title="${esc(s.description ?? "")}">${esc(s.name)}</button>`;
    }).join("")}</div>`).join("");
    $("skills").innerHTML = rows + `<p class="note">Rules as in game: 21 points; a skill needs at least one skill from the row above. Hover a skill for its description.</p>`;
    renderBuffs(chosen);
    $("signals").innerHTML = `<div class="bt-checks">${common.signals.map((f) => `<label title="${esc(f.description ?? "")}"><input type="checkbox" data-sig="${esc(f.index)}"${state.signals.includes(f.index) ? " checked" : ""}> ${esc(f.name)}</label>`).join("")}</div>`;
    $("sigcount").textContent = state.signals.length ? `${state.signals.length} selected` : "";
  }
  function renderBuffs(chosen) {
    const parts = [];
    const ar = chosen.find((s) => s.number === SKILL.AR || s.number === SKILL.AR_SUB);
    if (ar) parts.push(`<label class="bt-field"><span>${esc(ar.name)}: HP left <output data-out="arv">${state.ar}%</output></span><input type="range" min="0" max="100" step="1" value="${state.ar}" data-k="ar"></label>`);
    for (const it of conditionalItems(chosen)) {
      const st = state.cond[it.id] ?? { on: false, count: 1 };
      const what = it.number === SKILL.FURIOUS ? "fires on your ship" : it.number === SKILL.IRPR ? "uses" : null;
      parts.push(`<div class="bt-buff"><label><input type="checkbox" data-cond="${esc(it.id)}"${st.on ? " checked" : ""}> ${esc(it.name)}${it.number === SKILL.MSBA ? " (priority target)" : ""}</label>${it.max_activations > 1 ? ` <label class="bt-count">${what ?? "activations"} <input type="number" min="1" max="${it.max_activations}" value="${st.count ?? 1}" data-condn="${esc(it.id)}"></label>` : ""}</div>`);
    }
    for (const t of captain().talents ?? []) {
      const st = state.talents[t.id] ?? { on: false, count: 1 };
      parts.push(`<div class="bt-buff"><label title="${esc(t.description ?? "")}"><input type="checkbox" data-tal="${esc(t.id)}"${st.on ? " checked" : ""}> Talent: ${esc(t.name)}</label>${t.max_activations > 1 ? ` <label class="bt-count">${t.tiers.length ? "level" : "activations"} <input type="number" min="1" max="${t.max_activations}" value="${st.count ?? 1}" data-taln="${esc(t.id)}"></label>` : ""}</div>`);
    }
    for (const [slot, opts] of Object.entries(consumableSlots)) {
      const on = state.cons[slot];
      parts.push(`<div class="bt-buff">${sel(`cons:${slot}`, [["", "— not active —"], ...opts.map((o) => [o.key, consumableLabel(o)])], on ?? "", `Consumable slot ${Number(slot) + 1} active`)}</div>`);
    }
    if (special) parts.push(`<div class="bt-buff"><label><input type="checkbox" data-k="special"${state.special ? " checked" : ""}> Special ability active: ${esc(L[`DOCK_RAGE_MODE_TITLE_${special.name}`.toUpperCase()] ?? special.name)}</label></div>`);
    $("buffs").innerHTML = parts.join("") || `<p class="note">No conditional buffs: add skills like Adrenaline Rush, or pick a commander with talents.</p>`;
  }

  let baseFlat = null, baseKey = "";
  function renderResults() {
    const bk = JSON.stringify(state.modules);
    if (bk !== baseKey) { baseFlat = calc({ ...blank(), modules: state.modules }); baseKey = bk; }
    let now;
    try { now = calc(state); } catch (e) { $("results").innerHTML = `<p class="error">Could not calculate this build: ${esc(e.message)}</p>`; return; }
    const row = (k) => {
      const a = baseFlat[k], b = now[k];
      if (a === undefined && b === undefined) return "";
      const d = metricInfo(k).direction, changed = typeof a === "number" && typeof b === "number" && Math.abs(a - b) > 1e-9;
      const good = changed && ((d === "higher_is_better" && b > a) || (d === "lower_is_better" && b < a)), bad = changed && !good && d !== "neutral";
      return `<tr${changed ? ` class="${good ? "up" : bad ? "down" : "chg"}"` : ""}><th scope="row" title="${esc(k)}">${esc(metricTitle(k))}</th><td>${fmtVal(k, a)}</td><td>${fmtVal(k, b)}</td></tr>`;
    };
    const changed = Object.keys({ ...baseFlat, ...now }).filter((k) => typeof now[k] === "number" && typeof baseFlat[k] === "number" ? Math.abs(now[k] - baseFlat[k]) > 1e-9 : now[k] !== baseFlat[k]).sort();
    const head = `<thead><tr><th scope="col">Stat</th><th scope="col">Base</th><th scope="col">This build</th></tr></thead>`;
    $("results").innerHTML = `<h3>Key stats</h3><div class="scroll"><table class="grid compact bt-table">${head}<tbody>${KEY.map(row).join("")}</tbody></table></div>
      <h3>Everything this build changes (${changed.length})</h3>${changed.length ? `<div class="scroll"><table class="grid compact bt-table">${head}<tbody>${changed.map(row).join("")}</tbody></table></div>` : `<p class="note">Nothing yet: pick upgrades, skills, signals or buffs on the left.</p>`}
      <details><summary>All ${Object.keys(now).length} stats of this build</summary><div class="scroll"><table class="grid compact bt-table">${head}<tbody>${Object.keys(now).sort().map(row).join("")}</tbody></table></div></details>
      <p class="note">Green = better, red = worse. “Base” = the same modules with nothing else. Calculated in your browser with the same formulas as the rest of the site (ported from WoWs ShipBuilder). Camouflage is not included.</p>`;
  }
  const update = () => { save(); renderControls(); renderResults(); };

  // ---------- events ----------
  root.addEventListener("change", (e) => {
    const t = e.target, k = t.dataset.k;
    if (k?.startsWith("mod:")) state.modules[k.slice(4)] = t.value;
    else if (k?.startsWith("up:")) { if (t.value) state.upgrades[k.slice(3)] = t.value; else delete state.upgrades[k.slice(3)]; }
    else if (k?.startsWith("cons:")) { if (t.value) state.cons[k.slice(5)] = t.value; else delete state.cons[k.slice(5)]; }
    else if (k === "captain") { state.captain = t.value; const keys = new Set(skillList().map((s) => s.key)); state.skills = state.skills.filter((s) => keys.has(s)); state.talents = {}; }
    else if (k === "special") state.special = t.checked;
    else if (k === "ar") state.ar = Number(t.value);
    else if (t.dataset.sig) state.signals = t.checked ? [...state.signals, t.dataset.sig] : state.signals.filter((x) => x !== t.dataset.sig);
    else if (t.dataset.cond) state.cond[t.dataset.cond] = { ...(state.cond[t.dataset.cond] ?? { count: 1 }), on: t.checked };
    else if (t.dataset.condn) state.cond[t.dataset.condn] = { ...(state.cond[t.dataset.condn] ?? { on: true }), count: clampInt(t.value, 1, Number(t.max)) };
    else if (t.dataset.tal) state.talents[t.dataset.tal] = { ...(state.talents[t.dataset.tal] ?? { count: 1 }), on: t.checked };
    else if (t.dataset.taln) state.talents[t.dataset.taln] = { ...(state.talents[t.dataset.taln] ?? { on: true }), count: clampInt(t.value, 1, Number(t.max)) };
    else return;
    update();
  });
  root.addEventListener("input", (e) => { if (e.target.dataset.k === "ar") { state.ar = Number(e.target.value); const o = $("arv"); if (o) o.textContent = `${state.ar}%`; save(); renderResults(); } });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.skill) {
      const k = b.dataset.skill;
      state.skills = state.skills.includes(k) ? state.skills.filter((x) => x !== k) : [...state.skills, k];
      const keys = new Set(chosenSkills().flatMap((s) => conditionalItems([s]).map((i) => i.id)));
      for (const id of Object.keys(state.cond)) if (!keys.has(id)) delete state.cond[id];
      update();
    } else if (b.dataset.act === "reset") { state = blank(); update(); }
    else if (b.dataset.act === "share") { save(); navigator.clipboard?.writeText(location.href).then(() => { $("msg").textContent = "Link copied."; }, () => { $("msg").textContent = "Copy the address bar to share this build."; }); }
    else if (b.dataset.act === "optimize") runOptimizer();
    else if (b.dataset.act === "apply-opt" && lastOpt) { state = { ...state, ...lastOpt }; update(); }
  });

  // ---------- optimizer ----------
  let lastOpt = null;
  const metricKeys = Object.keys(calc(blank(), false)).filter((k) => typeof calc(blank(), false)[k] === "number").sort();
  $("opt").innerHTML = `<label class="bt-field"><span>Stat to optimize</span><input list="bt-metrics" data-k="optmetric" placeholder="e.g. main battery reload" autocomplete="off"></label>
    <datalist id="bt-metrics">${metricKeys.map((k) => `<option value="${esc(metricTitle(k))}" data-key="${esc(k)}"></option>`).join("")}</datalist>
    <label class="bt-field"><span>Goal</span><select data-k="optdir"><option value="auto">Better (as the site defines it)</option><option value="max">As high as possible</option><option value="min">As low as possible</option></select></label>
    <fieldset class="bt-checks"><legend>Optimize</legend><label><input type="checkbox" data-opt="upgrades" checked> Upgrades (all combinations tried)</label><label><input type="checkbox" data-opt="skills" checked> Commander skills (step-by-step search within 21 points)</label><label><input type="checkbox" data-opt="signals" checked> Signal flags</label></fieldset>
    <button type="button" class="btn" data-act="optimize">Find best build</button><div data-out="optres" role="status"></div>`;
  async function runOptimizer() {
    const out = $("optres");
    const title = root.querySelector('[data-k="optmetric"]').value.trim();
    const metric = metricKeys.find((k) => metricTitle(k) === title || k === title);
    if (!metric) { out.innerHTML = `<p class="error">Pick a stat from the list.</p>`; return; }
    const dir = root.querySelector('[data-k="optdir"]').value;
    const d = dir === "max" ? 1 : dir === "min" ? -1 : metricInfo(metric).direction === "lower_is_better" ? -1 : metricInfo(metric).direction === "higher_is_better" ? 1 : 0;
    if (!d) { out.innerHTML = `<p class="error">For this stat neither direction is clearly better. Choose “as high” or “as low as possible”.</p>`; return; }
    const use = Object.fromEntries([...root.querySelectorAll("[data-opt]")].map((i) => [i.dataset.opt, i.checked]));
    const accel = /time_to_full_speed/.test(metric);
    const value = (st) => calc(st, accel)[metric];
    const better = (a, b) => typeof a === "number" && (typeof b !== "number" || d * (a - b) > 1e-9);
    out.innerHTML = `<p class="note">Searching…</p>`;
    await new Promise((r) => setTimeout(r, 20));
    let st = { ...state, cond: {}, talents: {}, cons: {}, special: false, ar: 100, upgrades: use.upgrades ? {} : state.upgrades, skills: use.skills ? [] : state.skills, signals: use.signals ? [] : state.signals };
    const start = value(st);
    let tried = 0;
    if (use.upgrades) {
      const slots = data.upgrades.map((sl) => [null, ...sl.options.map((o) => o.index)]);
      const total = slots.reduce((n, s) => n * s.length, 1);
      if (total <= 20000) {
        let best = { ...st.upgrades }, bestV = value(st);
        const combo = new Array(slots.length).fill(0);
        for (let n = 0; n < total; n++) {
          let x = n; for (let i = 0; i < slots.length; i++) { combo[i] = x % slots[i].length; x = Math.floor(x / slots[i].length); }
          const ups = {}; combo.forEach((c, i) => { if (slots[i][c]) ups[data.upgrades[i].slot] = slots[i][c]; });
          const v = value({ ...st, upgrades: ups }); tried++;
          if (better(v, bestV)) { bestV = v; best = ups; }
          if (n % 400 === 399) await new Promise((r) => setTimeout(r));
        }
        st.upgrades = best;
      }
    }
    if (use.skills) {
      const all = skillList().filter((s) => ![SKILL.AR, SKILL.AR_SUB, SKILL.FURIOUS, SKILL.IRPR].includes(s.number));
      for (;;) {
        const chosen = st.skills.map((k) => all.find((s) => s.key === k)).filter(Boolean);
        const cur = value(st);
        let pick = null, pickScore = 0;
        for (const s of all) {
          if (st.skills.includes(s.key) || !canAddSkill(chosen, s)) continue;
          const v = value({ ...st, skills: [...st.skills, s.key] }); tried++;
          if (better(v, cur)) { const score = Math.abs(v - cur) / s.cost; if (score > pickScore) { pick = s; pickScore = score; } }
        }
        if (!pick) {
          // A skill in a locked row would help: unlock its row by adding a skill to the lowest row that has none yet.
          const pts = chosen.reduce((n, s) => n + s.cost, 0);
          const target = all.filter((s) => !st.skills.includes(s.key) && !canAddSkill(chosen, s) && better(value({ ...st, skills: [...st.skills, s.key] }), cur)).sort((x, y) => x.tier - y.tier)[0];
          if (!target) break;
          const missingRows = [...Array(target.tier).keys()].filter((r) => !chosen.some((c) => c.tier === r));
          const need = missingRows.reduce((n, r) => n + r + 1, 0) + target.cost;
          if (!missingRows.length || pts + need > MAX_SKILL_POINTS) break;
          const filler = all.find((s) => !st.skills.includes(s.key) && s.tier === missingRows[0] && canAddSkill(chosen, s) && !better(cur, value({ ...st, skills: [...st.skills, s.key] })));
          if (!filler) break;
          st.skills = [...st.skills, filler.key]; continue;
        }
        st.skills = [...st.skills, pick.key];
      }
    }
    if (use.signals) for (const f of common.signals) { const v = value({ ...st, signals: [...st.signals, f.index] }); tried++; if (better(v, value(st))) st.signals = [...st.signals, f.index]; }
    const end = value(st);
    lastOpt = { upgrades: st.upgrades, skills: st.skills, signals: st.signals };
    const names = [
      ...upgradeObjs(st).map((u) => `Upgrade: ${u.name}`),
      ...st.skills.map((k) => `Skill: ${skillList().find((s) => s.key === k)?.name ?? k}`),
      ...common.signals.filter((f) => st.signals.includes(f.index)).map((f) => `Signal: ${f.name}`),
    ];
    out.innerHTML = `<p><strong>${esc(metricTitle(metric))}</strong>: ${fmtVal(metric, start)} → <strong>${fmtVal(metric, end)}</strong> <span class="note">(${tried} builds calculated)</span></p>
      ${names.length ? `<ul>${names.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><button type="button" class="btn" data-act="apply-opt">Use this build</button>` : `<p class="note">Nothing in the game improves this stat for this ship.</p>`}
      <p class="note">Only items that change this stat are chosen; the rest of a real build is up to you. Upgrades: every combination is tried, so the result is the true best. Skills: chosen step by step (best gain per point), which finds the best set in almost every case. Conditional buffs and consumables are not used.</p>`;
  }

  update();
}

const clampInt = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
const prettyType = (t) => ({ Artillery: "Main battery", Hull: "Hull", Engine: "Engine", Suo: "Gun fire control", Torpedoes: "Torpedoes", FlightControl: "Flight control", Fighter: "Fighters", DiveBomber: "Dive bombers", TorpedoBomber: "Torpedo bombers", SkipBomber: "Skip bombers", Sonar: "Sonar", Secondary: "Secondary battery" })[t] ?? t;
const moduleName = (t, u) => `${prettyType(t)} ${u.name.replace(/^P\w{3}\d+_/, "").replace(/_/g, " ")}`;

const el = document.getElementById("build-tool");
if (el) {
  if (el.dataset.lazy) {
    const btn = document.getElementById("build-open");
    btn?.addEventListener("click", () => { btn.remove(); mountBuildTool(el).catch((e) => { el.innerHTML = `<p class="error">The build tool could not load: ${esc(e.message)}</p>`; }); });
    if (location.hash.startsWith("#build=")) btn?.click();
  } else mountBuildTool(el).catch((e) => { el.innerHTML = `<p class="error">The build tool could not load: ${esc(e.message)}</p>`; });
}
