const express = require('express');
const router = express.Router();
const tableController = require('../controllers/restaurantTableController');
const { verifyToken, checkRole } = require('../middleware/auth');
const { validateCreateTable, validateUpdateTable } = require('../validators/restaurantTableValidator');

router.post(
  '/:restaurantId/tables',
  verifyToken,
  checkRole('owner'),
  validateCreateTable,
  tableController.createTable
);

router.get(
  '/:restaurantId/tables',
  verifyToken,
  tableController.getTables
);

router.get(
  '/:restaurantId/tables/:tableId',
  verifyToken,
  checkRole('owner'),
  tableController.getTableById
);

router.patch(
  '/:restaurantId/tables/:tableId',
  verifyToken,
  checkRole('owner'),
  validateUpdateTable,
  tableController.updateTable
);

router.patch(
  '/:restaurantId/tables/:tableId/deactivate',
  verifyToken,
  checkRole('owner'),
  tableController.deactivateTable
);

router.patch(
  '/:restaurantId/tables/:tableId/activate',
  verifyToken,
  checkRole('owner'),
  tableController.activateTable
);

router.patch(
  '/:restaurantId/tables/:tableId/waiter',
  verifyToken,
  checkRole('owner'),
  tableController.assignWaiterToTable
);

router.patch(
  '/:restaurantId/table-assignments',
  verifyToken,
  checkRole('owner'),
  tableController.bulkAssignTables
);

router.get(
  '/:restaurantId/table-assignments',
  verifyToken,
  checkRole('owner'),
  tableController.listTableAssignments
);

module.exports = router;
