const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema({
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  title:        { type: String, required: true, trim: true },
  description:  { type: String, trim: true },
  url:          { type: String, trim: true, default: "/rewards" },
  icon:         { type: String, trim: true },
  badge:        { type: String, trim: true },

  // FCM delivery tracking
  tokens:       { type: [String], default: [] },   // tokens snapshot at send time
  sentCount:    { type: Number, default: 0 },       // FCM successCount
  failedCount:  { type: Number, default: 0 },       // FCM failureCount
  status:       { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
  // Optional targeting by stamp count and any stamp modification action performed
  targetMinStamps: { type: Number },
  stampAction: {
    type: { type: String, enum: ['inc','dec','set'], required: false },
    value: { type: Number, required: false }
  },
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);
