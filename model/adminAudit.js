const mongoose = require('mongoose');
const { Schema } = mongoose;

const adminAuditSchema = new Schema(
  {
    adminId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      index: true
    },
    targetUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true
    },
    action: {
      type: String,
      required: true,
      enum: [
        'RESTAURANT_CREATED',
        'OWNER_CREATED',
        'BILLING_TIER_CHANGED',
        'RESTAURANT_UPDATED',
        'OWNER_PASSWORD_RESET'
      ],
      index: true
    },
    oldValue: {
      type: Schema.Types.Mixed,
      default: null
    },
    newValue: {
      type: Schema.Types.Mixed,
      default: null
    },
    note: {
      type: String,
      trim: true,
      default: null
    },
    ipAddress: {
      type: String,
      default: null
    },
    userAgent: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminAudit', adminAuditSchema);
