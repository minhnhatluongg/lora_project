// Populate the DB with ~24h of historical telemetry so the dashboard charts
// look like the mockup. Run once:  npm run seed
import { db } from './db.js';

const POINTS = 144; // one every 10 minutes for 24h
const now = Date.now();

const insert = db.prepare(
  `INSERT INTO telemetry (temperature, humidity, ph, ec, lora_rssi, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);

const wave = (base, amp, i, period, phase = 0) =>
  base + amp * Math.sin((i / period) * Math.PI * 2 + phase);

const tx = db.transaction(() => {
  db.prepare('DELETE FROM telemetry').run();
  for (let i = 0; i < POINTS; i++) {
    const ts = new Date(now - (POINTS - i) * 10 * 60 * 1000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    insert.run(
      Number(wave(31, 3, i, 36).toFixed(1)),       // temperature ~28-34
      Number(wave(75, 10, i, 30, 1).toFixed(0)),    // humidity ~65-85
      Number(wave(6.4, 0.5, i, 40, 2).toFixed(2)),  // pH ~5.9-6.9
      Number(wave(1.8, 0.3, i, 28, 0.5).toFixed(2)),// EC ~1.5-2.1
      -72 + Math.round(wave(0, 5, i, 20)),          // RSSI ~-77..-67
      ts
    );
  }
});

tx();

// A couple of sample alerts
db.prepare('DELETE FROM alerts').run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','pH thấp hơn ngưỡng (5.50)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('warning','EC cao hơn ngưỡng (2.50 mS/cm)')`).run();
db.prepare(`INSERT INTO alerts (level, message) VALUES ('danger','Mất kết nối LoRa (Slave)')`).run();

console.log(`Seeded ${POINTS} telemetry rows + 3 alerts.`);
process.exit(0);
