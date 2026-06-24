// Fake ESP32 master: posts a live telemetry reading every few seconds and
// acks any pending commands, so you can watch the dashboard update in
// real-time without hardware.  Run:  node src/simulator.js
const BASE = process.env.BASE || 'http://localhost:4000';
const KEY = process.env.DEVICE_API_KEY || 'changeme-esp32-secret';
const headers = { 'Content-Type': 'application/json', 'x-api-key': KEY };

let t = 0;
const jitter = (base, amp) => base + amp * Math.sin(t / 6) + (Math.random() - 0.5) * amp * 0.4;

async function tick() {
  t++;
  const reading = {
    temperature: Number(jitter(31, 3).toFixed(1)),
    humidity: Number(jitter(75, 8).toFixed(0)),
    ph: Number(jitter(6.4, 0.4).toFixed(2)),
    ec: Number(jitter(1.8, 0.3).toFixed(2)),
    lora_rssi: -72 + Math.round((Math.random() - 0.5) * 8),
    slave_online: true,
  };
  try {
    await fetch(`${BASE}/api/telemetry`, {
      method: 'POST',
      headers,
      body: JSON.stringify(reading),
    });

    // Pick up + ack any pending commands (pretend the slave executed them)
    const pending = await (
      await fetch(`${BASE}/api/commands/pending`, { headers })
    ).json();
    for (const cmd of pending) {
      await fetch(`${BASE}/api/commands/${cmd.id}/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ success: true }),
      });
      console.log(`acked command #${cmd.id}: ${cmd.device_id} -> ${cmd.action}`);
    }
    console.log('posted', reading);
  } catch (e) {
    console.error('simulator error:', e.message);
  }
}

console.log(`Simulator posting to ${BASE} every 5s. Ctrl+C to stop.`);
tick();
setInterval(tick, 5000);
