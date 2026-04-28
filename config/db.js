const mongoose = require("mongoose");

let cachedConnection = null;
let cachedPromise = null;

function getMongoUri() {
    const rawUri =
        process.env.MONGODB_URI ||
        process.env.MONGO_URI ||
        process.env.MONGODB_URL;

    if (!rawUri) {
        throw new Error("MongoDB URI env var is missing (MONGODB_URI/MONGO_URI/MONGODB_URL)");
    }

    return rawUri.trim().replace(/^['"]|['"]$/g, "");
}

async function connectDb() {
    if (cachedConnection) {
        return cachedConnection;
    }

    const mongoUri = getMongoUri();

    if (!cachedPromise) {
        cachedPromise = mongoose.connect(mongoUri, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 10000
        });
    }

    cachedConnection = await cachedPromise;
    return cachedConnection;
}

module.exports = connectDb;
