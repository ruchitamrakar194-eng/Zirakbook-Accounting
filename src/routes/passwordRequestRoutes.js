const express = require('express');
const router = express.Router();
const passwordRequestController = require('../controllers/passwordRequestController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, passwordRequestController.getPasswordRequests);
router.post('/', authenticateToken, passwordRequestController.createPasswordRequest);
router.put('/:id', authenticateToken, passwordRequestController.updateRequestStatus);

module.exports = router;
