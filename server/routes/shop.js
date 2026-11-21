/**
 * /api/shop: the products a workspace sells and the orders its AI took.
 * Owner, admin and manager only (the same people who run the AI Brain). The
 * payment details the AI shares (UPI or payment link) are set on the AI Brain
 * profile (payment_instructions), together with orders_enabled.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const shop = require('../services/shopOrders');

const router = express.Router();
router.use(auth);

function fail(res, error, where) {
  if (error && error.status && error.status < 500) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  console.error(`[shop] ${where}:`, error?.message || error);
  return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}

router.get('/products', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.json({ products: (await shop.listProducts()).map(shop.publicProduct) }); } catch (e) { fail(res, e, 'list products'); }
});
router.post('/products', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.status(201).json({ product: shop.publicProduct(await shop.createProduct(req.body || {}, req.user.id)) }); } catch (e) { fail(res, e, 'create product'); }
});
router.put('/products/:id', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.json({ product: shop.publicProduct(await shop.updateProduct(req.params.id, req.body || {})) }); } catch (e) { fail(res, e, 'update product'); }
});
router.delete('/products/:id', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.json({ product: shop.publicProduct(await shop.deactivateProduct(req.params.id)) }); } catch (e) { fail(res, e, 'remove product'); }
});

router.get('/orders', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.json({ orders: await shop.listOrders({ status: req.query.status, limit: req.query.limit }) }); } catch (e) { fail(res, e, 'list orders'); }
});
// PUT /api/shop/orders/:id { status: 'paid' | 'fulfilled' | 'cancelled' }
router.put('/orders/:id', requirePermission('ai_brain.manage'), async (req, res) => {
  try { res.json({ order: shop.publicOrder(await shop.setOrderStatus(req.params.id, String(req.body?.status || ''))) }); } catch (e) { fail(res, e, 'update order'); }
});

module.exports = router;
