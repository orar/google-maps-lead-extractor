# Use Apify's base image with Playwright pre-installed
FROM apify/actor-node-playwright-chrome:20

# Switch to root to enable corepack
USER root

# Enable corepack for pnpm support
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Switch back to default user
USER myuser

# Copy package files first for better caching
COPY package.json ./
COPY pnpm-lock.yaml* ./

# Install dependencies with pnpm (use frozen-lockfile if lock file exists)
RUN pnpm install

# Copy the rest of the application
COPY . ./

# Install Playwright browsers (may already be installed in base image)
RUN npx playwright install chromium --with-deps

# Run the Actor
CMD pnpm start
