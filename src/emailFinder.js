/**
 * Email finder module
 * Extracts email addresses from business websites
 */

import { extractEmailsFromHTML, prioritizeEmails } from './utils/validation.js';
import { TIMEOUTS } from './config/selectors.js';

/**
 * Find email on a business website
 * @param {string} websiteUrl - The business website URL
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @returns {Promise<{email: string, source: string} | null>}
 */
export async function findEmailOnWebsite(websiteUrl, browser) {
    if (!websiteUrl) return null;

    let context = null;
    let page = null;

    try {
        // Create new browser context with timeout
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        page = await context.newPage();

        // Set shorter timeout for website visits
        page.setDefaultTimeout(TIMEOUTS.emailFinder);

        console.log(`  Checking website for email: ${websiteUrl}`);

        // Try to load the main page
        await page.goto(websiteUrl, {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUTS.emailFinder,
        });

        // Collect all unique emails from all pages
        const allEmails = new Set();

        // Get main page content
        let pageContent = await page.content();
        let emails = extractEmailsFromHTML(pageContent);

        if (emails.length > 0) {
            emails.forEach(email => allEmails.add(email));
            console.log(`  ✓ Found ${emails.length} email(s) on main page`);
        }

        // Try contact/about pages for additional emails
        const contactLinks = await findContactPages(page);

        for (const link of contactLinks.slice(0, 2)) { // Only check first 2 contact pages
            try {
                console.log(`  Checking contact page: ${link}`);
                await page.goto(link, {
                    waitUntil: 'domcontentloaded',
                    timeout: 5000, // Shorter timeout for secondary pages
                });

                pageContent = await page.content();
                emails = extractEmailsFromHTML(pageContent);

                if (emails.length > 0) {
                    emails.forEach(email => allEmails.add(email));
                    console.log(`  ✓ Found ${emails.length} email(s) on contact page`);
                }
            } catch (error) {
                // Silently continue if contact page fails
                console.log(`  ✗ Failed to load contact page: ${link}`);
            }
        }

        if (allEmails.size > 0) {
            const emailArray = Array.from(allEmails);
            console.log(`  ✓ Total unique emails found: ${emailArray.length}`);
            return { emails: emailArray, source: 'website' };
        }

        console.log(`  ✗ No email found on ${websiteUrl}`);
        return null;

    } catch (error) {
        console.log(`  ✗ Error finding email on ${websiteUrl}: ${error.message}`);
        return null;
    } finally {
        // Clean up
        if (page) {
            await page.close().catch(() => {});
        }
        if (context) {
            await context.close().catch(() => {});
        }
    }
}

/**
 * Find contact/about page links on the current page
 * @param {import('playwright').Page} page
 * @returns {Promise<string[]>}
 */
async function findContactPages(page) {
    try {
        const links = await page.$$eval('a[href]', (anchors) => {
            return anchors
                .map(a => ({
                    href: a.href,
                    text: (a.textContent || '').toLowerCase(),
                }))
                .filter(link => {
                    const url = link.href.toLowerCase();
                    const text = link.text;

                    // Look for common contact page patterns
                    const patterns = [
                        'contact',
                        'about',
                        'team',
                        'get-in-touch',
                        'reach-us',
                        'email',
                        'connect',
                    ];

                    return patterns.some(pattern =>
                        url.includes(pattern) || text.includes(pattern)
                    );
                })
                .map(link => link.href);
        });

        // Remove duplicates
        return [...new Set(links)];
    } catch (error) {
        return [];
    }
}

/**
 * Batch process email finding with concurrency limit
 * @param {Array} businesses - Array of business objects with website field
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @param {number} concurrency - Number of concurrent requests (default: 5)
 * @returns {Promise<Array>} - Array of businesses with email field populated
 */
export async function batchFindEmails(businesses, browser, concurrency = 5) {
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(concurrency);

    console.log(`\nFinding emails for ${businesses.length} businesses (concurrency: ${concurrency})...`);

    const promises = businesses.map((business, index) =>
        limit(async () => {
            if (!business.website) {
                console.log(`[${index + 1}/${businesses.length}] ${business.businessName}: No website`);
                return business;
            }

            console.log(`[${index + 1}/${businesses.length}] ${business.businessName}`);
            const result = await findEmailOnWebsite(business.website, browser);

            if (result && result.emails) {
                business.emails = result.emails;
                business.emailSource = result.source;
            } else {
                business.emails = [];
                business.emailSource = 'not_found';
            }

            return business;
        })
    );

    const results = await Promise.all(promises);

    // Calculate success rate
    const foundCount = results.filter(b => b.emails && b.emails.length > 0).length;
    const totalEmails = results.reduce((sum, b) => sum + (b.emails ? b.emails.length : 0), 0);
    const successRate = ((foundCount / businesses.length) * 100).toFixed(1);

    console.log(`\n✓ Email finding complete: ${foundCount}/${businesses.length} businesses with emails (${successRate}%)`);
    console.log(`  Total emails found: ${totalEmails}`);

    return results;
}

/**
 * Check if email exists in Google Business Profile
 * This is rarely available but worth checking
 * @param {import('playwright').Page} page - Current page with business details open
 * @returns {Promise<string | null>}
 */
export async function findEmailInGoogleProfile(page) {
    try {
        // Look for mailto links
        const emailLink = await page.$('a[href^="mailto:"]');
        if (emailLink) {
            const href = await emailLink.getAttribute('href');
            if (href) {
                const email = href.replace('mailto:', '').split('?')[0];
                console.log(`  ✓ Found email in Google profile: ${email}`);
                return email;
            }
        }

        return null;
    } catch (error) {
        return null;
    }
}
