/**
 * Google Maps scraper module
 * Handles navigation, pagination, and data extraction
 */

import { chromium } from 'playwright';
import { SELECTORS, TIMEOUTS, ARIA_PATTERNS } from './config/selectors.js';
import { validateBusinessData, meetsFilterCriteria } from './utils/validation.js';
import { findEmailInGoogleProfile, batchFindEmails } from './emailFinder.js';

/**
 * Main scraper function
 * @param {Object} options - Scraper configuration
 * @returns {Promise<Array>} - Array of business objects
 */
export async function scrapeGoogleMaps(options) {
    const {
        searchUrl,
        maxResults = 100,
        minRating = 0,
        minReviews = 0,
        filterByPriceLevel = [],
        minPrice = 0,
        maxPrice = 0,
        findEmails = false,
        proxyConfiguration = null,
    } = options;

    let browser = null;
    let page = null;

    try {
        // Launch browser
        console.log('\nLaunching browser...');
        browser = await launchBrowser(proxyConfiguration);

        // Create page
        page = await browser.newPage();
        await setupPage(page);

        // Navigate to Google Maps search
        console.log(`Navigating to: ${searchUrl}`);
        await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUTS.navigation,
        });

        // Wait for search results to load
        await waitForSearchResults(page);

        // Dismiss consent dialog if present
        await dismissConsent(page);

        // Extract business listings from sidebar
        console.log(`\nExtracting business listings (max: ${maxResults})...`);
        const businesses = await extractBusinessListings(page, maxResults, {
            minRating,
            minReviews,
            filterByPriceLevel,
            minPrice,
            maxPrice,
        });

        console.log(`\n✓ Extracted ${businesses.length} businesses`);

        // Find emails if enabled
        if (findEmails && businesses.length > 0) {
            await batchFindEmails(businesses, browser, 5);
        }

        return businesses;

    } catch (error) {
        console.error('Scraping failed:', error);
        throw error;
    } finally {
        // Cleanup
        if (page) {
            await page.close().catch(() => {});
        }
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}

/**
 * Launch Playwright browser with proper configuration
 */
async function launchBrowser(proxyConfiguration) {
    const launchOptions = {
        headless: true,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
        ],
    };

    // Add proxy if configured
    if (proxyConfiguration) {
        const proxyUrl = await proxyConfiguration.newUrl();
        console.log(`Using proxy: ${proxyUrl}`);

        const url = new URL(proxyUrl);
        launchOptions.proxy = {
            server: `${url.protocol}//${url.host}`,
        };

        if (url.username && url.password) {
            launchOptions.proxy.username = url.username;
            launchOptions.proxy.password = url.password;
        }
    }

    return await chromium.launch(launchOptions);
}

/**
 * Set up page with proper headers and settings
 */
async function setupPage(page) {
    // Set viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Set user agent
    await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    });
}

/**
 * Wait for search results panel to load
 */
async function waitForSearchResults(page) {
    try {
        await page.waitForSelector(SELECTORS.feedContainer, {
            timeout: TIMEOUTS.sidebarLoad,
        });
        console.log('✓ Search results loaded');
    } catch (error) {
        throw new Error('Search results did not load. The location or keyword might be invalid.');
    }
}

/**
 * Dismiss cookie consent dialog if present
 */
async function dismissConsent(page) {
    try {
        const consentButton = await page.$(SELECTORS.consentButton);
        if (consentButton) {
            await consentButton.click();
            await page.waitForTimeout(1000);
            console.log('✓ Dismissed consent dialog');
        }
    } catch (error) {
        // Consent dialog not present or already dismissed
    }
}

/**
 * Extract business listings from the sidebar
 * Handles pagination by scrolling
 */
