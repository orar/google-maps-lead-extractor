/**
 * CSV export utilities
 * Handles conversion of business data to CSV-friendly format
 */

/**
 * Flatten business data for CSV export
 * Converts nested objects (businessHours) and arrays (emails) to strings
 */
export function flattenForCSV(business) {
    const flattened = { ...business };

    // Convert emails array to comma-separated string
    if (Array.isArray(flattened.emails)) {
        flattened.emails = flattened.emails.join('; ');
    }

    // Convert business hours object to formatted string
    if (flattened.businessHours && typeof flattened.businessHours === 'object') {
        const hoursArray = [];
        const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

        for (const day of dayOrder) {
            if (flattened.businessHours[day]) {
                hoursArray.push(`${day}: ${flattened.businessHours[day]}`);
            }
        }

        flattened.businessHours = hoursArray.length > 0 ? hoursArray.join(' | ') : '';
    }

    return flattened;
}

/**
 * Convert array of businesses to CSV string
 */
export function convertToCSV(businesses) {
    if (!businesses || businesses.length === 0) {
        return '';
    }

    // Flatten all businesses
    const flattenedBusinesses = businesses.map(b => flattenForCSV(b));

    // Get all unique headers from all businesses
    const headers = new Set();
    flattenedBusinesses.forEach(business => {
        Object.keys(business).forEach(key => headers.add(key));
    });

    const headerArray = Array.from(headers);

    // Build CSV content
    const rows = [headerArray]; // Start with headers

    // Add data rows
    flattenedBusinesses.forEach(business => {
        const row = headerArray.map(header => {
            const value = business[header];

            // Handle null/undefined
            if (value === null || value === undefined) {
                return '';
            }

            // Convert to string and escape quotes
            const stringValue = String(value);

            // If value contains comma, quote, or newline, wrap in quotes and escape quotes
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }

            return stringValue;
        });

        rows.push(row);
    });

    // Convert rows to CSV string
    return rows.map(row => row.join(',')).join('\n');
}
