// Port of WoWs ShipBuilder's AccelerationCalculator (MIT, WoWs-Builder-Team).
// Returns seconds to go from a stop to full ahead and from a stop to full reverse.

const DT = 0.01, MARGIN = 0.055, MAX_ITER = 20000, TIME_SCALE = 2.61;
const CARACCIOLO = "PISB107";

function pfToPb(shipClass, index) {
  if (index === CARACCIOLO) return 3;
  return { Battleship: 4, Cruiser: 3, Destroyer: 2, Submarine: 2 }[shipClass] ?? 4;
}

// m: { speed, fwdUp, backUp, fwdForsMax, backForsMax, fwdForsPower, backForsPower } multipliers (1 = none)
// boost: { fwdForsMaxOverride, backForsMaxOverride, fwdForsOverride, backForsOverride } (0 = none)
export function accelerationTimes(index, hull, engine, shipClass, m = {}, boost = {}) {
  const run = (target) => simulate(index, hull, engine, shipClass, [0, target], m, boost);
  return { to_full_ahead_s: run(4), to_full_reverse_s: run(-1) };
}

function simulate(index, hull, engine, shipClass, throttles, m, boost) {
  const mul = { speed: 1, fwdUp: 1, backUp: 1, fwdForsMax: 1, backForsMax: 1, fwdForsPower: 1, backForsPower: 1, ...m };
  const baseSpeed = (1 + (engine.speedCoef ?? 0)) * hull.maxSpeed;
  if (!hull.enginePower || !hull.tonnage || !baseSpeed) return null;
  const vMax = baseSpeed * mul.speed;
  const vMin = (baseSpeed / 4 + 4.9) * mul.speed;
  const pf = Math.pow(hull.enginePower / hull.tonnage, 0.42) * mul.speed ** 2;
  const pb = (pf / pfToPb(shipClass, index)) * mul.speed ** 2;
  const tF = (engine.forwardEngineUpTime / TIME_SCALE) * mul.fwdUp;
  const tB = (engine.backwardEngineUpTime / TIME_SCALE) * mul.backUp;
  const forsF = boost.fwdForsOverride ? boost.fwdForsOverride : engine.forwardEngineForsag * mul.fwdForsPower;
  const forsB = boost.backForsOverride ? boost.backForsOverride : engine.backwardEngineForsag * mul.backForsPower;
  const forsFMax = boost.fwdForsMaxOverride ? boost.fwdForsMaxOverride : engine.forwardEngineForsagMaxSpeed * mul.fwdForsMax;
  const forsBMax = boost.backForsMaxOverride ? boost.backForsMaxOverride : engine.backwardEngineForsagMaxSpeed * mul.backForsMax;
  const incF = (DT * pf) / tF, incB = (DT * pb) / tB;

  const speedLimit = (t) => (t >= 0 ? (t / 4) * vMax : -vMin);
  const drag = (v) => (v > 0 ? ((-v * Math.abs(v)) / vMax ** 2) * pf : ((-v * Math.abs(v)) / vMin ** 2) * pb);

  let old = throttles[0];
  let speed = speedLimit(old);
  let power = old >= 0 ? pf * (old / 4) ** 2 : -pb;
  let time = 0, isDown = 0, last = null;
  for (const t of throttles.slice(1)) {
    const lim = speedLimit(t);
    if (t < old && t > 0) isDown = 1; else if (t > old) isDown = 0;
    let go = true, it = 0;
    while (go) {
      let acc = 0;
      if (lim > speed) { power = Math.min(Math.max(power, 0) + incF, pf * Math.pow((t / 4) ** 2, isDown)); acc = 1; }
      else if (lim < speed) { power = Math.max(Math.min(power, 0) - incB, -pb); acc = -1; }
      else power = speed >= 0 ? pf * (t / 4) ** 2 : -pb;
      const d = drag(speed);
      let a = (power + d) * Math.abs(acc);
      if (speed < forsFMax && speed >= 0 && power > 0) a = pf * forsF + d;
      else if (speed > -forsBMax && speed <= 0 && power < 0) a = -pb * forsB + d;
      speed += DT * a;
      if ((lim < speed && acc === 1 && power * speed > 0) || (lim > speed && acc === -1 && power * speed > 0)) { speed = lim; go = false; }
      if (Math.abs(speed - lim) < MARGIN && Math.abs(a) < 0.25) { speed = lim; go = false; }
      time += DT;
      if (++it > MAX_ITER) go = false;
    }
    old = t;
    last = time;
  }
  return last === null ? null : Math.round(last * 100) / 100;
}
