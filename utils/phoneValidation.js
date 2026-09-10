/**
 * Ethiopian Phone Number Validation and Normalization Utility
 * 
 * Supports:
 * - Ethio Telecom mobile: 09XXXXXXXX, +2519XXXXXXXX, 2519XXXXXXXX, 9XXXXXXXX
 * - Safaricom / Ethio Telecom mobile: 07XXXXXXXX, +2517XXXXXXXX, 2517XXXXXXXX, 7XXXXXXXX
 * - Ethiopian fixed-line / landlines: 011XXXXXXX (Addis Ababa), 022..., 025..., 033..., 034..., 046..., 047..., 058...
 * - Formatted strings with spaces, dashes, parentheses: e.g. "+251 91 122 3344", "0911-22-33-44"
 * - Accidental redundant zero: e.g. "+2510911223344" -> normalized to "+251911223344"
 */

const ETHIOPIAN_PHONE_ERROR_MESSAGE =
  'Only Ethiopian phone numbers are accepted (+251..., 09..., or 07...)';

/**
 * Strips whitespace, dashes, dots, and parentheses from a phone string.
 * @param {string} phone 
 * @returns {string}
 */
function cleanPhoneNumber(phone) {
  if (typeof phone !== 'string') return '';
  return phone.trim().replace(/[\s\-\(\)\.]+/g, '');
}

/**
 * Validates and normalizes an Ethiopian phone number.
 * 
 * @param {string} phone - Input phone number
 * @param {object} [options]
 * @param {boolean} [options.allowLandline=true] - Whether Ethiopian landlines are accepted
 * @returns {{ isValid: boolean, normalized?: string, type?: 'mobile' | 'landline', error?: string }}
 */
function validateEthiopianPhone(phone, options = {}) {
  const { allowLandline = true } = options;

  if (!phone || typeof phone !== 'string') {
    return {
      isValid: false,
      error: 'Phone number is required and must be a string'
    };
  }

  const cleaned = cleanPhoneNumber(phone);

  if (!cleaned) {
    return {
      isValid: false,
      error: 'Phone number cannot be empty'
    };
  }

  // Must only contain optional leading + and digits
  if (!/^\+?\d+$/.test(cleaned)) {
    return {
      isValid: false,
      error: ETHIOPIAN_PHONE_ERROR_MESSAGE
    };
  }

  // 1. Mobile Check (Ethio Telecom 9, Safaricom 7)
  // Expected subscriber: 9 digits starting with 7 or 9 -> [79]\d{8}
  
  // Format: +2510[79]\d{8} (with accidental 0)
  const intlWithZeroMatch = cleaned.match(/^\+2510([79]\d{8})$/);
  if (intlWithZeroMatch) {
    return {
      isValid: true,
      normalized: `+251${intlWithZeroMatch[1]}`,
      type: 'mobile'
    };
  }

  // Format: 2510[79]\d{8} (with accidental 0, no plus)
  const intlNoPlusWithZeroMatch = cleaned.match(/^2510([79]\d{8})$/);
  if (intlNoPlusWithZeroMatch) {
    return {
      isValid: true,
      normalized: `+251${intlNoPlusWithZeroMatch[1]}`,
      type: 'mobile'
    };
  }

  // Format: +251[79]\d{8} (standard international mobile)
  const intlMatch = cleaned.match(/^\+251([79]\d{8})$/);
  if (intlMatch) {
    return {
      isValid: true,
      normalized: `+251${intlMatch[1]}`,
      type: 'mobile'
    };
  }

  // Format: 251[79]\d{8} (international mobile without plus)
  const intlNoPlusMatch = cleaned.match(/^251([79]\d{8})$/);
  if (intlNoPlusMatch) {
    return {
      isValid: true,
      normalized: `+251${intlNoPlusMatch[1]}`,
      type: 'mobile'
    };
  }

  // Format: 0[79]\d{8} (domestic mobile, 10 digits starting with 09 or 07)
  const domesticMatch = cleaned.match(/^0([79]\d{8})$/);
  if (domesticMatch) {
    return {
      isValid: true,
      normalized: `+251${domesticMatch[1]}`,
      type: 'mobile'
    };
  }

  // Format: [79]\d{8} (9 digits without leading 0 or 251)
  const rawSubscriberMatch = cleaned.match(/^([79]\d{8})$/);
  if (rawSubscriberMatch) {
    return {
      isValid: true,
      normalized: `+251${rawSubscriberMatch[1]}`,
      type: 'mobile'
    };
  }

  // 2. Fixed-line / Landline Check (area codes 11, 22, 25, 33, 34, 46, 47, 58 + 7 digits)
  if (allowLandline) {
    // International landline: +251[1-5]\d{7,8} or +2510[1-5]\d{7,8}
    const intlLandlineZeroMatch = cleaned.match(/^\+2510([1-5]\d{7,8})$/);
    if (intlLandlineZeroMatch) {
      return {
        isValid: true,
        normalized: `+251${intlLandlineZeroMatch[1]}`,
        type: 'landline'
      };
    }

    const intlLandlineMatch = cleaned.match(/^\+251([1-5]\d{7,8})$/);
    if (intlLandlineMatch) {
      return {
        isValid: true,
        normalized: `+251${intlLandlineMatch[1]}`,
        type: 'landline'
      };
    }

    const intlNoPlusLandlineMatch = cleaned.match(/^2510?([1-5]\d{7,8})$/);
    if (intlNoPlusLandlineMatch) {
      return {
        isValid: true,
        normalized: `+251${intlNoPlusLandlineMatch[1]}`,
        type: 'landline'
      };
    }

    // Domestic landline: 0[1-5]\d{7,8}
    const domesticLandlineMatch = cleaned.match(/^0([1-5]\d{7,8})$/);
    if (domesticLandlineMatch) {
      return {
        isValid: true,
        normalized: `+251${domesticLandlineMatch[1]}`,
        type: 'landline'
      };
    }
  }

  return {
    isValid: false,
    error: ETHIOPIAN_PHONE_ERROR_MESSAGE
  };
}

/**
 * Returns true if the phone number is a valid Ethiopian phone number.
 * 
 * @param {string} phone 
 * @param {object} [options]
 * @returns {boolean}
 */
function isValidEthiopianPhone(phone, options = {}) {
  const result = validateEthiopianPhone(phone, options);
  return result.isValid;
}

/**
 * Normalizes an Ethiopian phone number to canonical E.164 (+251XXXXXXXXX) format.
 * Returns null if the phone number is not a valid Ethiopian phone number.
 * 
 * @param {string} phone 
 * @param {object} [options]
 * @returns {string|null}
 */
function normalizeEthiopianPhone(phone, options = {}) {
  const result = validateEthiopianPhone(phone, options);
  return result.isValid ? result.normalized : null;
}

module.exports = {
  cleanPhoneNumber,
  validateEthiopianPhone,
  isValidEthiopianPhone,
  normalizeEthiopianPhone,
  ETHIOPIAN_PHONE_ERROR_MESSAGE
};
