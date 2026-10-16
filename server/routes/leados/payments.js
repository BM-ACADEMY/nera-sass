/**
 * LeadOS routes: Payment links.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerPaymentsRoutes(app, ctx) {
const {
  Leads,
  NO_ID,
  Payments,
  auth,
  axios,
} = ctx;
// ══════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════
app.post('/api/payments/create-link', auth, async (req, res) => {
  try {
    const { lead_id, amount, description } = req.body;
    const lead = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const rzpRes = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: amount * 100,
        currency: 'INR',
        description,
        customer: { name: lead.name, contact: lead.phone },
        notes: { lead_id: lead_id.toString() },
        callback_url: `${process.env.PORTAL_URL}/payment-success`,
        callback_method: 'get',
      },
      {
        auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_SECRET }
      }
    );

    await Payments.create({ lead_id, amount, status: 'pending', razorpay_link_id: rzpRes.data.id, payment_link: rzpRes.data.short_url, created_at: new Date() });

    res.json({ payment_link: rzpRes.data.short_url, link_id: rzpRes.data.id });
  } catch (err) {
    console.error('Payment link error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

app.get('/api/payments', auth, async (req, res) => {
  try {
    const { lead_id } = req.query;
    const paymentRows = await Payments.find(lead_id ? { lead_id } : {}, NO_ID).sort({ created_at: -1 }).lean();
    const paymentLeads = new Map((await Leads.find({ id: { $in: paymentRows.map((p) => p.lead_id) } }, { id: 1, name: 1 }).lean()).map((l) => [l.id, l.name]));
    const rows = paymentRows.filter((p) => paymentLeads.has(p.lead_id)).map((p) => ({ ...p, lead_name: paymentLeads.get(p.lead_id) }));
    res.json({ payments: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
};
