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
        extractBusinessHours = false,
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
            waitUntil: 'load',  // Changed from 'networkidle' (too strict, causes timeouts)
            timeout: TIMEOUTS.navigation,
        });

        // Give the page extra time to render SPA content
        await page.waitForTimeout(5000);

        // Dismiss consent dialog if present (do this FIRST before looking for results)
        await dismissConsent(page);

        // Wait for search results to load
        await waitForSearchResults(page);

        // Extract business listings from sidebar
        console.log(`\nExtracting business listings (max: ${maxResults})...`);
        const businesses = await extractBusinessListings(page, maxResults, {
            minRating,
            minReviews,
            filterByPriceLevel,
            minPrice,
            maxPrice,
        }, proxyConfiguration, extractBusinessHours);

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
        // Try multiple selectors in case Google Maps structure changed
        const selectors = [
            SELECTORS.feedContainer,           // div[role="feed"]
            SELECTORS.searchResultsPanel,      // div[role="main"]
            'div.m6QErb',                      // Common sidebar class
            '[role="region"]',                 // Alternative region selector
        ];

        let found = false;
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 3000 });
                console.log(`✓ Search results loaded (selector: ${selector})`);
                found = true;
                break;
            } catch (e) {
                // Try next selector
            }
        }

        if (!found) {
            // Debug: capture page state
            console.log('\n⚠️  DEBUG: Search results not found. Capturing page state...');

            // Get page title
            const title = await page.title();
            console.log(`Page title: ${title}`);

            // Get page URL (might have redirected)
            const currentUrl = page.url();
            console.log(`Current URL: ${currentUrl}`);

            // Check for common blocking indicators
            const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
            console.log(`Body text sample: ${bodyText}`);

            // Take screenshot for debugging
            try {
                await page.screenshot({ path: 'debug-failed-search.png', fullPage: true });
                console.log('Screenshot saved to: debug-failed-search.png');
            } catch (screenshotError) {
                // Screenshot might fail in some environments
            }

            throw new Error('Search results did not load. The location or keyword might be invalid.');
        }
    } catch (error) {
        if (error.message.includes('Search results did not load')) {
            throw error;
        }
        throw new Error('Search results did not load. The location or keyword might be invalid.');
    }
}

/**
 * Dismiss cookie consent dialog if present
 */
async function dismissConsent(page) {
    try {
        // Try multiple consent button selectors
        const consentSelectors = [
            'button[aria-label*="Accept"]',
            'button[aria-label*="Reject"]',
            'button:has-text("Accept all")',
            'button:has-text("Reject all")',
            'button:has-text("I agree")',
            'form[action*="consent"] button',
        ];

        for (const selector of consentSelectors) {
            try {
                const button = await page.$(selector);
                if (button && await button.isVisible()) {
                    await button.click();
                    await page.waitForTimeout(2000);
                    console.log(`✓ Dismissed consent dialog (${selector})`);
                    return;
                }
            } catch (e) {
                // Try next selector
            }
        }

        console.log('No consent dialog found (or already dismissed)');
    } catch (error) {
        // Consent dialog not present or already dismissed
        console.log('No consent dialog needed');
    }
}

/**
 * Extract business listings from the sidebar
 * Handles pagination by scrolling
 */
