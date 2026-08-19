const mongoose = require('mongoose');
const { Schema } = mongoose;

const locationVerificationSchema = new Schema(
  {
    accuracyMeters: {
      type: Number,
      required: true
    },
    distanceMeters: {
      type: Number,
      required: true
    },
    verifiedAt: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  {
    _id: false
  }
);

const orderSessionSchema = new Schema(
  {
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: 'RestaurantTable',
      required: true,
      index: true
    },
    qrCode: {
      type: Schema.Types.ObjectId,
      ref: 'RestaurantQrCode',
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'completed', 'cancelled'],
      default: 'active',
      required: true,
      index: true
    },
    locationVerification: {
      type: locationVerificationSchema,
      required: true
    },
    expiresAt: {
      type: Date,
      required: true
    },
    lastVerifiedAt: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  {
    timestamps: true
  }
);

// Compound index for lookup performance
orderSessionSchema.index({ customer: 1, status: 1 });
orderSessionSchema.index({ restaurant: 1, status: 1 });

// Concurrency-safe Unique Partial Index (enforces exactly one active session globally per customer)
orderSessionSchema.index(
  { customer: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

// TTL Index for DB automatic cleanups
orderSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('OrderSession', orderSessionSchema);
