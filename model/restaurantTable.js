const mongoose = require('mongoose');
const { Schema } = mongoose;

const restaurantTableSchema = new Schema(
  {
    restaurant: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    code: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      default: null,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true
    },
    assignedWaiter: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true
    },
    waiterAssignedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound index to ensure uniqueness of table codes *within* a specific restaurant (case-insensitive duplicate control handled in code)
restaurantTableSchema.index({ restaurant: 1, code: 1 }, { unique: true });
restaurantTableSchema.index({ restaurant: 1, isActive: 1 });

module.exports = mongoose.model('RestaurantTable', restaurantTableSchema);
