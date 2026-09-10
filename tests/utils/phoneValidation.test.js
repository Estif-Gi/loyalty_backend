const {
  validateEthiopianPhone,
  isValidEthiopianPhone,
  normalizeEthiopianPhone,
  ETHIOPIAN_PHONE_ERROR_MESSAGE
} = require('../../utils/phoneValidation');

describe('Ethiopian Phone Number Validation & Normalization Utility', () => {
  describe('Valid Ethio Telecom Mobile Numbers (09...)', () => {
    test('standard domestic 09 format', () => {
      const phone = '0911223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251911223344');
    });

    test('international +2519 format', () => {
      const phone = '+251911223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251911223344');
    });

    test('international without plus 2519 format', () => {
      const phone = '251911223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251911223344');
    });

    test('raw 9 subscriber digits format', () => {
      const phone = '911223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251911223344');
    });

    test('international with redundant leading zero: +25109...', () => {
      const phone = '+2510911223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251911223344');
    });

    test('phone with formatting spaces, dashes, and parentheses', () => {
      expect(normalizeEthiopianPhone('+251 91 122 3344')).toBe('+251911223344');
      expect(normalizeEthiopianPhone('0911-22-33-44')).toBe('+251911223344');
      expect(normalizeEthiopianPhone('+251 (911) 22-33-44')).toBe('+251911223344');
      expect(normalizeEthiopianPhone(' 0911 22 33 44 ')).toBe('+251911223344');
    });
  });

  describe('Valid Safaricom / Ethio Telecom Mobile Numbers (07...)', () => {
    test('standard domestic 07 format', () => {
      const phone = '0711223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251711223344');
    });

    test('international +2517 format', () => {
      const phone = '+251711223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251711223344');
    });

    test('international without plus 2517 format', () => {
      const phone = '251711223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251711223344');
    });

    test('raw 7 subscriber digits format', () => {
      const phone = '711223344';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251711223344');
    });

    test('formatting characters with 07', () => {
      expect(normalizeEthiopianPhone('+251 71 122 3344')).toBe('+251711223344');
      expect(normalizeEthiopianPhone('0711-22-33-44')).toBe('+251711223344');
    });
  });

  describe('Valid Ethiopian Fixed Lines (Landlines)', () => {
    test('domestic 011 Addis Ababa landline', () => {
      const phone = '0115512233';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251115512233');
    });

    test('international +25111 Addis Ababa landline', () => {
      const phone = '+251115512233';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251115512233');
    });

    test('regional landline 058 (Bahir Dar)', () => {
      const phone = '0582201122';
      expect(isValidEthiopianPhone(phone)).toBe(true);
      expect(normalizeEthiopianPhone(phone)).toBe('+251582201122');
    });
  });

  describe('Invalid Phone Numbers (Non-Ethiopian / Incorrect Formats)', () => {
    test('non-Ethiopian international numbers', () => {
      expect(isValidEthiopianPhone('+12025550123')).toBe(false); // USA
      expect(isValidEthiopianPhone('+447911123456')).toBe(false); // UK
      expect(isValidEthiopianPhone('+254712345678')).toBe(false); // Kenya
      expect(isValidEthiopianPhone('+971501234567')).toBe(false); // UAE
    });

    test('invalid domestic prefixes (not 09, 07, or allowed landline)', () => {
      expect(isValidEthiopianPhone('0811223344')).toBe(false);
      expect(isValidEthiopianPhone('0611223344')).toBe(false);
      expect(isValidEthiopianPhone('+251811223344')).toBe(false);
      expect(isValidEthiopianPhone('+251611223344')).toBe(false);
    });

    test('invalid lengths', () => {
      expect(isValidEthiopianPhone('09112')).toBe(false); // too short
      expect(isValidEthiopianPhone('091122334455')).toBe(false); // too long
      expect(isValidEthiopianPhone('+25191122')).toBe(false); // too short
      expect(isValidEthiopianPhone('+25191122334455')).toBe(false); // too long
      expect(isValidEthiopianPhone('07112')).toBe(false);
      expect(isValidEthiopianPhone('071122334455')).toBe(false);
    });

    test('non-numeric / alphanumeric input', () => {
      expect(isValidEthiopianPhone('0911abcdef')).toBe(false);
      expect(isValidEthiopianPhone('phone12345')).toBe(false);
      expect(isValidEthiopianPhone('invalid')).toBe(false);
    });

    test('empty / null / undefined input', () => {
      expect(isValidEthiopianPhone('')).toBe(false);
      expect(isValidEthiopianPhone(null)).toBe(false);
      expect(isValidEthiopianPhone(undefined)).toBe(false);
      expect(normalizeEthiopianPhone(null)).toBeNull();
    });

    test('provides descriptive error message on failure', () => {
      const result = validateEthiopianPhone('+12025550123');
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(ETHIOPIAN_PHONE_ERROR_MESSAGE);
    });
  });
});
