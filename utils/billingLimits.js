const Restaurant = require('../model/restaurant');

const TIER_LIMITS = {
    free: {
        staff: 2,
        customers: 200,
        menuItems: 30,
        stampDesigns: 1,
        notifications: 0
    },
    loyal: {
        staff: 4,
        customers: 1000,
        menuItems: 100,
        stampDesigns: 2,
        notifications: 4
    },
    trustworthy: {
        staff: 6,
        customers: 5000,
        menuItems: 300,
        stampDesigns: 5,
        notifications: 8
    },
    faithful: {
        staff: 10,
        customers: Infinity,
        menuItems: Infinity,
        stampDesigns: Infinity,
        notifications: 12
    }
};

/**
 * Get limits configuration for a specific tier
 * @param {string} tier 
 * @returns {object} limits config
 */
function getLimitsForTier(tier) {
    const key = (tier || 'free').toLowerCase();
    return TIER_LIMITS[key] || TIER_LIMITS.free;
}

/**
 * Fetch restaurant and its tier limits
 * @param {string} restaurantId 
 * @returns {Promise<{restaurant: object, tier: string, limits: object}>}
 */
async function getRestaurantAndLimits(restaurantId) {
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
        throw new Error('Restaurant not found');
    }
    const tier = restaurant.billingStatus || 'free';
    const limits = getLimitsForTier(tier);
    return { restaurant, tier, limits };
}

module.exports = {
    TIER_LIMITS,
    getLimitsForTier,
    getRestaurantAndLimits
};
