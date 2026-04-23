# 1. Base remains the same to ensure OS-level compatibility
FROM node:22-slim

# 2. SYSTEM LIBRARIES (The heavy part)
# This layer is now isolated. It will ONLY re-run if you change this text.
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 \
    libgtk-3-0 libpango-1.0-0 libcairo2 libasound2 libx11-6 libx11-xcb1 \
    libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
    libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates \
    fonts-liberation libappindicator3-1 lsb-release xdg-utils wget openssl \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 3. CHROME INSTALLATION (The second heavy part)
# We copy ONLY the config files needed to install Chrome.
# This means a change in your TS code will NOT trigger a re-download of Chrome.
COPY package*.json .puppeteerrc.cjs ./
RUN npm ci
RUN npx puppeteer browsers install chrome

# 4. PRISMA GENERATION
# We copy ONLY the prisma folder. 
# Changing a controller or a helper won't trigger a prisma re-generate.
COPY src/prisma ./src/prisma
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate --schema=./src/prisma

# 5. SOURCE CODE BUILD
# Now we copy the rest of the code. 
# This is the only part that will run on every "push".
COPY . .
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate --schema=./src/prisma
RUN npm run build

EXPOSE 8080

# 6. RUNTIME
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]