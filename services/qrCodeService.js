const crypto = require('crypto');

/**
 * Generate a cryptographically secure random token in hex format.
 * @returns {string} Raw token
 */
function generateRawToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a raw token using SHA-256 for secure database storage.
 * @param {string} token - Raw token string
 * @returns {string} SHA-256 hash
 */
function hashToken(token) {
  if (!token) return '';
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Build the redirect URL for scanning order sessions.
 * @param {string} token - Raw token string
 * @returns {string} Scannable frontend URL
 */
function buildQrUrl(token) {
  const baseUrl = process.env.FRONTEND_BASE_URL || 'https://loyalty-customer.vercel.app';
  return `${baseUrl}/order/start?t=${token}`;
}

module.exports = {
  generateRawToken,
  hashToken,
  buildQrUrl
};
