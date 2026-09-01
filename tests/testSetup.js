const mongoose = require('mongoose');
require('dotenv').config();

beforeAll(async () => {
  // If mongoose is not already connected, connect to the isolated Atlas test database
  if (mongoose.connection.readyState === 0) {
    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const testDbUri = `mongodb+srv://${dbUser}:${dbPassword}@loyaltyapp.uno2z8g.mongodb.net/loyaltyAppTest?appName=loyaltyApp`;
    await mongoose.connect(testDbUri);
  }
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
}, 30000); // 30s timeout for initial Atlas connection

afterEach(async () => {
  // Clean up collections after each test to preserve database isolation
  if (mongoose.connection.readyState !== 0) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  }
});

afterAll(async () => {
  // Close the Mongoose connection
  await mongoose.disconnect();
});
