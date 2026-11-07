/**
 * Live updates for the admin panel. server.js registers the Socket.io sender
 * at startup; services call notifyStaff() without depending on server.js.
 * Events go only to the platform staff room, never to customer workspaces.
 */
let sendToStaff = null;
// Sends to the current tenant's room only (server.js passes its scoped io.emit).
let sendToWorkspace = null;

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

function setWorkspaceSender(fn) {
  sendToWorkspace = fn;
}

/** Live update for the customer panel of the workspace in the current context. */
function notifyWorkspace(event, payload = {}) {
  if (!sendToWorkspace) return;
  try {
    sendToWorkspace(event, { ...payload, at: new Date().toISOString() });
  } catch (error) {
    console.error('[realtime] Could not notify workspace:', error.message);
  }
}

module.exports = { setStaffSender, notifyStaff, setWorkspaceSender, notifyWorkspace };
