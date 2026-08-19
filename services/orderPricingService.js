const Menu = require('../model/menu');
const { ORDER_ERROR_CODES } = require('../constants/orders');

/**
 * Calculates server-verified pricing and item snapshots for a list of client-supplied items.
 * Ignores any client-submitted pricing fields and resolves details exclusively from the DB.
 * 
 * @param {string} restaurantId - Restaurant ID derived from the OrderSession
 * @param {Array} clientItems - Array of items from the client request
 * @returns {Promise<{items: Array, pricing: Object}>} Snapshot items and pricing object
 */
async function verifyAndCalculatePricing(restaurantId, clientItems) {
  if (!Array.isArray(clientItems) || clientItems.length === 0) {
    throw {
      status: 400,
      error: ORDER_ERROR_CODES.ORDER_MENU_EMPTY,
      message: 'Order items cannot be empty.'
    };
  }

  const menu = await Menu.findOne({ restaurant: restaurantId });
  if (!menu) {
    throw {
      status: 404,
      error: ORDER_ERROR_CODES.MENU_ITEM_NOT_FOUND,
      message: 'The restaurant menu was not found.'
    };
  }

  let subtotal = 0;
  const snapshotItems = [];

  for (const item of clientItems) {
    const { menuItemId, quantity, notes } = item;

    // Validate quantity bounds (positive finite integer between 1 and 50)
    if (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 50
    ) {
      throw {
        status: 400,
        error: ORDER_ERROR_CODES.INVALID_ORDER_QUANTITY,
        message: 'Order item quantities must be integers between 1 and 50.'
      };
    }

    // Resolve Mongoose sub-document item from the restaurant's menu
    const dbItem = menu.items.id(menuItemId);
    if (!dbItem) {
      // Check if item belongs to another restaurant's menu
      const foreignMenu = await Menu.findOne({ 'items._id': menuItemId });
      if (foreignMenu) {
        throw {
          status: 400,
          error: ORDER_ERROR_CODES.MENU_ITEM_RESTAURANT_MISMATCH,
          message: 'Selected menu item does not belong to this restaurant.',
          details: { menuItemId }
        };
      } else {
        throw {
          status: 404,
          error: ORDER_ERROR_CODES.MENU_ITEM_NOT_FOUND,
          message: 'Menu item not found in database.',
          details: { menuItemId }
        };
      }
    }

    const unitPrice = dbItem.price;
    const lineTotal = unitPrice * quantity;
    subtotal += lineTotal;

    snapshotItems.push({
      menuItemId,
      name: dbItem.name,
      quantity,
      unitPrice,
      lineTotal,
      notes: notes || ''
    });
  }

  const pricing = {
    subtotal,
    discount: 0,
    tax: 0,
    serviceCharge: 0,
    total: subtotal,
    currency: 'ETB'
  };

  return { items: snapshotItems, pricing };
}

module.exports = {
  verifyAndCalculatePricing
};
