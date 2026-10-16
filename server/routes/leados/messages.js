/**
 * LeadOS routes: CRM-side message actions.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerMessagesRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  Leads,
  Messages,
  NO_ID,
  auth,
  axios,
  convertToWhatsAppVoiceNote,
  fs,
  io,
  mediaUpload,
  path,
} = ctx;
// ══════════════════════════════════════════════════════════
// MESSAGES ROUTES (CRM-SIDE)
// ══════════════════════════════════════════════════════════

// PUT /api/messages/:id/edit
app.put('/api/messages/:id/edit', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const msgId = req.params.id;
    // Do not attempt to update optimistic UI messages on the backend
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot edit an unsaved message' });
    }
    const edited = await Messages.findOneAndUpdate({ id: msgId }, { $set: { content } }, { new: true, projection: NO_ID }).lean();
    if (edited) {
      io.emit('message_edited', edited);
    }
    res.json({ success: true, message: edited || undefined });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/delete
app.put('/api/messages/:id/delete', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot delete an unsaved message' });
    }
    const deletedMessage = await Messages.findOneAndUpdate({ id: msgId }, { $set: { is_deleted: true } }, { new: true, projection: NO_ID }).lean();
    if (deletedMessage) {
      io.emit('message_deleted', deletedMessage);
    }
    res.json({ success: true, message: deletedMessage || undefined });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/pin
app.put('/api/messages/:id/pin', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { duration, unpin } = req.body; // duration in hours: 24, 168 (7 days), 720 (30 days)

    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot pin an unsaved message' });
    }

    const pinnedUntil = unpin ? null : new Date(Date.now() + (Number(duration) || 24) * 60 * 60 * 1000);
    const pinned = await Messages.findOneAndUpdate({ id: msgId }, { $set: { pinned_until: pinnedUntil } }, { new: true, projection: NO_ID }).lean();
    if (pinned) {
      io.emit('message_edited', pinned); // reuse message_edited or create message_pinned event
    }
    res.json({ success: true, message: pinned || undefined });
  } catch (err) {
    console.error('Pin message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/star
app.put('/api/messages/:id/star', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { is_starred } = req.body;

    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot star an unsaved message' });
    }

    const starred = await Messages.findOneAndUpdate({ id: msgId }, { $set: { is_starred: Boolean(is_starred) } }, { new: true, projection: NO_ID }).lean();
    const rows = starred ? [starred] : [];

    if (rows.length) {
      io.emit('message_edited', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('Star message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/react
// Body: { emoji: "👍", action: "add" | "remove" }
app.put('/api/messages/:id/react', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { emoji, action } = req.body;

    if (!emoji) return res.status(400).json({ error: 'emoji is required' });
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot react to an unsaved message' });
    }

    // Get current message details, lead, and client credentials
    const reactMessage = await Messages.findOne({ id: msgId }, { reactions: 1, wa_msg_id: 1, conversation_id: 1 }).lean();
    const reactConversation = reactMessage ? await Conversations.findOne({ id: reactMessage.conversation_id }, { lead_id: 1 }).lean() : null;
    const reactLead = reactConversation?.lead_id != null ? await Leads.findOne({ id: reactConversation.lead_id }, { phone: 1, client_id: 1 }).lean() : null;
    if (!reactMessage || !reactLead) return res.status(404).json({ error: 'Message not found' });
    const reactClient = reactLead.client_id != null ? await Clients.findOne({ id: reactLead.client_id }, { phone_number_id: 1, wa_access_token: 1 }).lean() : null;
    const msgData = {
      reactions: reactMessage.reactions, wa_msg_id: reactMessage.wa_msg_id, phone: reactLead.phone,
      phone_number_id: reactClient?.phone_number_id ?? null, wa_access_token: reactClient?.wa_access_token ?? null,
    };

    const reactions = msgData.reactions || {};
    if (action === 'remove') {
      if (reactions[emoji] && reactions[emoji] > 1) {
        reactions[emoji] = reactions[emoji] - 1;
      } else {
        delete reactions[emoji];
      }
    } else {
      reactions[emoji] = (reactions[emoji] || 0) + 1;
    }

    const reacted = await Messages.findOneAndUpdate({ id: msgId }, { $set: { reactions } }, { new: true, projection: NO_ID }).lean();
    const rows = reacted ? [reacted] : [];

    // Send the reaction to Meta API if we have a WhatsApp message ID (wa_msg_id)
    if (msgData.wa_msg_id) {
      const phoneNumberId = msgData.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
      const waAccessToken = msgData.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

      if (phoneNumberId && waAccessToken) {
        try {
          const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: (msgData.phone || '').replace(/\D/g, ''),
            type: 'reaction',
            reaction: {
              message_id: msgData.wa_msg_id,
              emoji: action === 'remove' ? '' : emoji
            }
          };

          await axios.post(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            payload,
            { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
          );
          console.log(`✅ Reaction sent to WhatsApp for message ID: ${msgData.wa_msg_id}`);
        } catch (waErr) {
          console.error('❌ Meta Reaction Send Error:', waErr.response?.data || waErr.message);
        }
      }
    }

    if (rows.length) {
      io.emit('message_edited', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('React message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages/upload', auth, mediaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let uploadedFile = req.file;

  // MediaRecorder in Chrome produces audio/webm (or sometimes video/webm), which WhatsApp Cloud API does
  // not accept. Convert browser-recorded voice notes to mono OGG/Opus before
  // exposing the URL that Meta downloads.
  const isWebm = req.file.mimetype?.toLowerCase().includes('webm') || req.file.originalname.toLowerCase().endsWith('.webm');
  if (isWebm) {
    const outputFilename = `${path.parse(req.file.filename).name}.ogg`;
    const outputPath = path.join(req.file.destination, outputFilename);

    try {
      await convertToWhatsAppVoiceNote(req.file.path, outputPath);

      await fs.promises.unlink(req.file.path).catch(() => {});
      uploadedFile = { ...req.file, filename: outputFilename, path: outputPath, mimetype: 'audio/ogg; codecs=opus' };
    } catch (err) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
      console.error('[Media Upload] Voice-note conversion failed:', err.message);
      return res.status(500).json({ error: 'Unable to prepare this voice note for WhatsApp. Please try recording it again.' });
    }
  }

  const fileUrl = `/uploads/media/${uploadedFile.filename}`;
  res.json({ success: true, fileUrl, mimeType: uploadedFile.mimetype });
});
};
