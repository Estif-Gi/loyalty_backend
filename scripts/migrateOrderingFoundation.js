require('dotenv').config();
const mongoose = require('mongoose');
const connectDb = require('../config/db');
const Employee = require('../model/employee');
const Restaurant = require('../model/restaurant');

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

async function migrate() {
    try {
        console.log('🔌 Connecting to database...');
        await connectDb();
        console.log('✅ Connected to database successfully.');

        // Migrate Employees
        console.log('🧑‍💼 Migrating Employees...');
        const roleRes = await Employee.updateMany(
            { role: { $exists: false } },
            { $set: { role: 'waiter' } }
        );
        console.log(`- Updated ${roleRes.modifiedCount} employee roles to default 'waiter'.`);

        const activeRes = await Employee.updateMany(
            { isActive: { $exists: false } },
            { $set: { isActive: true } }
        );
        console.log(`- Updated ${activeRes.modifiedCount} employee active status flags to 'true'.`);

        // Migrate Restaurants
        console.log('🏪 Migrating Restaurants...');
        const enabledRes = await Restaurant.updateMany(
            { orderingEnabled: { $exists: false } },
            { $set: { orderingEnabled: false } }
        );
        console.log(`- Updated ${enabledRes.modifiedCount} restaurant orderingEnabled fields to false.`);

        const radiusRes = await Restaurant.updateMany(
            { orderingRadiusMeters: { $exists: false } },
            { $set: { orderingRadiusMeters: 100 } }
        );
        console.log(`- Updated ${radiusRes.modifiedCount} restaurant orderingRadiusMeters fields to 100.`);

        const workflowRes = await Restaurant.updateMany(
            { orderWorkflow: { $exists: false } },
            { $set: { orderWorkflow: DEFAULT_WORKFLOW } }
        );
        console.log(`- Updated ${workflowRes.modifiedCount} restaurant orderWorkflow fields to default flow.`);

        const versionRes = await Restaurant.updateMany(
            { orderWorkflowVersion: { $exists: false } },
            { $set: { orderWorkflowVersion: 1 } }
        );
        console.log(`- Updated ${versionRes.modifiedCount} restaurant orderWorkflowVersion fields to 1.`);

        console.log('🎉 Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('🔥 Migration failed:', error);
        process.exit(1);
    }
}

migrate();
