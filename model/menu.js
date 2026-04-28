const mongoose = require("mongoose");
const { Schema } = mongoose;
const menuSchema = new Schema({
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    items: [{
        name: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        price: { type: Number, required: true, min: 0 }
    }]
});
module.exports = mongoose.model("Menu", menuSchema);