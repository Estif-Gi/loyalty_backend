const mongoose = require('mongoose');
const restaurant = require('./restaurant');
const { Schema } = mongoose;


const employeeSchema = new Schema({
    name: { type: String, required: true, trim: true },
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    password: { type: String, required: true },
    role: {
        type: String,
        enum: ["chef", "waiter", "cashier"],
        required: true,
        default: "waiter"
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Compound index for employee lookups
employeeSchema.index({ restaurant: 1, role: 1, isActive: 1 });

module.exports = mongoose.model("Employee", employeeSchema);