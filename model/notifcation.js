const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema({
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  title:        { type: String, required: true, trim: true },
  description:  { type: String, trim: true },
  url:          { type: String, trim: true, default: "/rewards" },

  // FCM delivery tracking
  tokens:       { type: [String], default: [] },   // tokens snapshot at send time
  sentCount:    { type: Number, default: 0 },       // FCM successCount
  failedCount:  { type: Number, default: 0 },       // FCM failureCount
  status:       { type: String, enum: ["pending", "sent", "failed"], default: "pending" },
}, { timestamps: true });

module.exports = mongoose.model("Notification", notificationSchema);