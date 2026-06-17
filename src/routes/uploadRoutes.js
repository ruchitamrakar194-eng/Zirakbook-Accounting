const express = require('express');
const router = express.Router();
const multer = require('multer');
const { cloudinary } = require('../utils/cloudinaryConfig');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Use memory storage so we can handle the buffer ourselves
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/**
 * POST /api/upload
 * Uploads a single file (image or any file) to Cloudinary.
 * Accepts: multipart/form-data with field "file"
 * Optional: query param ?folder=vendors|customers|products (default: "uploads")
 * Returns: { success: true, url: "https://..." }
 */
router.post('/', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const folder = req.query.folder || 'uploads';
        const resourceType = req.file.mimetype.startsWith('image/') ? 'image' : 'raw';

        // Convert buffer to base64 data URI
        const base64Data = req.file.buffer.toString('base64');
        const dataUri = `data:${req.file.mimetype};base64,${base64Data}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(dataUri, {
            folder: folder,
            resource_type: resourceType,
            use_filename: true,
            unique_filename: true
        });

        return res.status(200).json({
            success: true,
            url: result.secure_url,
            public_id: result.public_id,
            resource_type: resourceType,
            original_name: req.file.originalname
        });

    } catch (error) {
        console.error('Upload Error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Upload failed' });
    }
});

module.exports = router;
