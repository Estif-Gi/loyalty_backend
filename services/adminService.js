const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../model/users');
const Restaurant = require('../model/restaurant');
const Employee = require('../model/employee');
const Menu = require('../model/menu');
const LoyaltyProgram = require('../model/loyalty_program');
const Order = require('../model/order');
const AdminAudit = require('../model/adminAudit');
const { TIER_LIMITS, getLimitsForTier } = require('../utils/billingLimits');
const {
  validateEthiopianPhone,
  normalizeEthiopianPhone,
  ETHIOPIAN_PHONE_ERROR_MESSAGE
} = require('../utils/phoneValidation');

const ALLOWED_TIERS = ['free', 'loyal', 'trustworthy', 'faithful'];

/**
 * Atomic creation of Owner account and Restaurant
 */
exports.createRestaurantWithOwner = async ({ ownerData, restaurantData, adminId, reqMeta = {} }) => {
  // 1. Validate Owner fields
  if (!ownerData || typeof ownerData !== 'object') {
    const error = new Error('Owner data is required.');
    error.statusCode = 400;
    error.errorCode = 'OWNER_DATA_REQUIRED';
    throw error;
  }

  const { name: ownerName, phone: ownerPhone, password: ownerPassword } = ownerData;

  if (!ownerName || typeof ownerName !== 'string' || !ownerName.trim()) {
    const error = new Error('Owner name is required.');
    error.statusCode = 400;
    error.errorCode = 'OWNER_NAME_REQUIRED';
    throw error;
  }

  if (!ownerPhone || typeof ownerPhone !== 'string') {
    const error = new Error('Owner phone number is required.');
    error.statusCode = 400;
    error.errorCode = 'OWNER_PHONE_REQUIRED';
    throw error;
  }

  const ownerPhoneVal = validateEthiopianPhone(ownerPhone);
  if (!ownerPhoneVal.isValid) {
    const error = new Error(ownerPhoneVal.error || ETHIOPIAN_PHONE_ERROR_MESSAGE);
    error.statusCode = 400;
    error.errorCode = 'INVALID_ETHIOPIAN_PHONE_NUMBER';
    throw error;
  }
  const normalizedOwnerPhone = ownerPhoneVal.normalized;

  if (!ownerPassword || typeof ownerPassword !== 'string' || ownerPassword.length < 6) {
    const error = new Error('Owner password is required and must be at least 6 characters.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_PASSWORD_LENGTH';
    throw error;
  }

  // Check if owner phone already exists
  const existingUser = await User.findOne({ phone: normalizedOwnerPhone });
  if (existingUser) {
    const error = new Error('A user with this phone number already exists.');
    error.statusCode = 400;
    error.errorCode = 'USER_ALREADY_EXISTS';
    throw error;
  }

  // 2. Validate Restaurant fields
  if (!restaurantData || typeof restaurantData !== 'object') {
    const error = new Error('Restaurant data is required.');
    error.statusCode = 400;
    error.errorCode = 'RESTAURANT_DATA_REQUIRED';
    throw error;
  }

  const {
    name: resName,
    phone: resPhone,
    location: resLocation,
    themeColor: resThemeColor,
    billingStatus: rawTier
  } = restaurantData;

  if (!resName || typeof resName !== 'string' || !resName.trim()) {
    const error = new Error('Restaurant name is required.');
    error.statusCode = 400;
    error.errorCode = 'RESTAURANT_NAME_REQUIRED';
    throw error;
  }

  let normalizedResPhone = null;
  if (resPhone) {
    const resPhoneVal = validateEthiopianPhone(resPhone, { allowLandline: true });
    if (!resPhoneVal.isValid) {
      const error = new Error(resPhoneVal.error || ETHIOPIAN_PHONE_ERROR_MESSAGE);
      error.statusCode = 400;
      error.errorCode = 'INVALID_RESTAURANT_PHONE_NUMBER';
      throw error;
    }
    normalizedResPhone = resPhoneVal.normalized;
  }

  const tier = (rawTier || 'free').toLowerCase();
  if (!ALLOWED_TIERS.includes(tier)) {
    const error = new Error(`Invalid billing tier. Allowed tiers: ${ALLOWED_TIERS.join(', ')}.`);
    error.statusCode = 400;
    error.errorCode = 'INVALID_BILLING_TIER';
    throw error;
  }

  // 3. Hash Password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(ownerPassword, salt);

  // 4. Session & Atomic Creation with safe fallback
  const session = await mongoose.startSession();
  let useTransaction = true;
  try {
    session.startTransaction();
  } catch (err) {
    useTransaction = false;
  }

  let createdUser = null;
  let createdRestaurant = null;

  try {
    const sessionOption = useTransaction ? { session } : {};

    // Create User (strictly role 'owner')
    createdUser = new User({
      name: ownerName.trim(),
      phone: normalizedOwnerPhone,
      password: hashedPassword,
      role: 'owner'
    });
    await createdUser.save(sessionOption);

    // Create Restaurant referencing Owner
    createdRestaurant = new Restaurant({
      name: resName.trim(),
      phone: normalizedResPhone,
      location: resLocation ? resLocation.trim() : '',
      themeColor: resThemeColor ? resThemeColor.trim() : '#7A4B2A',
      billingStatus: tier,
      billingUpdatedAt: new Date(),
      billingUpdatedBy: adminId,
      owner: createdUser._id
    });
    await createdRestaurant.save(sessionOption);

    // Log to Admin Audit
    const auditOwner = new AdminAudit({
      adminId,
      restaurantId: createdRestaurant._id,
      targetUserId: createdUser._id,
      action: 'OWNER_CREATED',
      newValue: { role: 'owner', phone: normalizedOwnerPhone },
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });
    await auditOwner.save(sessionOption);

    const auditRes = new AdminAudit({
      adminId,
      restaurantId: createdRestaurant._id,
      targetUserId: createdUser._id,
      action: 'RESTAURANT_CREATED',
      newValue: { name: createdRestaurant.name, billingStatus: tier },
      ipAddress: reqMeta.ipAddress,
      userAgent: reqMeta.userAgent
    });
    await auditRes.save(sessionOption);

    if (useTransaction) {
      await session.commitTransaction();
    }
  } catch (err) {
    if (useTransaction) {
      await session.abortTransaction();
    } else {
      // Safe manual rollback fallback
      if (createdUser?._id) {
        await User.deleteOne({ _id: createdUser._id }).catch(() => {});
      }
      if (createdRestaurant?._id) {
        await Restaurant.deleteOne({ _id: createdRestaurant._id }).catch(() => {});
      }
    }
    throw err;
  } finally {
    session.endSession();
  }

  return {
    restaurant: {
      id: createdRestaurant._id,
      name: createdRestaurant.name,
      phone: createdRestaurant.phone,
      location: createdRestaurant.location,
      themeColor: createdRestaurant.themeColor,
      billingStatus: createdRestaurant.billingStatus,
      employeeCount: 0,
      customerCount: 0,
      menuItemCount: 0,
      orderingEnabled: createdRestaurant.orderingEnabled,
      createdAt: createdRestaurant.createdAt
    },
    owner: {
      id: createdUser._id,
      name: createdUser.name,
      phone: createdUser.phone,
      role: createdUser.role,
      createdAt: createdUser.createdAt
    }
  };
};

/**
 * List Restaurants with search, filters, pagination, and real counts
 */
exports.listRestaurants = async ({ page = 1, limit = 20, search = '', billingStatus = '', orderingEnabled = '' }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const query = {};

  if (billingStatus && ALLOWED_TIERS.includes(billingStatus.toLowerCase())) {
    query.billingStatus = billingStatus.toLowerCase();
  }

  if (orderingEnabled !== undefined && orderingEnabled !== '') {
    if (orderingEnabled === 'true' || orderingEnabled === true) {
      query.orderingEnabled = true;
    } else if (orderingEnabled === 'false' || orderingEnabled === false) {
      query.orderingEnabled = false;
    }
  }

  if (search && typeof search === 'string' && search.trim()) {
    const trimmed = search.trim();
    const searchRegex = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const matchingOwners = await User.find({
      role: 'owner',
      $or: [{ name: searchRegex }, { phone: searchRegex }]
    }).select('_id');

    const ownerIds = matchingOwners.map(o => o._id);

    query.$or = [
      { name: searchRegex },
      { phone: searchRegex },
      { location: searchRegex },
      { owner: { $in: ownerIds } }
    ];
  }

  const [total, rawRestaurants] = await Promise.all([
    Restaurant.countDocuments(query),
    Restaurant.find(query)
      .populate('owner', 'name phone createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
  ]);

  const restaurants = rawRestaurants.map(r => ({
    id: r._id,
    name: r.name,
    phone: r.phone || null,
    location: r.location || null,
    logoURL: r.logoURL || null,
    themeColor: r.themeColor || null,
    owner: r.owner
      ? {
          id: r.owner._id,
          name: r.owner.name,
          phone: r.owner.phone,
          createdAt: r.owner.createdAt
        }
      : null,
    billingStatus: r.billingStatus || 'free',
    employeeCount: r.employeeCount || 0,
    customerCount: r.customerCount || 0,
    menuItemCount: r.menuItemCount || 0,
    orderingEnabled: !!r.orderingEnabled,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  }));

  return {
    restaurants,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    }
  };
};

/**
 * Get Restaurant Details including live usage and tier limits
 */
exports.getRestaurantDetails = async (restaurantId) => {
  if (!mongoose.isValidObjectId(restaurantId)) {
    const error = new Error('Invalid restaurant ID format.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_RESTAURANT_ID';
    throw error;
  }

  const restaurant = await Restaurant.findById(restaurantId)
    .populate('owner', 'name phone createdAt')
    .populate('billingUpdatedBy', 'name phone');

  if (!restaurant) {
    const error = new Error('Restaurant not found.');
    error.statusCode = 404;
    error.errorCode = 'RESTAURANT_NOT_FOUND';
    throw error;
  }

  const tier = restaurant.billingStatus || 'free';
  const limits = getLimitsForTier(tier);

  // Query live counts for accuracy
  const [staffCount, staffActiveCount, customerCount, menuDoc, loyaltyDoc] = await Promise.all([
    Employee.countDocuments({ restaurant: restaurantId }),
    Employee.countDocuments({ restaurant: restaurantId, isActive: true }),
    User.countDocuments({ 'loyalTo.resID': restaurantId }),
    Menu.findOne({ restaurant: restaurantId }).lean(),
    LoyaltyProgram.findOne({ restaurant: restaurantId }).lean()
  ]);

  const menuItemCount = menuDoc?.items?.length || 0;
  const stampDesignsCount = loyaltyDoc?.rewards?.length || 0;
  const notificationsThisMonth = restaurant.pushNotificationsStats?.thisMonth || 0;

  // Background sync cached counts if different
  if (
    restaurant.employeeCount !== staffActiveCount ||
    restaurant.customerCount !== customerCount ||
    restaurant.menuItemCount !== menuItemCount
  ) {
    restaurant.employeeCount = staffActiveCount;
    restaurant.customerCount = customerCount;
    restaurant.menuItemCount = menuItemCount;
    await restaurant.save().catch(() => {});
  }

  return {
    restaurant: {
      id: restaurant._id,
      name: restaurant.name,
      phone: restaurant.phone || null,
      location: restaurant.location || null,
      logoURL: restaurant.logoURL || null,
      themeColor: restaurant.themeColor || null,
      orderingLocation: restaurant.orderingLocation || null,
      orderingRadiusMeters: restaurant.orderingRadiusMeters,
      orderingEnabled: !!restaurant.orderingEnabled,
      createdAt: restaurant.createdAt,
      updatedAt: restaurant.updatedAt
    },
    owner: restaurant.owner
      ? {
          id: restaurant.owner._id,
          name: restaurant.owner.name,
          phone: restaurant.owner.phone,
          createdAt: restaurant.owner.createdAt
        }
      : null,
    billing: {
      tier,
      limits: {
        staff: limits.staff,
        customers: limits.customers,
        menuItems: limits.menuItems,
        stampDesigns: limits.stampDesigns,
        notifications: limits.notifications
      },
      usage: {
        staff: staffCount,
        staffActive: staffActiveCount,
        customers: customerCount,
        menuItems: menuItemCount,
        stampDesigns: stampDesignsCount,
        notificationsThisMonth
      },
      audit: {
        billingUpdatedAt: restaurant.billingUpdatedAt || null,
        billingUpdatedBy: restaurant.billingUpdatedBy
          ? {
              id: restaurant.billingUpdatedBy._id,
              name: restaurant.billingUpdatedBy.name,
              phone: restaurant.billingUpdatedBy.phone
            }
          : null,
        billingNote: restaurant.billingNote || null
      }
    }
  };
};

/**
 * Update Restaurant Billing Tier (Admin Only)
 */
exports.updateRestaurantBilling = async ({ restaurantId, billingStatus, billingNote, adminId, reqMeta = {} }) => {
  if (!mongoose.isValidObjectId(restaurantId)) {
    const error = new Error('Invalid restaurant ID format.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_RESTAURANT_ID';
    throw error;
  }

  const normalizedTier = (billingStatus || '').toLowerCase();
  if (!ALLOWED_TIERS.includes(normalizedTier)) {
    const error = new Error(`Invalid billing tier. Allowed: ${ALLOWED_TIERS.join(', ')}.`);
    error.statusCode = 400;
    error.errorCode = 'INVALID_BILLING_TIER';
    throw error;
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) {
    const error = new Error('Restaurant not found.');
    error.statusCode = 404;
    error.errorCode = 'RESTAURANT_NOT_FOUND';
    throw error;
  }

  const oldValue = restaurant.billingStatus;
  restaurant.billingStatus = normalizedTier;
  restaurant.billingUpdatedAt = new Date();
  restaurant.billingUpdatedBy = adminId;
  if (billingNote !== undefined) {
    restaurant.billingNote = billingNote ? billingNote.trim() : null;
  }

  await restaurant.save();

  await AdminAudit.create({
    adminId,
    restaurantId: restaurant._id,
    action: 'BILLING_TIER_CHANGED',
    oldValue: { billingStatus: oldValue },
    newValue: { billingStatus: normalizedTier },
    note: billingNote ? billingNote.trim() : null,
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent
  }).catch(() => {});

  return {
    restaurantId: restaurant._id,
    billingStatus: restaurant.billingStatus,
    billingUpdatedAt: restaurant.billingUpdatedAt,
    billingUpdatedBy: adminId,
    billingNote: restaurant.billingNote
  };
};

/**
 * Administrative Update of Restaurant Safe Fields
 */
exports.updateRestaurantDetails = async ({ restaurantId, updates, adminId, reqMeta = {} }) => {
  if (!mongoose.isValidObjectId(restaurantId)) {
    const error = new Error('Invalid restaurant ID format.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_RESTAURANT_ID';
    throw error;
  }

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) {
    const error = new Error('Restaurant not found.');
    error.statusCode = 404;
    error.errorCode = 'RESTAURANT_NOT_FOUND';
    throw error;
  }

  const { name, phone, location, themeColor, orderingEnabled } = updates || {};
  const oldSnap = {
    name: restaurant.name,
    phone: restaurant.phone,
    location: restaurant.location,
    themeColor: restaurant.themeColor,
    orderingEnabled: restaurant.orderingEnabled
  };

  if (name !== undefined) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      const error = new Error('Restaurant name cannot be empty.');
      error.statusCode = 400;
      throw error;
    }
    restaurant.name = name.trim();
  }

  if (phone !== undefined) {
    if (phone) {
      const phoneVal = validateEthiopianPhone(phone, { allowLandline: true });
      if (!phoneVal.isValid) {
        const error = new Error(phoneVal.error || ETHIOPIAN_PHONE_ERROR_MESSAGE);
        error.statusCode = 400;
        throw error;
      }
      restaurant.phone = phoneVal.normalized;
    } else {
      restaurant.phone = null;
    }
  }

  if (location !== undefined) {
    restaurant.location = location ? location.trim() : '';
  }

  if (themeColor !== undefined) {
    restaurant.themeColor = themeColor ? themeColor.trim() : '#7A4B2A';
  }

  if (orderingEnabled !== undefined) {
    restaurant.orderingEnabled = !!orderingEnabled;
  }

  await restaurant.save();

  await AdminAudit.create({
    adminId,
    restaurantId: restaurant._id,
    action: 'RESTAURANT_UPDATED',
    oldValue: oldSnap,
    newValue: {
      name: restaurant.name,
      phone: restaurant.phone,
      location: restaurant.location,
      themeColor: restaurant.themeColor,
      orderingEnabled: restaurant.orderingEnabled
    },
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent
  }).catch(() => {});

  return {
    id: restaurant._id,
    name: restaurant.name,
    phone: restaurant.phone,
    location: restaurant.location,
    themeColor: restaurant.themeColor,
    orderingEnabled: restaurant.orderingEnabled,
    billingStatus: restaurant.billingStatus,
    updatedAt: restaurant.updatedAt
  };
};

/**
 * Dashboard Overview Summary with actual database metrics
 */
exports.getDashboardSummary = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalRestaurants, tierAgg, totalCustomers, totalEmployees, totalOrders, ordersToday, recentRestaurants] =
    await Promise.all([
      Restaurant.countDocuments(),
      Restaurant.aggregate([{ $group: { _id: '$billingStatus', count: { $sum: 1 } } }]),
      User.countDocuments({ role: 'customer' }),
      Employee.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: startOfToday } }),
      Restaurant.find()
        .populate('owner', 'name phone')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

  const distribution = {
    free: 0,
    loyal: 0,
    trustworthy: 0,
    faithful: 0
  };

  tierAgg.forEach(t => {
    const key = (t._id || 'free').toLowerCase();
    if (distribution[key] !== undefined) {
      distribution[key] = t.count;
    }
  });

  return {
    restaurants: {
      total: totalRestaurants,
      ...distribution
    },
    customers: totalCustomers,
    employees: totalEmployees,
    orders: {
      total: totalOrders,
      today: ordersToday
    },
    recentRestaurants: recentRestaurants.map(r => ({
      id: r._id,
      name: r.name,
      billingStatus: r.billingStatus || 'free',
      owner: r.owner ? { name: r.owner.name, phone: r.owner.phone } : null,
      createdAt: r.createdAt
    }))
  };
};

