const mongoose = require('mongoose');
const { Schema } = mongoose;
const { PAYMENT_METHODS } = require('../constants/orders');

const totalsSchema = new Schema(
  {
    subtotal: {
      type: Number,
      default: 0,
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
      default: 0,
      min: 0
    },
    currency: {
      type: String,
      default: 'ETB'
    }
  },
  { _id: false }
);

const paymentSchema = new Schema(
  {
    isPaid: {
      type: Boolean,
      default: false,
      required: true,
      index: true
    },
    method: {
      type: String,
      enum: [...Object.values(PAYMENT_METHODS), null],
      default: null
    },
    proofUrl: {
      type: String,
      default: null,
      trim: true
    },
    proofPublicId: {
      type: String,
      default: null,
      trim: true
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null
    },
    paidAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const customerSnapshotSchema = new Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true
    },
    phone: {
      type: String,
      default: '',
      trim: true
    }
  },
  { _id: false }
);

const tableSnapshotSchema = new Schema(
  {
    name: {
      type: String,
      default: '',
      trim: true
    },
    code: {
      type: String,
      default: '',
      trim: true
    }
  },
  { _id: false }
);

const diningCheckSchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: 'RestaurantTable',
      required: true,
      index: true
    },
    orderSession: {
      type: Schema.Types.ObjectId,
      ref: 'OrderSession',
      required: true,
      unique: true,
      index: true
    },
    customerSnapshot: {
      type: customerSnapshotSchema,
      default: () => ({})
    },
    tableSnapshot: {
      type: tableSnapshotSchema,
      default: () => ({})
    },
    totals: {
      type: totalsSchema,
      default: () => ({})
    },
    payment: {
      type: paymentSchema,
      default: () => ({ isPaid: false })
    },
    openedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// Indexes
diningCheckSchema.index({ restaurant: 1, createdAt: -1 });
diningCheckSchema.index({ restaurant: 1, 'payment.isPaid': 1, createdAt: -1 });
diningCheckSchema.index({ customer: 1, createdAt: -1 });
diningCheckSchema.index({ table: 1, createdAt: -1 });

module.exports = mongoose.model('DiningCheck', diningCheckSchema);
