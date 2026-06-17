/**
 * Utility service to perform arithmetic conversions between Simple and Compound Units of Measure (UoMs)
 */

/**
 * Converts a transaction quantity into base unit quantity.
 * Example: 5 Cartons -> 5 * 24 = 120 Bottles (where base UoM is Bottle, Carton multiplier is 24)
 * 
 * @param {number} qty - The quantity from the transaction
 * @param {object} transUom - The UoM used in the transaction (Simple or Compound)
 * @param {object} baseUom - The product's base UoM (Simple)
 * @returns {number} The quantity in base units
 */
const convertToBaseQuantity = (qty, transUom, baseUom) => {
    const quantity = parseFloat(qty) || 0;
    if (!transUom || !baseUom || transUom.id === baseUom.id) {
        return quantity;
    }

    // If transaction unit is compound, multiply by its conversion rate
    if (transUom.uomType === 'Compound') {
        const multiplier = parseFloat(transUom.conversionRate) || 1;
        return quantity * multiplier;
    }

    return quantity;
};

/**
 * Converts a transaction unit rate into the base unit cost rate.
 * Example: Purchased Carton at $240 -> $240 / 24 = $10 per Bottle
 * 
 * @param {number} transRate - The unit price/rate from the transaction
 * @param {object} transUom - The UoM used in the transaction
 * @param {object} baseUom - The product's base UoM
 * @returns {number} The rate per base unit
 */
const convertTransRateToBaseRate = (transRate, transUom, baseUom) => {
    const rate = parseFloat(transRate) || 0;
    if (!transUom || !baseUom || transUom.id === baseUom.id) {
        return rate;
    }

    if (transUom.uomType === 'Compound') {
        const multiplier = parseFloat(transUom.conversionRate) || 1;
        return rate / multiplier;
    }

    return rate;
};

/**
 * Converts a base unit rate into a transaction unit rate.
 * Example: Base cost is $10 per Bottle -> Carton (multiplier 24) is sold/valued at $10 * 24 = $240
 * 
 * @param {number} baseRate - The cost/price per base unit
 * @param {object} transUom - The target UoM to convert to
 * @param {object} baseUom - The product's base UoM
 * @returns {number} The rate per transaction unit
 */
const convertBaseRateToTransRate = (baseRate, transUom, baseUom) => {
    const rate = parseFloat(baseRate) || 0;
    if (!transUom || !baseUom || transUom.id === baseUom.id) {
        return rate;
    }

    if (transUom.uomType === 'Compound') {
        const multiplier = parseFloat(transUom.conversionRate) || 1;
        return rate * multiplier;
    }

    return rate;
};

module.exports = {
    convertToBaseQuantity,
    convertTransRateToBaseRate,
    convertBaseRateToTransRate
};
