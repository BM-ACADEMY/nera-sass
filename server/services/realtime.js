/**
 * Live updates for the admin panel. server.js registers the Socket.io sender
 * at startup; services call notifyStaff() without depending on server.js.
 * Events go only to the platform staff room, never to customer workspaces.
 */
let sendToStaff = null;

function setStaffSender(fn) {
  sendToStaff = fn;
}

function notifyStaff(event, payload = {}) {
  if (!sendToStaff) return;
  try {
    sendToStaff(event, { ...payload, at: new Date().toISOString() });
  } catch (error) {
    console.error('[realtime] Could not notify staff:', error.message);
  }
}

module.exports = { setStaffSender, notifyStaff };
