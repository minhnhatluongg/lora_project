// Populate the DB with ~24h of historical telemetry so the dashboard charts
// look alive on first run.  Run once:  npm run seed
import { db } from './db.js';

const POINTS = 144; // one every 10 minutes for 24h
const now = Date.now();

const insert = db.prepare(
  `INSERT INTO telemetry
     (temperature, humidity, ph, ec, n, p, k,
      air_temp, air_humidity, rain,
      dist1, dist2, dist3, dist4, lora_rssi, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const wave = (base, amp, i, period, phase = 0) =>
  base + amp * Math.sin((i / period) * Math.PI * 2 + phase);

// Tanks drain steadily and get topped up; distance grows as water drops.
const tankDistance = (i, drainRate, refillEvery, minCm, maxCm) => {
  const cycle = (i % refillEvery) / refillEvery;
  return Number((minCm + (maxCm - minCm) * cycle * drainRate).toFixed(1));
};

// Rain board: dry most of the day with two short showers, so the dashboard has
// something other than a flat 0 to draw.
const rainPct = (i) => {
  if (i >= 38 && i < 46) return Math.round(30 + 45 * Math.sin(((i - 38) / 8) * Math.PI));
  if (i >= 104 && i < 110) return Math.round(20 + 30 * Math.sin(((i - 104) / 6) * Math.PI));
  return 0;
};

const tx = db.transaction(() => {
  db.prepare('DELETE FROM telemetry').run();
  for (let i = 0; i < POINTS; i++) {
    const ts = new Date(now - (POINTS - i) * 10 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    insert.run(
      Number(wave(31, 3, i, 36).toFixed(1)),        // temperature ~28-34 °C
      Number(wave(75, 10, i, 30, 1).toFixed(1)),    // humidity ~65-85 %
      Number(wave(6.4, 0.5, i, 40, 2).toFixed(1)),  // pH ~5.9-6.9
      Math.round(wave(1500, 350, i, 28, 0.5)),      // EC ~1150-1850 µS/cm
      Math.round(wave(120, 30, i, 44)),             // N ~90-150 mg/kg
      Math.round(wave(60, 15, i, 50, 1)),           // P ~45-75 mg/kg
      Math.round(wave(180, 40, i, 38, 2)),          // K ~140-220 mg/kg
      Number(wave(29, 5, i, 144, -1.2).toFixed(1)), // air temp: one day/night swing
      Number(wave(68, 14, i, 144, 1.9).toFixed(1)), // air humidity: inverse of it
      rainPct(i),                                   // rain: two showers in the day
      tankDistance(i, 1.0, 48, 18, 95),             // tank 1: full drain cycle
      tankDistance(i, 0.7, 72, 20, 95),             // tank 2: slower
      tankDistance(i, 0.45, 36, 22, 95),            // tank 3: shallow swing
      i % 60 === 0 ? null : tankDistance(i, 0.8, 96, 25, 95), // tank 4: occasional echo miss
      -72 + Math.round(wave(0, 5, i, 20)),          // RSSI ~-77..-67 dBm
      ts
    );
  }
});

tx();

// A fresh seed is a fresh rig: nothing running, no emergency stop latched.
db.prepare(
  `UPDATE system_status SET sensor_status = 'OK', e_stop = 0 WHERE id = 1`
).run();
db.prepare(
  `UPDATE devices SET state = 0, last_on_at = NULL, last_off_at = NULL`
).run();

// A couple of sample alerts
db.prepare('DELETE FROM alerts').run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','pH 5.4 thấp hơn ngưỡng (5.5)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','Đạm (N) 42 ppm thấp hơn ngưỡng (50)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('danger','Bồn Đạm còn 12% — dưới ngưỡng (20%)')`).run();

const devices = db.prepare(`SELECT COUNT(*) AS n FROM devices`).get().n;
console.log(
  `Seeded ${POINTS} telemetry rows (T/H/EC/pH/NPK + không khí + mưa + 4 bồn), ` +
    `${devices} thiết bị (5 bơm + 4 van) và 3 cảnh báo.`
);
process.exit(0);
