const mongoose = require("mongoose");
const { Schema } = mongoose;

const restaurantSchema = new Schema({
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    phone: { 
        type: String, 
        trim: true 
    },
    owner: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    location: { 
        type: String, 
        trim: true 
    },
    logoURL: { 
        type: String, 
        trim: true 
    },
    themeColor: { 
        type: String, 
        trim: true 
    },

    // Counts
    employeeCount: { 
        type: Number, 
        default: 0 
    },
    customerCount: { 
        type: Number, 
        default: 0 
    },
    menuItemCount: { 
        type: Number, 
        default: 0 
    },
    // menu: [{ type: Schema.Types.ObjectId, ref: 'Menu', default: [], select: false }],
   
    // Push Notification Stats
    pushNotificationsStats: {
        thisMonth: { type: Number, default: 0 },
        lastMonth: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },

    // Billing Status
    billingStatus: { 
        type: String, 
        enum: ['free', 'loyal', 'trustworthy', 'faithful'], 
        default: 'free',
        required: true 
    }

}, { timestamps: true });

// === Indexes ===
restaurantSchema.index({ owner: 1 });                    // Most important
restaurantSchema.index({ billingStatus: 1 });
restaurantSchema.index({ owner: 1, billingStatus: 1 });  // Compound index

module.exports = mongoose.model("Restaurant", restaurantSchema);