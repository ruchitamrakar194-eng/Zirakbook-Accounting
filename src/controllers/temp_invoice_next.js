
// Get Next Invoice Number
const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const lastInvoice = await prisma.invoice.findFirst({
            where: { companyId: parseInt(companyId) },
            orderBy: { id: 'desc' }
        });

        let nextNumber = '101'; // Default start
        if (lastInvoice && lastInvoice.invoiceNumber) {
            // Try to extract number
            const lastNumStr = lastInvoice.invoiceNumber.replace(/\D/g, '');
            if (lastNumStr) {
                const lastNum = parseInt(lastNumStr);
                nextNumber = (lastNum + 1).toString();
            }
        }

        res.status(200).json({ success: true, nextNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
