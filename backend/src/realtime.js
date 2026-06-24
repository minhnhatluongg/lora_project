// Thin wrapper around the Socket.IO instance so routes can emit events
// without importing the whole server.
let io = null;

export function setIO(instance) {
  io = instance;
}

export function emit(event, payload) {
  if (io) io.emit(event, payload);
}

// Event names shared with the frontend
export const EVENTS = {
  TELEMETRY: 'telemetry',          // new sensor reading
  DEVICES: 'devices',              // device state list changed
  STATUS: 'status',                // system status changed
  ALERT: 'alert',                  // new alert created
};
