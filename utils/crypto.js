const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

/**
 * Validates the encryption key configuration and returns the raw key buffer.
 */
function getEncryptionKey() {
  const keyEnv = process.env.QR_TOKEN_ENCRYPTION_KEY;
  if (!keyEnv) {
    throw new Error('QR_TOKEN_ENCRYPTION_KEY is not defined in environment variables.');
  }
  // Hex format validation (64 characters)
  if (keyEnv.length === 64) {
    return Buffer.from(keyEnv, 'hex');
  }
  // Standard string format validation (32 characters)
  if (keyEnv.length === 32) {
    return Buffer.from(keyEnv, 'utf8');
  }
  throw new Error('QR_TOKEN_ENCRYPTION_KEY must be a 32-byte key (32 plain characters or 64 hex characters).');
}

/**
 * Encrypt a text using AES-256-GCM.
 * Returns IV, Auth Tag, and Ciphertext joined by colons.
 */
function encryptQrToken(text) {
  if (!text) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12); // GCM standard IV is 12 bytes
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a text using AES-256-GCM.
 * Expects IV, Auth Tag, and Ciphertext joined by colons.
 */
function decryptQrToken(encryptedData) {
  if (!encryptedData) return '';
  const key = getEncryptionKey();
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encryptedText = Buffer.from(parts[2], 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Perform startup check to ensure cryptography key is correctly loaded.
 */
function validateEncryptionConfig() {
  try {
    getEncryptionKey();
    console.log('✅ QR Token Encryption Key validated successfully.');
  } catch (err) {
    console.error('❌ QR Token Encryption validation failed:', err.message);
    throw err;
  }
}

module.exports = {
  encryptQrToken,
  decryptQrToken,
  validateEncryptionConfig
};
