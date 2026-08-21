import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapi.js';

import { config } from './config.js';
import './db.js'; // initialize schema
import { setIO, emit, EVENTS } from './realtime.js';
import {
  getStatus,
  sweepCommands,
  pruneOldData,
  createAlert,
} from './services.js';
import { telemetryRouter } from './routes/telemetry.js';
import { devicesRouter } from './routes/devices.js';
import { commandsRouter } from './routes/commands.js';
import { alertsRouter } from './routes/alerts.js';
import { statusRouter } from './routes/status.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { configRouter } from './routes/config.js';
import { systemRouter } from './routes/system.js';
import { tasksRouter } from './routes/tasks.js';

const app = express();
const httpServer = createServer(app);

const io = new SocketServer(httpServer, {
  cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
});
setIO(io);

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[socket] client disconnected: ${socket.id}`);
  });
});

app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

// Simple request log
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Interactive API docs (Swagger UI) + raw spec
app.get('/api/openapi.json', (_req, res) => res.json(openapiSpec));
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'LoRa Smart Farm API',
    swaggerOptions: { persistAuthorization: true },
  })
);

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/config', configRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/status', statusRouter);
app.use('/api/system', systemRouter);
app.use('/api/tasks', tasksRouter);

// 404 + error handlers
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// --- Background heartbeat ---------------------------------------------------
// masterOnline is derived from "how long since the last POST", so nothing
// *happens* when a master dies — without this tick the dashboard would show it
// ONLINE forever. Also runs the queue sweep so a device recovers from a stuck
// command even while no master is polling.
let lastBroadcast = null;

const heartbeat = setInterval(() => {
  try {
    sweepCommands();

    const status = getStatus();
    const signature = JSON.stringify([
      status.masterOnline,
      status.slaveOnline,
      status.mode,
      status.sensorStatus,
    ]);
    if (signature === lastBroadcast) return;

    // Announce the transition once, not on every tick.
    if (lastBroadcast !== null && !status.masterOnline) {
      createAlert('danger', 'Mất kết nối với ESP32 Master (không có dữ liệu mới)');
    }
    lastBroadcast = signature;
    emit(EVENTS.STATUS, status);
  } catch (err) {
    console.error('[heartbeat]', err);
  }
}, 5000);
heartbeat.unref?.();

// Housekeeping once an hour (and once at startup).
pruneOldData();
const pruner = setInterval(() => {
  try {
    pruneOldData();
  } catch (err) {
    console.error('[prune]', err);
  }
}, 60 * 60 * 1000);
pruner.unref?.();

httpServer.listen(config.port, () => {
  console.log(`\n🌱 LoRa farm backend running on http://localhost:${config.port}`);
  console.log(`   Socket.IO + REST API ready`);
  console.log(`   API docs (Swagger): http://localhost:${config.port}/api/docs`);
  console.log(`   CORS origins: ${config.corsOrigin.join(', ')}`);
  if (!config.deviceApiKey)
    console.warn('   ⚠  DEVICE_API_KEY is empty — write endpoints are UNPROTECTED (dev mode)');
});
