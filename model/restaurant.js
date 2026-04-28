const mongoose = require("mongoose");
const { Schema } = mongoose;

const restaurantSchema = new Schema({
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    location: { type: String, trim: true },
    logoURL:{ type: String, trim: true },
    menu: [{type:Schema.Types.ObjectId, ref: 'Menu'}],
    themeColor: { type: String, trim: true },
    loyaltyProgram: [{type:Schema.Types.ObjectId, ref: 'LoyaltyProgram'}],
    notifications: [{type:Schema.Types.ObjectId, ref: 'Notification'}]
}, { timestamps: true });

module.exports = mongoose.model("Restaurant", restaurantSchema);