# Use Apify's base image with Playwright pre-installed
FROM apify/actor-node-playwright-chrome:20

# Enable corepack for pnpm support
RUN corepack enable

# Copy package files first for better caching
COPY package.json pnpm-lock.yaml ./

# Prepare pnpm using the version from package.json
RUN corepack prepare pnpm@9.15.0 --activate

# Install dependencies with pnpm
RUN pnpm install --frozen-lockfile

# Copy the rest of the application
COPY . ./

# Install Playwright browsers (may already be installed in base image)
RUN npx playwright install chromium --with-deps

# Run the Actor
CMD pnpm start
