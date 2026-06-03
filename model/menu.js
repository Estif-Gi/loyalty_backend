const mongoose = require("mongoose");
const { Schema } = mongoose;

const menuSchema = new Schema({
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true}, // unique enforces 1 menu per restaurant
    items: [{
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        price: { type: Number, required: true, min: 0 },
        category: { type: String, required: true, trim: true }  // e.g. "Starters", "Mains", "Drinks"
    }]
});

module.exports = mongoose.model('Menu', menuSchema);