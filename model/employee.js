const mongoose = require('mongoose');
const restaurant = require('./restaurant');
const { Schema } = mongoose;


const employeeSchema = new Schema({
    name: { type: String, required: true, trim: true },
    restaurant: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    password: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model("Employee", employeeSchema);