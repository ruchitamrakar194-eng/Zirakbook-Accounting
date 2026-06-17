const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const { isCloudinaryConfigured } = require('../utils/cloudinaryConfig');

const getProfile = async (req, res) => {
    try {
        const userId = req.user.userId;
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const { password, ...profile } = user;
        res.json(profile);
    } catch (error) {
        console.error('Get Profile Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updateProfile = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, email } = req.body;

        const data = { name, email };

        if (req.file) {
            console.log('File received in updateProfile:', req.file);
            console.log('Cloudinary Configured:', isCloudinaryConfigured);

            if (isCloudinaryConfigured) {
                data.avatar = req.file.path;
                console.log('Setting data.avatar to:', data.avatar);
            } else {
                console.warn('Cloudinary not configured, skipping avatar update.');
            }
        } else {
            console.log('No file received in updateProfile request body.');
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data
        });

        const { password, ...profile } = updatedUser;
        res.json({ message: 'Profile updated successfully', user: profile });
    } catch (error) {
        console.error('Update Profile Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const changePassword = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { oldPassword, newPassword } = req.body;

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Incorrect old password' });

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: userId },
            data: { password: hashedNewPassword }
        });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        console.error('Change Password Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getProfile,
    updateProfile,
    changePassword
};
