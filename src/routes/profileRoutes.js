const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { authenticateToken } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/cloudinaryConfig');

router.get('/', authenticateToken, profileController.getProfile);
router.put('/update', authenticateToken, upload.single('avatar'), profileController.updateProfile);
router.put('/change-password', authenticateToken, profileController.changePassword);

module.exports = router;
