const express = require('express');
const router = express.Router();
const { searchAll } = require('../controllers/searchController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, searchAll);

module.exports = router;
