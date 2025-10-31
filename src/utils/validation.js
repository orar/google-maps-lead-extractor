/**
 * Data validation and cleaning utilities
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get current file directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load email blacklist from config
let emailBlacklist = null;
function loadEmailBlacklist() {
    if (!emailBlacklist) {
        const blacklistPath = join(__dirname, '../config/email-blacklist.json');
        emailBlacklist = JSON.parse(readFileSync(blacklistPath, 'utf-8'));
    }
    return emailBlacklist;
}

/**
 * Clean and normalize a string
 */
export function cleanString(str) {
    if (!str || typeof str !== 'string') return null;
    return str.trim().replace(/\s+/g, ' ') || null;
}

/**
 * Clean and format phone number
 * Keeps international format with + prefix
 */
export function cleanPhone(phone) {
    if (!phone) return null;

    // Remove all whitespace and special characters except + and digits
    let cleaned = phone.replace(/[^\d+]/g, '');

    // If it doesn't start with +, it's likely a US number
    if (!cleaned.startsWith('+') && cleaned.length === 10) {
        cleaned = '+1' + cleaned;
    }

    return cleaned || null;
}

/**
 * Validate and clean email address
 */
export function validateEmail(email) {
    if (!email) return null;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    const trimmed = email.trim().toLowerCase();

    // Load blacklist from config
    const blacklist = loadEmailBlacklist();

    // Filter out blacklisted domains
    if (blacklist.domains.some(domain => trimmed.includes(domain))) {
        return null;
    }

    // Filter out blacklisted patterns
    const patterns = blacklist.patterns.map(pattern => new RegExp(pattern));
    if (patterns.some(pattern => pattern.test(trimmed))) {
        return null;
    }

    return emailRegex.test(trimmed) ? trimmed : null;
}

/**
 * Validate URL
 */
export function validateUrl(url) {
    if (!url) return null;

    try {
        const parsed = new URL(url);
        // Only allow http and https protocols
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.href;
    } catch {
        return null;
    }
}

/**
 * Parse rating from text (e.g., "4.5 stars" -> 4.5)
 */
export function parseRating(ratingText) {
    if (!ratingText) return null;

    const match = ratingText.match(/(\d+\.?\d*)/);
    if (match) {
        const rating = parseFloat(match[1]);
        return rating >= 0 && rating <= 5 ? rating : null;
    }

    return null;
}

/**
 * Parse review count from text (e.g., "1,234 reviews" -> 1234)
 */
export function parseReviewCount(reviewText) {
    if (!reviewText) return 0;

    const match = reviewText.match(/([\d,]+)/);
    if (match) {
        const count = parseInt(match[1].replace(/,/g, ''), 10);
        return isNaN(count) ? 0 : count;
    }

    return 0;
}

/**
 * Parse coordinates from Google Maps URL
 * Example formats:
 * - https://www.google.com/maps/place/.../@40.748817,-73.985428,17z/...
 * - https://www.google.com/maps/place/.../data=!3d40.7180107!4d-73.9591725...
 */
export function parseCoordinates(url) {
    if (!url) return { latitude: null, longitude: null };

    // Try the @ format first (e.g., @40.748817,-73.985428)
    let match = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (match) {
        const latitude = parseFloat(match[1]);
        const longitude = parseFloat(match[2]);

        // Validate coordinate ranges
        if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            return { latitude, longitude };
        }
    }

    // Try the !3d!4d format (e.g., !3d40.7180107!4d-73.9591725)
    match = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (match) {
        const latitude = parseFloat(match[1]);
        const longitude = parseFloat(match[2]);

        // Validate coordinate ranges
        if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
            return { latitude, longitude };
        }
    }

    return { latitude: null, longitude: null };
}

/**
 * Parse address into components
 * Note: This is a basic implementation. For production, consider using a geocoding API
 */
export function parseAddress(fullAddress) {
    if (!fullAddress) {
        return {
            street: null,
            city: null,
            state: null,
            zip: null,
            country: null,
        };
    }

    const parts = fullAddress.split(',').map(p => p.trim());

    // Basic US address pattern: "123 Main St, Brooklyn, NY 11201, USA"
    let street = null;
    let city = null;
    let state = null;
    let zip = null;
    let country = null;

    if (parts.length >= 2) {
        street = parts[0] || null;
        city = parts[1] || null;

        // Try to find state and ZIP in the third part (e.g., "NY 11201")
        if (parts.length >= 3) {
            const stateZipMatch = parts[2].match(/([A-Z]{2})\s*(\d{5}(-\d{4})?)?/);
            if (stateZipMatch) {
                state = stateZipMatch[1] || null;
                zip = stateZipMatch[2] || null;
            } else {
                state = parts[2] || null;
            }
        }

        // Last part is usually country
        if (parts.length >= 4) {
            country = parts[parts.length - 1] || null;
        }
    }

    return {
        street: cleanString(street),
        city: cleanString(city),
        state: cleanString(state),
        zip: cleanString(zip),
        country: cleanString(country) || 'United States',
    };
}

/**
 * Validate business hours object
 * Expected format: { "Monday": "9:00 AM to 5:00 PM", "Tuesday": "9:00 AM to 5:00 PM", ... }
 */
