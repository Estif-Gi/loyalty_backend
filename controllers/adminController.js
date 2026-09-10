const adminService = require('../services/adminService');

function getReqMeta(req) {
  return {
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent']
  };
}

exports.createRestaurant = async (req, res) => {
  try {
    const { owner, restaurant } = req.body;
    const adminId = req.user.id;
    const reqMeta = getReqMeta(req);

    const result = await adminService.createRestaurantWithOwner({
      ownerData: owner,
      restaurantData: restaurant,
      adminId,
      reqMeta
    });

    res.status(201).json({
      success: true,
      message: 'Restaurant and Owner account created successfully.',
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    if (status >= 500) {
      console.error('🔥 Error in createRestaurant:', error);
    }
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to create restaurant and owner account.'
    });
  }
};

exports.getRestaurants = async (req, res) => {
  try {
    const { page, limit, search, billingStatus, orderingEnabled } = req.query;

    const result = await adminService.listRestaurants({
      page,
      limit,
      search,
      billingStatus,
      orderingEnabled
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to list restaurants.'
    });
  }
};

exports.getRestaurantById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await adminService.getRestaurantDetails(id);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to retrieve restaurant details.'
    });
  }
};

exports.updateRestaurantBilling = async (req, res) => {
  try {
    const { id } = req.params;
    const { billingStatus, billingNote } = req.body;
    const adminId = req.user.id;
    const reqMeta = getReqMeta(req);

    const result = await adminService.updateRestaurantBilling({
      restaurantId: id,
      billingStatus,
      billingNote,
      adminId,
      reqMeta
    });

    res.json({
      success: true,
      message: 'Restaurant billing tier updated successfully.',
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to update restaurant billing tier.'
    });
  }
};

exports.updateRestaurant = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const reqMeta = getReqMeta(req);

    const result = await adminService.updateRestaurantDetails({
      restaurantId: id,
      updates: req.body,
      adminId,
      reqMeta
    });

    res.json({
      success: true,
      message: 'Restaurant updated successfully.',
      data: result
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to update restaurant.'
    });
  }
};

exports.getDashboardSummary = async (req, res) => {
  try {
    const result = await adminService.getDashboardSummary();

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('🔥 Error in getDashboardSummary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dashboard summary.'
    });
  }
};

exports.getBillingPlans = (req, res) => {
  try {
    const plans = adminService.getBillingPlans();
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve billing plans.'
    });
  }
};

exports.resetOwnerPassword = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const { newPassword } = req.body;
    const adminId = req.user.id;
    const reqMeta = getReqMeta(req);

    const result = await adminService.resetOwnerPassword({
      ownerId,
      newPassword,
      adminId,
      reqMeta
    });

    res.json({
      success: true,
      message: result.message
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      error: error.errorCode || 'SERVER_ERROR',
      message: error.message || 'Failed to reset owner password.'
    });
  }
};
