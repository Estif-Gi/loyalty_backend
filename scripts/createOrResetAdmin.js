const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../model/users');
const { normalizeEthiopianPhone } = require('../utils/phoneValidation');

async function main() {
  const phoneInput = process.argv[2] || '+251931386887';
  const newPassword = process.argv[3] || 'Admin1234!';

  const normalized = normalizeEthiopianPhone(phoneInput) || phoneInput;

  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(
    `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@loyaltyapp.uno2z8g.mongodb.net/?appName=loyaltyApp`
  );

  let user = await User.findOne({ phone: normalized });
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);

  if (user) {
    user.role = 'admin';
    user.password = hashedPassword;
    await user.save();
    console.log(`✅ Updated existing user "${user.name}" (${user.phone}) to role="admin" with password: "${newPassword}"`);
  } else {
    user = new User({
      name: 'Platform Administrator',
      phone: normalized,
      password: hashedPassword,
      role: 'admin',
    });
    await user.save();
    console.log(`✅ Created new admin user (${user.phone}) with password: "${newPassword}"`);
  }

  await mongoose.disconnect();
  console.log(`Done.`);
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
