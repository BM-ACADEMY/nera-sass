const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/authMiddleware');

router.post('/login', authController.login);

// Protected Admin Routes
router.post('/users', requireAuth, authController.createUserAndTenant);
router.get('/users', requireAuth, authController.getUsers);

module.exports = router;
