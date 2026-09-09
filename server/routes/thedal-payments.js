const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Pool } = require('pg');
const auth = require('../middleware/auth');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_SECRET,
});

// POST /thedal/payments/create-order
router.post('/create-order', auth, async (req, res) => {
  const { amount, currency, clientData } = req.body;

  try {
    // 1. Generate Razorpay Order
    const options = {
      amount: Math.round(amount * 100), // amount in the smallest currency unit
      currency: currency || 'INR',
      receipt: `rcpt_${Date.now()}`
    };
    
    const order = await razorpay.orders.create(options);

    // 2. Pre-save client as pending
    await pool.query('BEGIN');
    
    const clientRes = await pool.query(
      `INSERT INTO thedal_clients (client_name, phone, email, business_name, domain, business_category, plan, subscription_duration, status, payment_status, razorpay_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        clientData.client_name,
        clientData.phone,
        clientData.email,
        clientData.business_name,
        clientData.domain,
        clientData.business_category,
        clientData.plan,
        clientData.subscription_duration,
        'active', // general status
        'pending', // payment status
        order.id
      ]
    );

    await pool.query('COMMIT');

    res.json({
      success: true,
      order: order,
      client: clientRes.rows[0]
    });

  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error creating order:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /thedal/payments/verify-payment
router.post('/verify-payment', auth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  try {
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_SECRET)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest('hex');

    if (generated_signature === razorpay_signature) {
      // Payment is successful, update client
      await pool.query(
        `UPDATE thedal_clients SET payment_status = 'active' WHERE razorpay_order_id = $1`,
        [razorpay_order_id]
      );
      
      res.json({ success: true, message: 'Payment verified successfully' });
    } else {
      res.status(400).json({ success: false, message: 'Invalid signature' });
    }
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// POST /thedal/payments/webhook
router.post('/webhook', async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  try {
    const body = req.body;
    const signature = req.headers['x-razorpay-signature'];

    // Verify webhook signature
    const rawBody = req.rawBody || JSON.stringify(body);
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature === signature) {
      const event = body.event;

      if (event === 'payment.captured' || event === 'order.paid') {
        const orderId = body.payload.payment.entity.order_id;
        
        // Force update status to active
        await pool.query(
          `UPDATE thedal_clients SET payment_status = 'active' WHERE razorpay_order_id = $1`,
          [orderId]
        );
        console.log(`[Webhook] Order ${orderId} marked as active.`);
      }

      res.status(200).send('OK');
    } else {
      res.status(400).send('Invalid webhook signature');
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
