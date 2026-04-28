const mongoose = require("mongoose");

let cachedConnection = null;
let cachedPromise = null;

async function connectDb() {
    if (cachedConnection) {
        return cachedConnection;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not set");
    }

    if (!cachedPromise) {
        cachedPromise = mongoose.connect(process.env.MONGODB_URI, {
            bufferCommands: false
        });
    }

    cachedConnection = await cachedPromise;
    return cachedConnection;
}

module.exports = connectDb;
