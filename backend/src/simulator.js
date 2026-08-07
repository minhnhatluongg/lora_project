// Fake ESP32 master: posts a full STM32 sweep every few seconds and acks any
// pending commands, so you can watch the dashboard update in real-time without
// hardware.  Run:  node src/simulator.js
const BASE = process.env.BASE || 'http://localhost:4000';
const KEY = process.env.DEVICE_API_KEY || 'changeme-esp32-secret';
const headers = { 'Content-Type': 'application/json', 'x-api-key': KEY };

let t = 0;
const jitter = (base, amp) =>
  base + amp * Math.sin(t / 6) + (Math.random() - 0.5) * amp * 0.4;

// Water level in each tank, as the air gap the ultrasonic sensor measures (cm).
// Drains slowly, refills when it hits the bottom — like a real irrigation tank.
const tanks = [
  { dist: 25, drain: 0.9 },
  { dist: 40, drain: 0.5 },
  { dist: 60, drain: 1.4 },
  { dist: 30, drain: 0.7 },
];

// What the relay board currently reads back — 5 pumps + 4 valves. Acks flip
// these, then we mirror them to /api/devices/state like the real master does.
const deviceStates = {
  pump1: 'OFF', pump2: 'OFF', pump3: 'OFF', pump4: 'OFF', pump5: 'OFF',
  van1: 'OFF', van2: 'OFF', van3: 'OFF', van4: 'OFF',
};

// Rain board: dry, with a shower every ~40 ticks so the HMI's rain card moves.
const rainPct = () => {
  const phase = t % 40;
  return phase < 8 ? Math.round(25 + 50 * Math.sin((phase / 8) * Math.PI)) : 0;
};

function stepTanks() {
  return tanks.map((tank, i) => {
    tank.dist += tank.drain;
    if (tank.dist > 95) tank.dist = 18; // refilled
    // Sensor 4 occasionally times out, like the firmware's -1 case.
    if (i === 3 && Math.random() < 0.08) return null;
    return Number(tank.dist.toFixed(1));
  });
}

async function tick() {
  t++;
  const [dist1, dist2, dist3, dist4] = stepTanks();
  const reading = {
    temperature: Number(jitter(31, 3).toFixed(1)),
    humidity: Number(jitter(75, 8).toFixed(1)),
    ph: Number(jitter(6.4, 0.4).toFixed(1)),
    ec: Math.round(jitter(1500, 300)),      // µS/cm, like the RS485 probe
    n: Math.round(jitter(120, 25)),         // mg/kg
    p: Math.round(jitter(60, 12)),
    k: Math.round(jitter(180, 35)),
    air_temp: Number(jitter(29, 4).toFixed(1)),      // °C, air probe
    air_humidity: Number(jitter(68, 12).toFixed(1)), // %RH, air probe
    rain: rainPct(),                                 // 0..100 %
    dist1,
    dist2,
    dist3,
    dist4: dist4 ?? -1,                     // -1 = no echo, as the STM32 reports
    lora_rssi: -72 + Math.round((Math.random() - 0.5) * 8),
    slave_online: true,
    sensor_status: 'OK',
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
      // 'system'/RESTART is what the SETTINGS screen queues; a real master
      // would reboot here. 'mode' is bookkeeping, everything else is a relay.
      if (cmd.device_id === 'system' && cmd.action === 'RESTART') {
        console.log('*** master would reboot now (system RESTART) ***');
      } else if (cmd.device_id in deviceStates) {
        deviceStates[cmd.device_id] = cmd.action;
      }
      await fetch(`${BASE}/api/commands/${cmd.id}/ack`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ success: true }),
      });
      console.log(`acked command #${cmd.id}: ${cmd.device_id} -> ${cmd.action}`);
    }

    // Report the relay board back, exactly like the master does after a sweep.
    await fetch(`${BASE}/api/devices/state`, {
      method: 'POST',
      headers,
      body: JSON.stringify(deviceStates),
    });

    console.log('posted', reading);
  } catch (e) {
    console.error('simulator error:', e.message);
  }
}

console.log(`Simulator posting to ${BASE} every 5s. Ctrl+C to stop.`);
tick();
setInterval(tick, 5000);
