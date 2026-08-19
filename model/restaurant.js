const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderWorkflowStepSchema = new Schema(
  {
    key: {
      type: String,
      required: true
    },
    label: {
      type: String,
      required: true,
      trim: true
    },
    systemState: {
      type: String,
      enum: [
        "OPEN",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED"
      ],
      required: true
    },
    responsibleRole: {
      type: String,
      enum: [
        "chef",
        "waiter",
        "cashier"
      ],
      default: null
    },
    visibleToRoles: [
      {
        type: String,
        enum: [
          "chef",
          "waiter",
          "cashier"
        ]
      }
    ],
    actionRoles: [
      {
        type: String,
        enum: [
          "chef",
          "waiter",
          "cashier"
        ]
      }
    ],
    actionLabel: {
      type: String,
      trim: true
    },
    order: {
      type: Number,
      required: true
    },
    enabled: {
      type: Boolean,
      default: true
    },
    required: {
      type: Boolean,
      default: false
    },
    autoAdvance: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: false
  }
);

const DEFAULT_WORKFLOW = [
  {
    key: "placed",
    label: "New Order",
    systemState: "OPEN",
    responsibleRole: "chef",
    visibleToRoles: ["chef", "waiter", "cashier"],
    actionRoles: ["chef"],
    actionLabel: "Start Preparing",
    order: 1,
    enabled: true,
    required: true,
    autoAdvance: true
  },
  {
    key: "preparing",
    label: "Preparing",
    systemState: "IN_PROGRESS",
    responsibleRole: "chef",
    visibleToRoles: ["chef", "waiter", "cashier"],
    actionRoles: ["chef"],
    actionLabel: "Mark Ready",
    order: 2,
    enabled: true,
    required: false
  },
  {
    key: "ready",
    label: "Ready",
    systemState: "IN_PROGRESS",
    responsibleRole: "waiter",
    visibleToRoles: ["chef", "waiter", "cashier"],
    actionRoles: ["waiter"],
    actionLabel: "Mark Served",
    order: 3,
    enabled: true,
    required: false
  },
  {
    key: "serving",
    label: "Serving",
    systemState: "IN_PROGRESS",
    responsibleRole: "waiter",
    visibleToRoles: ["chef", "waiter", "cashier"],
    actionRoles: ["waiter"],
    actionLabel: "Complete Order",
    order: 4,
    enabled: false,
    required: false
  },
  {
    key: "completed",
    label: "Completed",
    systemState: "COMPLETED",
    responsibleRole: null,
    visibleToRoles: ["chef", "waiter", "cashier"],
    actionRoles: [],
    actionLabel: null,
    order: 5,
    enabled: true,
    required: true
  }
];

const restaurantSchema = new Schema({
    name: { 
        type: String, 
        required: true, 
        trim: true 
    },
    phone: { 
        type: String, 
        trim: true 
    },
    owner: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    location: { 
        type: String, 
        trim: true 
    },
    logoURL: { 
        type: String, 
        trim: true 
    },
    themeColor: { 
        type: String, 
        trim: true 
    },

    // Counts
    employeeCount: { 
        type: Number, 
        default: 0 
    },
    customerCount: { 
        type: Number, 
        default: 0 
    },
    menuItemCount: { 
        type: Number, 
        default: 0 
    },
   
    // Push Notification Stats
    pushNotificationsStats: {
        thisMonth: { type: Number, default: 0 },
        lastMonth: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },

    // Billing Status
    billingStatus: { 
        type: String, 
        enum: ['free', 'loyal', 'trustworthy', 'faithful'], 
        default: 'free',
        required: true 
    },

    // Physical Ordering Configuration
    orderingLocation: {
        type: {
            type: String,
            enum: ["Point"]
        },
        coordinates: {
            type: [Number]
        }
    },
    orderingRadiusMeters: {
        type: Number,
        default: 100
    },
    orderingEnabled: {
        type: Boolean,
        default: false
    },

    // Custom Order Workflow
    orderWorkflow: {
        type: [orderWorkflowStepSchema],
        default: () => DEFAULT_WORKFLOW
    },
    orderWorkflowVersion: {
        type: Number,
        default: 1
    }

}, { timestamps: true });

// === Indexes ===
restaurantSchema.index({ owner: 1 });                    // Most important
restaurantSchema.index({ billingStatus: 1 });
restaurantSchema.index({ owner: 1, billingStatus: 1 });  // Compound index
restaurantSchema.index({ orderingLocation: "2dsphere" }); // Geospatial index

module.exports = mongoose.model("Restaurant", restaurantSchema);