/**
 * System Billing Plans & Configurations
 */
exports.getBillingPlans = () => {
  return Object.entries(TIER_LIMITS).map(([tierKey, limits]) => ({
    tier: tierKey,
    name: tierKey.charAt(0).toUpperCase() + tierKey.slice(1),
    limits: {
      staff: limits.staff,
      customers: limits.customers === Infinity ? 'unlimited' : limits.customers,
      menuItems: limits.menuItems === Infinity ? 'unlimited' : limits.menuItems,
      stampDesigns: limits.stampDesigns === Infinity ? 'unlimited' : limits.stampDesigns,
      notifications: limits.notifications
    }
  }));
};

/**
 * Administrative Password Reset for Restaurant Owner
 */
exports.resetOwnerPassword = async ({ ownerId, newPassword, adminId, reqMeta = {} }) => {
  if (!mongoose.isValidObjectId(ownerId)) {
    const error = new Error('Invalid owner ID format.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_USER_ID';
    throw error;
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    const error = new Error('New password must be at least 6 characters.');
    error.statusCode = 400;
    error.errorCode = 'INVALID_PASSWORD_LENGTH';
    throw error;
  }

  const user = await User.findById(ownerId);
  if (!user) {
    const error = new Error('Owner account not found.');
    error.statusCode = 404;
    error.errorCode = 'USER_NOT_FOUND';
    throw error;
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  await user.save();

  await AdminAudit.create({
    adminId,
    targetUserId: user._id,
    action: 'OWNER_PASSWORD_RESET',
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent
  }).catch(() => {});

  return {
    ownerId: user._id,
    message: 'Owner password has been reset successfully.'
  };
};