async function extractBusinessListings(page, maxResults, filters) {
    const businesses = [];
    const seenUrls = new Set();
    let previousCount = 0;
    let noNewResultsCount = 0;

    while (businesses.length < maxResults) {
        // Get all visible business links
        const businessLinks = await page.$$(SELECTORS.businessCard);
        console.log(`Found ${businessLinks.length} business cards in sidebar`);

        // Extract data from new businesses
        for (let i = previousCount; i < businessLinks.length && businesses.length < maxResults; i++) {
            try {
                const businessData = await extractBusinessData(page, businessLinks[i], seenUrls);

                if (businessData) {
                    // Validate and clean data
                    const validatedData = validateBusinessData(businessData);

                    // Check if meets filter criteria
                    if (meetsFilterCriteria(validatedData, filters)) {
                        businesses.push(validatedData);
                        console.log(`[${businesses.length}/${maxResults}] ${validatedData.businessName} ⭐ ${validatedData.rating} (${validatedData.reviewCount} reviews)`);
                    } else {
                        console.log(`  ✗ Filtered out: ${businessData.businessName}`);
                    }
                }
            } catch (error) {
                console.error(`  Error extracting business ${i + 1}:`, error.message);
            }
        }

        // Check if we got new results
        if (businessLinks.length === previousCount) {
            noNewResultsCount++;
            if (noNewResultsCount >= 3) {
                console.log('No more results loading after 3 attempts');
                break;
            }
        } else {
            noNewResultsCount = 0;
        }

        previousCount = businessLinks.length;

        // Stop if we have enough results
        if (businesses.length >= maxResults) {
            break;
        }

        // Scroll to load more results
        await scrollSidebar(page);
        await randomDelay();
        await page.waitForTimeout(TIMEOUTS.scrollWait);
    }

    return businesses;
}

/**
 * Extract business hours from Google Maps
 * Returns structured hours data or null if not available
 */
async function extractBusinessHours(page) {
    try {
        // Look for hours button - try multiple approaches
        let hoursButton = null;

        // Try 1: Standard selector
        hoursButton = await page.$('button[data-item-id*="oh"]');

        // Try 2: Button containing hours text and "See more hours" or status
        if (!hoursButton) {
            const buttons = await page.$$('button');
            for (const btn of buttons) {
                try {
                    const text = await btn.textContent();
                    if (text && (
                        text.toLowerCase().includes('see more hours') ||
                        text.toLowerCase().includes('hours') ||
                        (text.toLowerCase().includes('open') && text.match(/\d+\s*(am|pm)/i)) ||
                        (text.toLowerCase().includes('close') && text.match(/\d+\s*(am|pm)/i))
                    )) {
                        hoursButton = btn;
                        console.log(`  Found hours button: "${text.substring(0, 50)}"`);
                        break;
                    }
                } catch (e) {
                    // Skip this button
                }
            }
        }

        if (!hoursButton) {
            console.log('  ℹ No hours button found');
            return null;
        }

        // Click to expand hours
        console.log('  Clicking hours button...');
        await hoursButton.click();
        await page.waitForTimeout(2500);

        // Extract hours from aria-labels
        // Google Maps uses buttons with aria-labels like "Monday, 9:00 AM to 5:00 PM, Copy open hours"
        // Note: Google Maps shows multiple hour types (main hours, kitchen hours, happy hours, etc.)
        // We only capture the FIRST occurrence for each day, which is typically the main operating hours
        const hoursData = await page.$$eval('button[aria-label*="Copy open hours"]', buttons => {
            const hours = {};
            const seenDays = new Set();

            buttons.forEach(button => {
                const ariaLabel = button.getAttribute('aria-label');
                if (!ariaLabel) return;

                // Parse aria-label: "Monday, 9:00 AM to 5:00 PM, Copy open hours"
                const match = ariaLabel.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),\s*(.+?),\s*Copy open hours/i);
                if (match) {
                    const day = match[1];
                    const timeRange = match[2].trim();

                    // Only take the first occurrence of each day (main operating hours)
                    // Skip subsequent entries (kitchen hours, happy hours, etc.)
                    if (!seenDays.has(day)) {
                        hours[day] = timeRange;
                        seenDays.add(day);
                    }
                }
            });

            return hours;
        });

        // If no hours found, return null
        if (Object.keys(hoursData).length === 0) {
            console.log('  ℹ No hours data found in buttons');
            return null;
        }

        // hoursData is already formatted as { "Monday": "9:00 AM to 5:00 PM", ... }
        const formattedHours = hoursData;

        console.log(`  ✓ Extracted hours for ${Object.keys(formattedHours).length} days`);
        return formattedHours;

    } catch (error) {
        // Business hours not available or extraction failed
        console.log(`  ✗ Hours extraction failed: ${error.message}`);
        return null;
    }
}

/**
 * Extract price level and price range information
 * Returns both price level symbols ($, $$) and actual price ranges ($50-100)
 */
async function extractPriceInfo(page) {
    let priceLevel = null;
    let priceRange = null;

    try {
        // Try to find price level symbols ($, $$, $$$, $$$$)
        priceLevel = await extractText(page, [SELECTORS.priceLevel, SELECTORS.priceLevelAlt]);

        // Try to find price range (e.g., "$50–100", "$100+")
        const priceRangeText = await page.evaluate(() => {
            // Look for text patterns that match price ranges
            const spans = Array.from(document.querySelectorAll('span'));
            for (const span of spans) {
                const text = span.textContent?.trim() || '';
                // Match patterns like: "$50–100", "$100+", "$50-100", "· $50–100"
                if (/\$\d+[–\-+](\d+)?/.test(text)) {
                    // Remove leading · if present
                    return text.replace(/^·\s*/, '');
                }
            }
            return null;
        });

        if (priceRangeText) {
            priceRange = priceRangeText;
        }
    } catch (error) {
        // Price info not available
    }

    return { priceLevel, priceRange };
}

