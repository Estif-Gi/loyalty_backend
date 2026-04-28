const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true }
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);