const mongoose = require("mongoose");
const { Schema } = mongoose;

const loyaltyProgramSchema = new Schema({
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    rewards :[{
        stampsRequired: { type: Number, required: true, min: 1 },
        rewardDescription: { type: String, trim: true }
    }]
}, { timestamps: true });

module.exports = mongoose.model("LoyaltyProgram", loyaltyProgramSchema);