// Port of WoWs ShipBuilder's BallisticHelper (MIT, WoWs-Builder-Team).
// Simulates shell flight with air drag and altitude-dependent air density.

const G = 9.8, T0 = 288.15, L = 0.0065, P0 = 101325, R = 8.31447, M = 0.0289644;
const MAX_ANGLES = 600, ANGLE_STEP = 0.00174533, DT = 0.02, TIME_SCALE = 2.61;

// Raw AP penetration in mm (formula reverse engineered by TTaro_).
export function apPenetration(velocity, caliber, mass, krupp) {
  return krupp * Math.pow(mass * velocity ** 2, 0.69) * Math.pow(caliber, -1.07) * 0.0000001;
}

const cache = new Map();

// Returns an array of { range_m, penetration_mm, impact_velocity_m_s, flight_time_s, impact_angle_deg }
// sorted by range, up to 1.5x maxRange (same cut-off as ShipBuilder).
export function trajectoryTable(shell, maxRange) {
  const key = `${shell.id ?? ""}|${shell.name}|${Math.round(maxRange)}`; // projectile id + name: unique per projectile
  if (cache.has(key)) return cache.get(key);
  const isAP = shell.shellType === "AP";
  const pen = (v) => (isAP ? apPenetration(v, shell.caliber, shell.mass, shell.krupp) : shell.penetration);
  const limit = maxRange * 1.5;
  const k = (0.5 * shell.airDrag * (shell.caliber / 2) ** 2 * Math.PI) / shell.mass;
  const table = [{ range_m: 0, penetration_mm: pen(shell.muzzleVelocity), impact_velocity_m_s: shell.muzzleVelocity, flight_time_s: 0, impact_angle_deg: 0, launch_angle_rad: 0 }];
  let lastRange = 0;
  for (let i = 0; i < MAX_ANGLES; i++) {
    const angle = i * ANGLE_STEP;
    let x = 0, y = 0, t = 0;
    let vx = shell.muzzleVelocity * Math.cos(angle), vy = shell.muzzleVelocity * Math.sin(angle);
    while (y >= 0) {
      x += DT * vx;
      y += DT * vy;
      const T = T0 - L * y;
      const p = P0 * Math.pow(T / T0, (G * M) / R / L);
      const rho = (p * M) / R / T;
      const speed = Math.sqrt(vx * vx + vy * vy);
      vx -= DT * k * rho * vx * speed;
      vy = vy - DT * G - DT * k * rho * vy * speed;
      t += DT;
    }
    if (x > limit || x < lastRange) break;
    const v = Math.sqrt(vx * vx + vy * vy);
    table.push({ range_m: x, penetration_mm: pen(v), impact_velocity_m_s: v, flight_time_s: t / TIME_SCALE, impact_angle_deg: (Math.atan2(Math.abs(vy), Math.abs(vx)) * 180) / Math.PI, launch_angle_rad: angle });
    lastRange = x;
  }
  cache.set(key, table);
  return table;
}

// Linear interpolation of the table at a given range (m). null if out of the simulated range.
export function at(table, range) {
  if (!table.length || range > table[table.length - 1].range_m) return null;
  let i = table.findIndex((p) => p.range_m >= range);
  if (i <= 0) return table[0];
  const a = table[i - 1], b = table[i], f = (range - a.range_m) / (b.range_m - a.range_m);
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  return { range_m: range, penetration_mm: lerp("penetration_mm"), impact_velocity_m_s: lerp("impact_velocity_m_s"), flight_time_s: lerp("flight_time_s"), impact_angle_deg: lerp("impact_angle_deg"), launch_angle_rad: lerp("launch_angle_rad") };
}

// The flight path of one shell fired at a given launch angle (same physics as trajectoryTable), for drawing.
// Returns [{ x_m, y_m, t_s }] every `every` steps; t_s is in game seconds (like flight_time_s).
export function trajectoryPath(shell, angle, every = 5) {
  const k = (0.5 * shell.airDrag * (shell.caliber / 2) ** 2 * Math.PI) / shell.mass;
  let x = 0, y = 0, t = 0, n = 0;
  let vx = shell.muzzleVelocity * Math.cos(angle), vy = shell.muzzleVelocity * Math.sin(angle);
  const pts = [{ x_m: 0, y_m: 0, t_s: 0 }];
  while (y >= 0) {
    x += DT * vx;
    y += DT * vy;
    const T = T0 - L * y;
    const p = P0 * Math.pow(T / T0, (G * M) / R / L);
    const rho = (p * M) / R / T;
    const speed = Math.sqrt(vx * vx + vy * vy);
    vx -= DT * k * rho * vx * speed;
    vy = vy - DT * G - DT * k * rho * vy * speed;
    t += DT;
    if (++n % every === 0 || y < 0) pts.push({ x_m: x, y_m: Math.max(y, 0), t_s: t / TIME_SCALE });
  }
  return pts;
}
