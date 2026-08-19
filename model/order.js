const mongoose = require('mongoose');
const { Schema } = mongoose;
const { SYSTEM_STATES, PAYMENT_STATUSES, PAYMENT_METHODS } = require('../constants/orders');

const orderItemSchema = new Schema(
  {
    menuItemId: {
      type: Schema.Types.ObjectId,
      required: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      max: 50
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    lineTotal: {
      type: Number,
      required: true,
      min: 0
    },
    notes: {
      type: String,
      default: '',
      trim: true
    }
  },
  { _id: false }
);

const pricingSchema = new Schema(
  {
    subtotal: {
      type: Number,
      required: true,
      min: 0
    },
    discount: {
      type: Number,
      default: 0,
      min: 0
    },
    tax: {
      type: Number,
      default: 0,
      min: 0
    },
    serviceCharge: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'ETB'
    }
  },
  { _id: false }
);

const workflowStepSnapshotSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    systemState: { type: String, required: true },
    responsibleRole: { type: String, default: null },
    visibleToRoles: [{ type: String }],
    actionRoles: [{ type: String }],
    actionLabel: { type: String, default: null },
    order: { type: Number, required: true },
    enabled: { type: Boolean, required: true },
    required: { type: Boolean, required: true },
    autoAdvance: { type: Boolean, default: false }
  },
  { _id: false }
);

const workflowSnapshotSchema = new Schema(
  {
    version: { type: Number, required: true },
    steps: [workflowStepSnapshotSchema]
  },
  { _id: false }
);

const timelineEntrySchema = new Schema(
  {
    stepKey: { type: String, required: true },
    systemState: { type: String, required: true },
    actorType: { type: String, enum: ['customer', 'employee', 'system'], required: true },
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorRole: { type: String, default: null },
    action: { type: String, required: true },
    note: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const kitchenTrackingSchema = new Schema(
  {
    startedBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    startedAt: { type: Date, default: null },
    lastHandledBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    readyBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    readyAt: { type: Date, default: null }
  },
  { _id: false }
);

const serviceTrackingSchema = new Schema(
  {
    waiter: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    claimedAt: { type: Date, default: null }, // Deprecated for claiming, retained for legacy compatibility
    assignedAt: { type: Date, default: null },
    assignmentSource: {
      type: String,
      enum: ['table', 'manual'],
      default: 'table'
    },
    servedAt: { type: Date, default: null }
  },
  { _id: false }
);

const paymentTrackingSchema = new Schema(
  {
    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUSES),
      default: PAYMENT_STATUSES.UNPAID,
      required: true
    },
    method: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      default: PAYMENT_METHODS.CASH,
      required: true
    },
    paidAt: { type: Date, default: null }
  },
  { _id: false }
);

const loyaltyTrackingSchema = new Schema(
  {
    rewardUsed: { type: Schema.Types.ObjectId, ref: 'LoyaltyProgram', default: null },
    discountApplied: { type: Number, default: 0, min: 0 },
    stampsEarned: { type: Number, default: 0, min: 0 },
    stampsApplied: { type: Boolean, default: false, required: true }
  },
  { _id: false }
);

const cancellationSchema = new Schema(
  {
    reason: { type: String, default: null, trim: true },
    cancelledBy: { type: Schema.Types.ObjectId, default: null },
    actorType: { type: String, enum: ['customer', 'employee', 'system'], default: null },
    cancelledAt: { type: Date, default: null }
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    orderNumber: {
      type: String,
      required: true
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: 'RestaurantTable',
      required: true
    },
    orderSession: {
      type: Schema.Types.ObjectId,
      ref: 'OrderSession',
      required: true,
      index: true
    },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: [
        {
          validator: (val) => val.length > 0,
          msg: 'Order must contain at least one item.'
        }
      ]
    },
    pricing: {
      type: pricingSchema,
      required: true
    },
    workflow: {
      type: workflowSnapshotSchema,
      required: true
    },
    currentStepKey: {
      type: String,
      required: true
    },
    systemState: {
      type: String,
      enum: Object.values(SYSTEM_STATES),
      required: true,
      index: true
    },
    kitchen: {
      type: kitchenTrackingSchema,
      default: () => ({})
    },
    service: {
      type: serviceTrackingSchema,
      default: () => ({})
    },
    payment: {
      type: paymentTrackingSchema,
      default: () => ({})
    },
    loyalty: {
      type: loyaltyTrackingSchema,
      default: () => ({})
    },
    customerNotes: {
      type: String,
      default: '',
      trim: true
    },
    cancellation: {
      type: cancellationSchema,
      default: () => ({})
    },
    timeline: {
      type: [timelineEntrySchema],
      required: true
    },
    idempotencyKey: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Indexes
orderSchema.index({ restaurant: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ idempotencyKey: 1 }, { unique: true });
orderSchema.index({ restaurant: 1, systemState: 1, createdAt: 1 });
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ 'service.waiter': 1, systemState: 1 });

module.exports = mongoose.model('Order', orderSchema);
