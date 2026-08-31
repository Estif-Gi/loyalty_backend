const mongoose = require('mongoose');
const { Schema } = mongoose;

const restaurantQrCodeSchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true
    },
    table: {
      type: Schema.Types.ObjectId,
      ref: 'RestaurantTable',
      required: true,
      index: true
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    encryptedToken: {
      type: String,
      default: null
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    rotatedAt: {
      type: Date,
      default: null
    },
    revokedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

restaurantQrCodeSchema.index({ restaurant: 1, table: 1, isActive: 1 });

module.exports = mongoose.model('RestaurantQrCode', restaurantQrCodeSchema);
