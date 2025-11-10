/**
 * Google Maps DOM selectors
 * Note: These selectors may change as Google updates their UI
 * Last verified: October 2025
 */

export const SELECTORS = {
    // Main containers
    searchResultsPanel: 'div[role="main"]',
    feedContainer: 'div[role="feed"]',

    // Business listing cards in the sidebar
    businessCard: 'div[role="feed"] > div > div > a',
    businessLink: 'a[href*="/maps/place/"]',

    // Business details (in expanded panel)
    businessName: 'h1[class*="fontHeadline"]',
    businessNameAlt: 'h1.DUwDvf',

    // Address
    addressButton: 'button[data-item-id="address"]',
    addressText: 'button[data-item-id="address"] div[class*="fontBody"]',

    // Phone
    phoneButton: 'button[data-item-id*="phone"]',
    phoneText: 'button[data-item-id*="phone"] div[class*="fontBody"]',

    // Website
    websiteLink: 'a[data-item-id="authority"]',
    websiteLinkAlt: 'a[aria-label*="Website"]',

    // Rating and reviews
    ratingSpan: 'span[role="img"][aria-label*="star"]',
    reviewCount: 'span[aria-label*="reviews"]',
    reviewCountAlt: 'button[aria-label*="reviews"]',

    // Category
    categoryButton: 'button[jsaction*="category"]',
    categoryText: 'button[class*="DkEaL"]',

    // Price level (e.g., $, $$, $$$, $$$$)
    // Price level has aria-label like "Expensive", "Moderate", "Inexpensive"
    priceLevel: 'span[aria-label="Expensive"], span[aria-label="Moderate"], span[aria-label="Inexpensive"], span[aria-label="Very Expensive"]',
    priceLevelAlt: 'button span:has-text("$")',

    // Business hours
    hoursButton: 'button[data-item-id*="oh"]',
    hoursTable: 'table[aria-label*="Hours"]',
    hoursRow: 'table[aria-label*="Hours"] tr',

    // Status (open/closed)
    businessStatus: 'span[class*="ZDu9vd"] span',

    // Additional info
    plusCode: 'button[data-item-id="oloc"]',

    // Map/coordinates (from URL)
    coordinatesRegex: /@(-?\d+\.\d+),(-?\d+\.\d+)/,

    // Email (rare but sometimes visible)
    emailLink: 'a[href^="mailto:"]',

    // Loading indicators
    loadingSpinner: 'div[class*="loading"]',

    // Consent/cookie buttons (to dismiss)
    consentButton: 'button[aria-label*="Accept"]',
    consentButtonAlt: 'button:has-text("Accept all")',

    // Back button (to close details panel)
    backButton: 'button[aria-label*="Back"]',

    // No results
    noResults: 'div[class*="GRfBxe"]',
};

/**
 * Common aria-label patterns for text extraction
 */
export const ARIA_PATTERNS = {
    rating: /(\d+\.?\d*)\s+star/i,
    reviews: /([\d,]+)\s+review/i,
    phone: /Phone:\s*(.+)/i,
    address: /Address:\s*(.+)/i,
    website: /Website:\s*(.+)/i,
};

/**
 * Timeout constants (in milliseconds)
 */
export const TIMEOUTS = {
    navigation: 60000,       // 60 seconds for page load (proxies can be slow)
    sidebarLoad: 15000,      // 15 seconds for sidebar to appear (increased for proxies)
    businessDetails: 3000,   // 3 seconds for details panel
    scrollWait: 2000,        // 2 seconds after scroll
    humanDelay: 1500,        // Average human interaction delay
    emailFinder: 10000,      // 10 seconds per website visit
};

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
    maxRetries: 3,
    retryDelay: 2000,        // 2 seconds between retries
};
