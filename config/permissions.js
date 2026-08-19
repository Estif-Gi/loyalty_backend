const ROLE_PERMISSIONS = {
  chef: [
    "orders:view",
    "orders:prepare",
    "orders:ready"
  ],

  waiter: [
    "orders:view",
    "orders:serve",
    "orders:payment"
  ],

  cashier: [
    "orders:view",
    "orders:payment",
    "loyalty:stamps:add"
  ]
};

module.exports = ROLE_PERMISSIONS;
