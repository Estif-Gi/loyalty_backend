const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), override: true });
const multer = require('multer');
const CloudinaryStorage = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary');

if (process.env.CLOUDINARY_URL) {
  cloudinary.v2.config(true);
  cloudinary.config(true);
} else {
  cloudinary.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Defensive alias so multer-storage-cloudinary functions regardless of how it accesses .v2
cloudinary.v2.v2 = cloudinary.v2;

const activeConf = cloudinary.v2.config();
console.log(`[Cloudinary] Active cloud_name: "${activeConf.cloud_name}", api_key: "${activeConf.api_key ? String(activeConf.api_key).slice(0, 4) + '...' : 'MISSING'}"`);

const storage = CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'loyalty_app',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }]
  }
});

const upload = multer({ storage });

// Payment Proof Storage (Higher resolution suitable for receipts & bank transaction proofs)
const paymentProofStorage = CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'loyalty_app/payment_proofs',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 1600, height: 1600, crop: 'limit' }]
  }
});

const uploadPaymentProof = multer({
  storage: paymentProofStorage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * Flexible middleware that handles optional payment proof image uploads.
 * If request is application/json or no file is provided, proceeds cleanly without error.
 * Accepts files named 'proof', 'proofImage', 'image', or 'receipt'.
 */
const handlePaymentProofUpload = (req, res, next) => {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  const uploadFields = uploadPaymentProof.fields([
    { name: 'proof', maxCount: 1 },
    { name: 'proofImage', maxCount: 1 },
    { name: 'image', maxCount: 1 },
    { name: 'receipt', maxCount: 1 }
  ]);

  uploadFields(req, res, (err) => {
    if (err) {
      console.error('🔥 Payment proof upload error:', err);
      return res.status(400).json({
        success: false,
        error: 'PAYMENT_PROOF_UPLOAD_FAILED',
        message: err.message || 'Error uploading payment proof image.'
      });
    }

    if (req.files) {
      req.file = req.files.proof?.[0] || req.files.proofImage?.[0] || req.files.image?.[0] || req.files.receipt?.[0];
    }
    next();
  });
};

upload.uploadPaymentProof = uploadPaymentProof;
upload.handlePaymentProofUpload = handlePaymentProofUpload;
upload.cloudinary = cloudinary;

module.exports = upload;