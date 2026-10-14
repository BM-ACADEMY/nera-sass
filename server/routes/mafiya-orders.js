const express = require('express');
const router = express.Router();
const { MafiyaOrders } = require('../models');
const { ilike } = require('../db/mongo');

const NO_ID = { _id: 0 };

// Auto-seed default data
const initTable = async () => {
  try {
    const count = await MafiyaOrders.countDocuments();
    if (count === 0) {
      // Seed default orders matching the screenshot
      for (const order of [
        {
          title: 'Fix Justdial listing — Namma Pondy Properties',
          priority: 'High',
          tag_category: 'Citation mismatch',
          assignee: 'Satish',
          client_name: 'Namma Pondy Properties',
          description: "Name mismatch between Justdial and Google. This tells Google your business info can't be trusted — rank drops.",
          box_type: 'steps',
          box_content: { steps: ['Go to justdial.com/business-owner-login', "Find 'Namma Pondy Realty' listing — Click Edit", 'Change name to: Namma Pondy Properties', 'Save and mark done'] },
          status: 'open',
        },
        {
          title: 'Upload 3 photos to GMB — BM Academy',
          priority: 'Medium',
          tag_category: 'Photo freshness',
          assignee: 'Babila',
          client_name: 'BM Academy',
          description: 'No new photos in 16 days. Google rewards active profiles with higher visibility.',
          box_type: 'photos',
          box_content: { photosNeeded: 'Office interior · Team photo · Class in session', captions: ["BM Academy — Pondicherry's #1 digital marketing training centre", 'Expert faculty with 14+ years of industry experience', 'Hands-on practical training — not just theory, real results'] },
          status: 'open',
        },
        {
          title: 'Add services list to GBP — BM TechX',
          priority: 'Low',
          tag_category: 'Profile completeness',
          assignee: 'Satish',
          client_name: 'BM TechX',
          description: 'GBP services list is empty. Competitors have 8-12 services. Missing = missing keyword matches.',
          box_type: 'services',
          box_content: { servicesText: 'Services to add (copy-paste into GBP → Edit → Services):', servicesList: ['Social Media Marketing', 'Google Ads Management', 'SEO Services', 'Website Design & Development', 'Branding & Logo Design', 'Google Business Profile Management', 'Meta Ads', 'Content Creation'] },
          status: 'open',
        },
      ]) {
        await MafiyaOrders.create(order);
      }
      console.log('✅ mafiya_orders collection seeded with initial orders');
    }
  } catch (err) {
    console.error('Error initializing mafiya_orders collection:', err.message);
  }
};

initTable();

// GET all orders
router.get('/', async (req, res) => {
  try {
    const { status, priority, client } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (client) filter.client_name = ilike(client);

    const rows = await MafiyaOrders.find(filter, NO_ID).sort({ id: 1 }).lean();
    res.json(rows);
  } catch (err) {
    console.error('[Mafiya Orders] GET / error:', err);
    res.status(500).json({ error: 'Server error fetching orders' });
  }
});

// POST new order
router.post('/', async (req, res) => {
  const { title, priority, tag_category, assignee, client_name, description, box_type, box_content } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Order title is required' });
  }

  try {
    const order = await MafiyaOrders.create({
      title,
      priority: priority || 'High',
      tag_category: tag_category || 'General',
      assignee: assignee || 'Satish',
      client_name: client_name || 'General Client',
      description: description || '',
      box_type: box_type || 'steps',
      box_content: box_content || {},
      status: 'open',
    });
    res.status(201).json(order.toObject());
  } catch (err) {
    console.error('[Mafiya Orders] POST / error:', err);
    res.status(500).json({ error: 'Server error creating order' });
  }
});

// PATCH toggle status (open/completed)
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const order = await MafiyaOrders.findOneAndUpdate(
      { id },
      { $set: { status: status || 'completed' } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error('[Mafiya Orders] PATCH /:id/status error:', err);
    res.status(500).json({ error: 'Server error updating order status' });
  }
});

// PATCH update assignee
router.patch('/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { assignee } = req.body;

  try {
    const order = await MafiyaOrders.findOneAndUpdate(
      { id },
      { $set: { assignee } },
      { new: true, projection: NO_ID }
    ).lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(order);
  } catch (err) {
    console.error('[Mafiya Orders] PATCH /:id/assign error:', err);
    res.status(500).json({ error: 'Server error updating assignee' });
  }
});

// DELETE order
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await MafiyaOrders.deleteOne({ id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('[Mafiya Orders] DELETE /:id error:', err);
    res.status(500).json({ error: 'Server error deleting order' });
  }
});

module.exports = router;