async function extractBusinessListings(page, maxResults, filters, proxyConfiguration = null, extractBusinessHours = false) {
    const businesses = [];
    const seenUrls = new Set();
    let previousCount = 0;
    let noNewResultsCount = 0;
    let firstDebugDone = false;  // Only debug first failure

    while (businesses.length < maxResults) {
        // Get all visible business links
        const businessLinks = await page.$$(SELECTORS.businessCard);
        console.log(`Found ${businessLinks.length} business cards in sidebar`);

        // Extract data from new businesses
        for (let i = previousCount; i < businessLinks.length && businesses.length < maxResults; i++) {
            try {
                const businessData = await extractBusinessData(page, businessLinks[i], seenUrls, !firstDebugDone, proxyConfiguration, extractBusinessHours);

                if (businessData) {
                    // Validate and clean data
                    const validatedData = validateBusinessData(businessData);

                    // Skip if validation returned null (invalid business name)
                    if (!validatedData) {
                        continue;
                    }

                    // Check if meets filter criteria
                    if (meetsFilterCriteria(validatedData, filters)) {
                        businesses.push(validatedData);
                        console.log(`[${businesses.length}/${maxResults}] ${validatedData.businessName} ⭐ ${validatedData.rating} (${validatedData.reviewCount} reviews)`);
                    } else {
                        console.log(`  ✗ Filtered out: ${businessData.businessName}`);
                    }
                } else if (!firstDebugDone) {
                    firstDebugDone = true;  // Mark that we've done debug for first failure
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
 * Optimized with reduced timeout for better performance
 */
async function extractHoursData(page) {
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
                        break;
                    }
                } catch (e) {
                    // Skip this button
                }
            }
        }

        if (!hoursButton) {
            return null;
        }

        // Click to expand hours with reduced timeout (5s instead of 30s)
        await hoursButton.click({ timeout: 5000 });
        await page.waitForTimeout(1500);

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
async function extractBusinessData(page, businessLink, seenUrls, enableDebug = false, proxyConfiguration = null, extractBusinessHours = false) {
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

        // Wait for the details panel to actually appear (not just timeout)
        // The details panel is a 'main' element (not in sidebar) that appears with the business info
        // We need to wait for it to avoid picking up the "Results" h1 from the sidebar
        try {
            // Wait longer with proxies (they're slower)
            const detailsWait = proxyConfiguration ? 10000 : 5000;

            // Wait for an h1 to appear that's NOT in the results feed
            // The business name h1 should be in a separate main panel
            await page.waitForFunction(
                () => {
                    // Find all main elements
                    const mainElements = Array.from(document.querySelectorAll('main'));

                    // Look for a main element that's not the results feed
                    for (const main of mainElements) {
                        const ariaLabel = main.getAttribute('aria-label');
                        // Skip the "Results for" sidebar
                        if (ariaLabel && ariaLabel.includes('Results for')) {
                            continue;
                        }

                        // Check if this main has an h1 with actual content
                        const h1 = main.querySelector('h1');
                        if (h1 && h1.textContent && h1.textContent.trim().length > 0) {
                            const text = h1.textContent.trim();
                            // Make sure it's not "Results" or other generic headings
                            if (text !== 'Results' &&
                                !text.startsWith('Results for') &&
                                text.length < 200) {
                                return true;
                            }
                        }
                    }
                    return false;
                },
                { timeout: detailsWait }
            );

            // Additional wait for all content to fully render
            await page.waitForTimeout(1500);
        } catch (error) {
            console.log('  ⚠️  Details panel took longer than expected to load, continuing anyway...');
            // Fallback to fixed timeout
            await page.waitForTimeout(proxyConfiguration ? 5000 : 3000);
        }

        // Extract business name with multiple fallback strategies
        let businessName = null;

        // Strategy 1: Try known selectors
        businessName = await extractText(page, [
            SELECTORS.businessName,
            SELECTORS.businessNameAlt,
            'h1',  // Fallback to any h1
            'h1[class]',  // Any h1 with a class
        ]);

        // Strategy 2: If still no name, try to find it in the details panel ONLY (not the sidebar)
        if (!businessName) {
            businessName = await page.evaluate(() => {
                // Find the details panel (main element that's NOT the results feed)
                const mainElements = Array.from(document.querySelectorAll('div[role="main"]'));
                const detailsPanel = mainElements.find(main => {
                    const label = main.getAttribute('aria-label');
                    return !label || !label.includes('Results for');
                });

                if (!detailsPanel) {
                    return null;
                }

                // Look for h1 elements ONLY within the details panel
                const h1Elements = detailsPanel.querySelectorAll('h1');
                for (const h1 of h1Elements) {
                    const text = h1.textContent?.trim();
                    // Filter out generic headings like "Results", "Reviews", etc.
                    if (text &&
                        text.length > 0 &&
                        text.length < 200 &&
                        text !== 'Results' &&
                        !text.startsWith('Results for')) {
                        return text;
                    }
                }

                // Look for elements with specific aria-labels within details panel
                const labeledElements = detailsPanel.querySelectorAll('[aria-label]');
                for (const el of labeledElements) {
                    const label = el.getAttribute('aria-label');
                    if (label && el.tagName === 'H1') {
                        return label;
                    }
                }

                return null;
            });
        }

        if (!businessName) {
            // Debug: capture what's actually on the page (only for first failure)
            if (enableDebug) {
                console.log('\n⚠️  DEBUG: Could not extract business name. Analyzing page structure...\n');

                const debugInfo = await page.evaluate(() => {
                    // Get all h1 elements and their structure
                    const h1s = Array.from(document.querySelectorAll('h1')).map(h1 => ({
                        text: h1.textContent?.substring(0, 100),
                        classes: h1.className,
                        html: h1.outerHTML.substring(0, 200),
                    }));

                    // Get all elements with large text (potential business names)
                    const largeText = Array.from(document.querySelectorAll('*'))
                        .filter(el => {
                            const style = window.getComputedStyle(el);
                            const fontSize = parseFloat(style.fontSize);
                            return fontSize > 20 && el.textContent && el.textContent.trim().length < 100;
                        })
                        .slice(0, 5)
                        .map(el => ({
                            tag: el.tagName,
                            text: el.textContent?.trim(),
                            classes: el.className,
                        }));

                    // Get the main container info
                    const main = document.querySelector('[role="main"]');
                    const mainText = main?.textContent?.substring(0, 500);

                    return { h1s, largeText, mainText };
                });

                console.log('📊 H1 elements found:', JSON.stringify(debugInfo.h1s, null, 2));
                console.log('📊 Large text elements (potential names):', JSON.stringify(debugInfo.largeText, null, 2));
                console.log('📊 Main container text:', debugInfo.mainText?.substring(0, 200));

                // Take screenshot for visual debugging
                try {
                    await page.screenshot({ path: 'debug-business-details.png', fullPage: true });
                    console.log('📸 Screenshot saved: debug-business-details.png\n');
                } catch (e) {
                    console.log('⚠️  Could not save screenshot');
                }
            } else {
                console.log('  ✗ Could not extract business name');
            }

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

        // Extract business hours (only if enabled)
        let businessHours = null;
        if (extractBusinessHours) {
            businessHours = await extractHoursData(page);
        }

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
