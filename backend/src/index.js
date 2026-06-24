import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from './openapi.js';

import { config } from './config.js';
import './db.js'; // initialize schema
import { setIO } from './realtime.js';
import { telemetryRouter } from './routes/telemetry.js';
import { devicesRouter } from './routes/devices.js';
import { commandsRouter } from './routes/commands.js';
import { alertsRouter } from './routes/alerts.js';
import { statusRouter } from './routes/status.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { configRouter } from './routes/config.js';

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

// 404 + error handlers
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

httpServer.listen(config.port, () => {
  console.log(`\n🌱 LoRa farm backend running on http://localhost:${config.port}`);
  console.log(`   Socket.IO + REST API ready`);
  console.log(`   API docs (Swagger): http://localhost:${config.port}/api/docs`);
  console.log(`   CORS origins: ${config.corsOrigin.join(', ')}`);
  if (!config.deviceApiKey)
    console.warn('   ⚠  DEVICE_API_KEY is empty — write endpoints are UNPROTECTED (dev mode)');
});