/**
 * Extract data from a single business card
 */
async function extractBusinessData(page, businessLink, seenUrls) {
    try {
        // Get the business URL
        const businessUrl = await businessLink.getAttribute('href');
        if (!businessUrl || seenUrls.has(businessUrl)) {
            return null;
        }
        seenUrls.add(businessUrl);

        // Click on the business to open details panel
        await businessLink.scrollIntoViewIfNeeded();
        await businessLink.click();
        await page.waitForTimeout(TIMEOUTS.businessDetails);

        // Extract business name
        const businessName = await extractText(page, [SELECTORS.businessName, SELECTORS.businessNameAlt]);
        if (!businessName) {
            console.log('  ✗ Could not extract business name');
            return null;
        }

        // Extract all data fields
        const address = await extractText(page, [SELECTORS.addressText]);
        const phone = await extractText(page, [SELECTORS.phoneText]);
        const website = await extractAttribute(page, SELECTORS.websiteLink, 'href');

        // Extract rating
        const ratingElement = await page.$(SELECTORS.ratingSpan);
        let rating = null;
        if (ratingElement) {
            const ariaLabel = await ratingElement.getAttribute('aria-label');
            const match = ariaLabel?.match(ARIA_PATTERNS.rating);
            rating = match ? match[1] : null;
        }

        // Extract review count
        const reviewElement = await page.$(SELECTORS.reviewCount);
        let reviewCount = '0';
        if (reviewElement) {
            const ariaLabel = await reviewElement.getAttribute('aria-label');
            const match = ariaLabel?.match(ARIA_PATTERNS.reviews);
            reviewCount = match ? match[1] : '0';
        }

        // Extract category
        const category = await extractText(page, [SELECTORS.categoryButton, SELECTORS.categoryText]);

        // Extract price level (e.g., $, $$, $$$, $$$$) and price range (e.g., "$50–100", "$100+")
        const { priceLevel, priceRange } = await extractPriceInfo(page);

        // Extract business hours
        const businessHours = await extractBusinessHours(page);

        // Check for email in Google profile (rare)
        const profileEmail = await findEmailInGoogleProfile(page);

        // Build full Google Maps URL
        // businessUrl might be relative (starts with /) or absolute (full URL)
        const fullUrl = businessUrl.startsWith('http')
            ? businessUrl
            : `https://www.google.com/maps${businessUrl}`;

        return {
            businessName,
            address,
            phone,
            website,
            rating,
            reviewCount,
            category,
            priceLevel,
            priceRange,
            googleMapsUrl: fullUrl,
            emails: profileEmail ? [profileEmail] : [],
            emailSource: profileEmail ? 'google_profile' : 'not_found',
            businessHours,
        };

    } catch (error) {
        console.error('  Error extracting business data:', error.message);
        return null;
    }
}

/**
 * Extract text content from page using multiple selectors
 */
async function extractText(page, selectors) {
    if (!Array.isArray(selectors)) {
        selectors = [selectors];
    }

    for (const selector of selectors) {
        try {
            const element = await page.$(selector);
            if (element) {
                const text = await element.textContent();
                if (text && text.trim()) {
                    return text.trim();
                }
            }
        } catch (error) {
            // Try next selector
        }
    }

    return null;
}

/**
 * Extract attribute from element
 */
async function extractAttribute(page, selector, attribute) {
    try {
        const element = await page.$(selector);
        if (element) {
            return await element.getAttribute(attribute);
        }
    } catch (error) {
        // Attribute not found
    }
    return null;
}

/**
 * Scroll the sidebar to load more results
 */
async function scrollSidebar(page) {
    try {
        await page.evaluate((feedSelector) => {
            const feed = document.querySelector(feedSelector);
            if (feed) {
                feed.scrollTo(0, feed.scrollHeight);
            }
        }, SELECTORS.feedContainer);
    } catch (error) {
        console.error('Error scrolling sidebar:', error.message);
    }
}

/**
 * Add random delay to simulate human behavior
 */
async function randomDelay() {
    const delay = TIMEOUTS.humanDelay + Math.random() * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
}
