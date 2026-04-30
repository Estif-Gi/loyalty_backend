const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
    name: { type: String, required: true, trim: true },
    phone: { type: String,  required: true, unique: true, trim: true },
    password: { type: String,  required: true ,select: false },
    role: {  type: String,  enum: ['customer', 'admin', 'owner', 'manager', 'employee'],  default: 'customer' },
    // Grouping the loyalty data into a single sub-document object
    loyalTo: [{
        resID: {  type: Schema.Types.ObjectId,  ref: 'Restaurant', required: true },
        // Only keep resName here if you want to avoid 'populating' 
        // every time. If so, it must be a String.
        resName: { type: String  },
        stamps: {  type: Number, default: 0, min: 0 
        }
    }]
}, { timestamps: true }); // Good practice for tracking user creation

module.exports = mongoose.model("User", userSchema);