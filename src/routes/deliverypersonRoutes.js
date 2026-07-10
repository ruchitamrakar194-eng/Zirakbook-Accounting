const express = require('express');
const router = express.Router();
const deliverypersonController = require('../controllers/deliverypersonController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.get('/', deliverypersonController.getDeliveryPersons);
router.post('/', deliverypersonController.createDeliveryPerson);
router.put('/:id', deliverypersonController.updateDeliveryPerson);
router.delete('/:id', deliverypersonController.deleteDeliveryPerson);

module.exports = router;
