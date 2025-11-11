import { Actor } from 'apify';
import { scrapeGoogleMaps } from './scraper.js';
import { convertToCSV } from './utils/csvExport.js';

// Initialize Apify Actor
await Actor.init();

try {
    // Get input from Apify platform
    const input = await Actor.getInput();

    if (!input) {
        throw new Error('Input is required');
    }

    // Destructure and validate input parameters
    const {
        keyword,
        location,
        maxResults = 100,
        minRating = 0,
        minReviews = 0,
        filterByPriceLevel = [],
        minPrice = 0,
        maxPrice = 0,
        findEmails = false,
        extractBusinessHours = false,
        useProxy = true,
        proxyType = 'DATACENTER',
        exportToCsv = false,
    } = input;

    // Validate required inputs
    if (!keyword || !location) {
        throw new Error('Both "keyword" and "location" are required parameters');
    }

    console.log('==========================================');
    console.log('Google Maps Lead Extractor');
    console.log('==========================================');
    console.log(`Search: "${keyword}" in "${location}"`);
    console.log(`Max results: ${maxResults}`);
    console.log(`Min rating: ${minRating > 0 ? minRating : 'None'}`);
    console.log(`Min reviews: ${minReviews > 0 ? minReviews : 'None'}`);
    if (filterByPriceLevel && filterByPriceLevel.length > 0) {
        console.log(`Price level filter: ${filterByPriceLevel.join(', ')}`);
    }
    if (minPrice > 0 || maxPrice > 0) {
        const priceRangeStr = minPrice > 0 && maxPrice > 0
            ? `$${minPrice}-$${maxPrice}`
            : minPrice > 0
                ? `$${minPrice}+`
                : `Up to $${maxPrice}`;
        console.log(`Price range: ${priceRangeStr}`);
    }
    console.log(`Find emails: ${findEmails ? 'Yes' : 'No'}`);
    console.log(`Extract hours: ${extractBusinessHours ? 'Yes' : 'No'}`);
    console.log(`Use proxy: ${useProxy ? 'Yes' : 'No'}`);
    if (useProxy) {
        console.log(`Proxy type: ${proxyType}`);
    }
    console.log('==========================================\n');

    // Build Google Maps search URL
    const searchQuery = `${keyword} ${location}`;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;

    // Configure proxy if enabled
    let proxyConfiguration = undefined;
    if (useProxy) {
        const proxyOptions = { groups: [proxyType] };

        // Only add countryCode for RESIDENTIAL proxies
        // GOOGLE_SERP proxies don't support country selection
        if (proxyType === 'RESIDENTIAL') {
            proxyOptions.countryCode = 'US';
        }

        proxyConfiguration = await Actor.createProxyConfiguration(proxyOptions);
    }

    // Run the scraper
    const businesses = await scrapeGoogleMaps({
        searchUrl,
        maxResults,
        minRating,
        minReviews,
        filterByPriceLevel,
        minPrice,
        maxPrice,
        findEmails,
        extractBusinessHours,
        proxyConfiguration,
    });

    // Push results to Apify dataset
    if (businesses.length > 0) {
        await Actor.pushData(businesses);
        console.log(`\n✓ Successfully saved ${businesses.length} businesses to dataset`);

        // Export to CSV if requested
        if (exportToCsv) {
            console.log('\nExporting to CSV...');
            const csvContent = convertToCSV(businesses);
            await Actor.setValue('OUTPUT', csvContent, { contentType: 'text/csv' });
            console.log('✓ CSV export saved to key-value store as "OUTPUT"');
        }
    } else {
        console.log('\n⚠ No businesses found matching your criteria');
    }

    // Print summary
    console.log('\n==========================================');
    console.log('SUMMARY');
    console.log('==========================================');
    console.log(`Total businesses extracted: ${businesses.length}`);

    if (findEmails) {
        const withEmails = businesses.filter(b => b.emails && b.emails.length > 0).length;
        const totalEmails = businesses.reduce((sum, b) => sum + (b.emails ? b.emails.length : 0), 0);
        const emailRate = businesses.length > 0
            ? ((withEmails / businesses.length) * 100).toFixed(1)
            : 0;
        console.log(`Businesses with emails: ${withEmails}/${businesses.length} (${emailRate}%)`);
        console.log(`Total emails found: ${totalEmails}`);
    }

    const avgRating = businesses.length > 0
        ? (businesses.reduce((sum, b) => sum + (b.rating || 0), 0) / businesses.length).toFixed(2)
        : 0;
    console.log(`Average rating: ${avgRating}`);

    console.log('==========================================');
    console.log('\n✓ Actor completed successfully!');

} catch (error) {
    console.error('\n✗ Actor failed with error:', error.message);
    console.error(error.stack);
    throw error;
} finally {
    // Exit Actor
    await Actor.exit();
}
