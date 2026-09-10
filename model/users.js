const mongoose = require('mongoose');
const { Schema } = mongoose;
const { isValidEthiopianPhone, normalizeEthiopianPhone, ETHIOPIAN_PHONE_ERROR_MESSAGE } = require('../utils/phoneValidation');

const userSchema = new Schema({
    name: { type: String, required: true, trim: true },
    phone: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        validate: {
            validator: (v) => isValidEthiopianPhone(v),
            message: props => `${props.value} is not a valid Ethiopian phone number. ${ETHIOPIAN_PHONE_ERROR_MESSAGE}`
        }
    },
    password: { type: String,  required: true },
    role: {  type: String,  enum: ['customer', 'admin', 'owner'],  default: 'customer' },
    // Grouping the loyalty data into a single sub-document object
    loyalTo: [{
        resID: {  type: Schema.Types.ObjectId,  ref: 'Restaurant', required: true },
        // Only keep resName here if you want to avoid 'populating' 
        // every time. If so, it must be a String.
        programID:  { type: Schema.Types.ObjectId, ref: 'LoyaltyProgram' },
        resName: { type: String  },
        stamps: {  type: Number, default: 0, min: 0 }
    }],
    fcmToken: { type: String, default: null }
}, { timestamps: true }); // Good practice for tracking user creation

// Automatically normalize phone number before validation and saving
userSchema.pre('validate', function() {
    if (this.phone) {
        const normalized = normalizeEthiopianPhone(this.phone);
        if (normalized) {
            this.phone = normalized;
        }
    }
});

module.exports = mongoose.model("User", userSchema);