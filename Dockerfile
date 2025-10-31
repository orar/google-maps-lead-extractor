# Use Apify's base image with Playwright pre-installed
FROM apify/actor-node-playwright-chrome:20

# Copy all files
COPY . ./

# Install dependencies with pnpm
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

# Run the Actor
CMD pnpm start
