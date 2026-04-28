const mongoose = require("mongoose");

let cachedConnection = null;
let cachedPromise = null;

function getMongoUri() {
    const rawUri =
        process.env.DB_USER
        process.env.DB_PASSWORD
        process.env.DB_NAME
    return `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/?appName=${process.env.DB_NAME}`
}

async function connectDb() {
    if (cachedConnection) {
        return cachedConnection;
    }

    const mongoUri = getMongoUri();

    if (!cachedPromise) {
        cachedPromise = mongoose.connect(`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/?appName=${process.env.DB_NAME}`, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 10000
        });
    }
    
    cachedConnection = await cachedPromise;
    return cachedConnection;
}

module.exports = connectDb;