export function validateBusinessHours(hours) {
    if (!hours || typeof hours !== 'object') {
        return null;
    }

    // Check if it's an empty object
    if (Object.keys(hours).length === 0) {
        return null;
    }

    // Valid day names
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    // Validate that all keys are valid day names and values are strings
    const validatedHours = {};
    for (const [day, time] of Object.entries(hours)) {
        if (validDays.includes(day) && typeof time === 'string' && time.trim().length > 0) {
            validatedHours[day] = time.trim();
        }
    }

    return Object.keys(validatedHours).length > 0 ? validatedHours : null;
}

/**
 * Validate and clean complete business data
 */
export function validateBusinessData(rawData) {
    const { latitude, longitude } = parseCoordinates(rawData.googleMapsUrl);
    const addressComponents = parseAddress(rawData.address);

    // Validate and filter email array
    let validatedEmails = [];
    if (rawData.emails && Array.isArray(rawData.emails)) {
        validatedEmails = rawData.emails
            .map(email => validateEmail(email))
            .filter(email => email !== null);
    }

    return {
        businessName: cleanString(rawData.businessName),
        address: cleanString(rawData.address),
        street: addressComponents.street,
        city: addressComponents.city,
        state: addressComponents.state,
        zip: addressComponents.zip,
        country: addressComponents.country,
        phone: cleanPhone(rawData.phone),
        website: validateUrl(rawData.website),
        rating: parseRating(rawData.rating),
        reviewCount: parseReviewCount(rawData.reviewCount),
        category: cleanString(rawData.category),
        priceLevel: rawData.priceLevel || null,
        priceRange: rawData.priceRange || null,
        googleMapsUrl: validateUrl(rawData.googleMapsUrl),
        latitude,
        longitude,
        businessHours: validateBusinessHours(rawData.businessHours),
        emails: validatedEmails,
        emailSource: rawData.emailSource || 'not_found',
    };
}

/**
 * Check if business meets filter criteria
 * NOTE: For price filters, we only exclude businesses that HAVE price data and don't match.
 * Businesses without price data are NOT filtered out (since price data is sparse).
 */
export function meetsFilterCriteria(business, filters) {
    const {
        minRating = 0,
        minReviews = 0,
        filterByPriceLevel = [],
        minPrice = 0,
        maxPrice = 0
    } = filters;

    // Check rating filter
    if (minRating > 0 && business.rating) {
        if (business.rating < minRating) {
            return false;
        }
    }

    // Check review count filter
    if (minReviews > 0 && business.reviewCount) {
        if (business.reviewCount < minReviews) {
            return false;
        }
    }

    // Check price level filter (only if business HAS priceLevel)
    if (filterByPriceLevel && filterByPriceLevel.length > 0 && business.priceLevel) {
        if (!filterByPriceLevel.includes(business.priceLevel)) {
            return false;
        }
    }

    // Check price range filter (only if business HAS priceRange)
    if ((minPrice > 0 || maxPrice > 0) && business.priceRange) {
        // Extract numeric price from priceRange
        // Examples: "$100+", "$50–100", "$50-100"
        const priceNumbers = business.priceRange.match(/\d+/g);
        if (priceNumbers && priceNumbers.length > 0) {
            // For ranges like "$50–100", take the minimum price
            // For "$100+", take that as the minimum
            const businessMinPrice = parseInt(priceNumbers[0], 10);

            // Check minPrice filter
            if (minPrice > 0 && businessMinPrice < minPrice) {
                return false;
            }

            // Check maxPrice filter
            // For "$100+", we consider it as potentially over maxPrice
            if (maxPrice > 0) {
                if (business.priceRange.includes('+')) {
                    // "$100+" means 100 or more, so filter if 100 > maxPrice
                    if (businessMinPrice > maxPrice) {
                        return false;
                    }
                } else if (priceNumbers.length === 2) {
                    // Range like "$50–100", check if the range overlaps with our filter
                    const businessMaxPrice = parseInt(priceNumbers[1], 10);
                    // Only filter out if the business minimum price is above our maxPrice
                    if (businessMinPrice > maxPrice) {
                        return false;
                    }
                }
            }
        }
    }

    return true;
}

/**
 * Extract emails from HTML content using regex
 */
export function extractEmailsFromHTML(html) {
    if (!html) return [];

    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = html.match(emailPattern) || [];

    // Validate and filter emails
    const validEmails = emails
        .map(email => validateEmail(email))
        .filter(email => email !== null);

    // Remove duplicates
    return [...new Set(validEmails)];
}

/**
 * Prioritize emails based on common business email prefixes
 */
export function prioritizeEmails(emails) {
    if (!emails || emails.length === 0) return null;

    const priority = ['info', 'contact', 'hello', 'sales', 'support', 'admin'];

    // Sort by priority
    const sorted = [...emails].sort((a, b) => {
        const aPrefix = a.split('@')[0].toLowerCase();
        const bPrefix = b.split('@')[0].toLowerCase();

        const aPriority = priority.findIndex(p => aPrefix.includes(p));
        const bPriority = priority.findIndex(p => bPrefix.includes(p));

        // -1 means not found, so we put those at the end
        const aScore = aPriority === -1 ? 999 : aPriority;
        const bScore = bPriority === -1 ? 999 : bPriority;

        return aScore - bScore;
    });

    return sorted[0] || null;
}
