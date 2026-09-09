// Fix WF00 to handle voice messages
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../../leados-workflows-final/updated-workflow/WF00_-_Lead_Integrator.json');

let content = fs.readFileSync(filePath, 'utf8');

// Find and replace the whatsapp case
const oldCode = `case 'whatsapp': {
    const msgObj = item.payload?.message || waChange?.messages?.[0]?.text?.body || waChange?.messages?.[0]?.button?.text || '';
    let phoneObj = item.payload?.phone || waChange?.messages?.[0]?.from || waChange?.contacts?.[0]?.wa_id || item.phone || '';
    // NORMALIZE: strip all non-digit characters from phone for consistent deduplication
    const phoneDigits = phoneObj.replace(/\\D/g, '');
    const nameObj = item.payload?.name || waChange?.contacts?.[0]?.profile?.name || phoneObj;
    const phoneNumberIdObj = item.payload?.phone_number_id || waChange?.metadata?.phone_number_id || '';
    if (!phoneObj) throw new Error('MISSING_PHONE');
    lead = { name: nameObj, phone: phoneDigits, email: item.payload?.email || item.email || '', message: typeof msgObj === 'object' ? JSON.stringify(msgObj) : (msgObj || ''), source: 'whatsapp', phone_number_id: phoneNumberIdObj, lead_id: item.lead_id || item.payload?.lead_id };
    break;
  }`;

const newCode = `case 'whatsapp': {
    // Handle different WhatsApp message types: text, audio, image, video, document
    const msg = waChange?.messages?.[0];
    let msgObj = '';
    let msgType = 'text';

    if (msg?.text?.body) {
      msgObj = msg.text.body;
      msgType = 'text';
    } else if (msg?.audio) {
      msgObj = '[VOICE_MESSAGE]';
      msgType = 'audio';
    } else if (msg?.image) {
      msgObj = '[IMAGE_MESSAGE]';
      msgType = 'image';
    } else if (msg?.video) {
      msgObj = '[VIDEO_MESSAGE]';
      msgType = 'video';
    } else if (msg?.document) {
      msgObj = '[DOCUMENT_MESSAGE]';
      msgType = 'document';
    } else if (msg?.button?.text) {
      msgObj = msg.button.text;
      msgType = 'button';
    } else {
      msgObj = item.payload?.message || '';
      msgType = 'fallback';
    }

    let phoneObj = item.payload?.phone || msg?.from || waChange?.contacts?.[0]?.wa_id || item.phone || '';
    const phoneDigits = phoneObj.replace(/\\D/g, '');
    const nameObj = item.payload?.name || waChange?.contacts?.[0]?.profile?.name || phoneObj;
    const phoneNumberIdObj = item.payload?.phone_number_id || waChange?.metadata?.phone_number_id || '';
    if (!phoneObj) throw new Error('MISSING_PHONE');

    lead = { name: nameObj, phone: phoneDigits, email: item.payload?.email || item.email || '', message: msgObj, msg_type: msgType, source: 'whatsapp', phone_number_id: phoneNumberIdObj, lead_id: item.lead_id || item.payload?.lead_id };
    break;
  }`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, content);
  console.log('✅ WF00 updated to handle voice messages!');
} else {
  console.log('Code pattern not found - may already updated or different format');
  console.log('Searching for whatsapp case...');
  if (content.includes("case 'whatsapp'")) {
    console.log('Found whatsapp case but pattern different');
  }
}
