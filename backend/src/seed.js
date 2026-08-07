// Populate the DB with ~24h of historical telemetry so the dashboard charts
// look alive on first run.  Run once:  npm run seed
import { db } from './db.js';

const POINTS = 144; // one every 10 minutes for 24h
const now = Date.now();

const insert = db.prepare(
  `INSERT INTO telemetry
     (temperature, humidity, ph, ec, n, p, k, dist1, dist2, dist3, dist4, lora_rssi, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const wave = (base, amp, i, period, phase = 0) =>
  base + amp * Math.sin((i / period) * Math.PI * 2 + phase);

// Tanks drain steadily and get topped up; distance grows as water drops.
const tankDistance = (i, drainRate, refillEvery, minCm, maxCm) => {
  const cycle = (i % refillEvery) / refillEvery;
  return Number((minCm + (maxCm - minCm) * cycle * drainRate).toFixed(1));
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

db.prepare(`UPDATE system_status SET sensor_status = 'OK' WHERE id = 1`).run();

// A couple of sample alerts
db.prepare('DELETE FROM alerts').run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','pH 5.4 thấp hơn ngưỡng (5.5)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','Đạm (N) 42 ppm thấp hơn ngưỡng (50)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('danger','Bồn Kali còn 12% — dưới ngưỡng (20%)')`).run();

console.log(`Seeded ${POINTS} telemetry rows (T/H/EC/pH/NPK + 4 bồn) + 3 alerts.`);
process.exit(0);
