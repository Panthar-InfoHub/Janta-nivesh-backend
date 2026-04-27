# Velvet Backend

A modern fintech infrastructure powering India's wealth management platform. Built for scale, security, and simplicity.

## Overview

Velvet is a comprehensive backend system that connects users with mutual funds, fixed deposits, tax optimization tools, and seamless onboarding. We abstract away the complexity of India's fragmented fintech ecosystem—Finnsys for investments, Blostem for deposits, NSE for trading—into a single, cohesive API.

**What we do:**
- User authentication and KYC management
- Mutual fund discovery, purchasing, and portfolio management
- Fixed deposit aggregation and transaction processing
- Financial independence analysis (FIRE reports)
- Real-time portfolio caching and optimization

## Architecture

The system is organized into five independent modules, each handling a specific financial domain:

```
┌─────────────────────────────────────────────────────────────┐
│                     VELVET BACKEND                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AUTH          KYC            MUTUAL FUND      FD          │
│  (Finnsys)     (Finnsys)      (Finnsys)        (Blostem)   │
│                                                             │
│                   FIRE REPORT GENERATION                   │
│                   (Puppeteer + pdf-lib)                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
         │                                        │
         └─────────────┬──────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │     Redis Cache Layer       │
        │   High-speed Data Access    │
        └─────────────────────────────┘
```

Each module operates independently with its own service layer, controller, and routes. This isolation makes testing, scaling, and maintenance straightforward.

## Technology Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Runtime** | Node.js 22 | Non-blocking I/O, built for high-concurrency fintech operations |
| **Language** | TypeScript | Type safety catches 40% more bugs before production |
| **Framework** | Express 5.x | Lightweight, well-established, minimal overhead |
| **Database** | PostgreSQL + Prisma | ACID compliance for financial data + type-safe queries |
| **Cache** | Redis 5.x | Sub-millisecond lookups for user portfolios and product catalogs |
| **PDF Generation** | Puppeteer + pdf-lib | Headless Chrome renders complex financial reports to PDF |
| **Validation** | Zod | Runtime schema validation prevents frontend nonsense from breaking the backend |
| **Auth** | JWT + bcryptjs | Stateless authentication, industry standard |
| **Deployment** | Docker + Cloud Run | Serverless auto-scaling, pay-per-invocation model |
| **Network** | Cloud VPC | Isolated network for Blostem API access with IP whitelisting |

## Module Details

### Authentication (Finnsys)

Stateless JWT-based auth with Finnsys integration. Handles credential validation, token issuance, and refresh rotation.

**Entry Points:**
- `POST /auth/login` - Validate credentials against Finnsys
- `POST /auth/refresh` - Get new JWT token
- `POST /auth/logout` - Invalidate session

**Under the Hood:**
- Credentials validated against Finnsys backend
- JWT token stored client-side, verification server-side
- Refresh tokens rotated on each use (security best practice)

### KYC (Finnsys)

Know Your Customer verification—Aadhaar, PAN, video KYC, nominee management. Fully integrated with Finnsys KYC infrastructure.

**Entry Points:**
- `POST /kyc/initiate` - Start KYC process
- `POST /kyc/video` - Trigger video verification
- `GET /kyc/status` - Check verification status
- `PUT /kyc/nominee` - Add/update nominee

**Process Flow:**
```
User submits documents → Finnsys validation → 
Instant auto-approval (Aadhaar) or manual review → 
Status updated in database → User notified
```

### Mutual Funds (Finnsys)

The most complex module. Handles product discovery, cart management, purchasing, SIP setup, and redemptions.

#### Discovery & Browsing

**Fuzzy Search with Ranking:**
```
User types: "lic multi"
System finds: "LIC Multicap Fund", "LIC Multi Asset Fund"
Ranking uses similarity score + performance metrics
Results cached in Redis for 1 hour
```

Uses PostgreSQL `pg_trgm` extension for fuzzy matching. Similarity score weighted 2:1 toward scheme name, balanced with AMC name matching.

**Filtering:**
- Risk level (Low, Moderate, High, Very High)
- Asset type (Equity, Debt, Hybrid, Liquid)
- Sort by (Returns 1Y/3Y/5Y, NAV change)

#### Purchasing

**Two Methods:**

1. **Lumpsum** - One-time investment
   - Add to cart → Validate amount → Execute → Payment link

2. **SIP** - Systematic Investment Plan (recurring monthly)
   - Minimum duration: 30 days in future (Finnsys limitation)
   - Maximum duration: Dec 31, 2099
   - Allowed frequencies: Daily, Weekly, Monthly, Quarterly, Yearly
   - Each product defines allowed SIP dates (e.g., every 5th of month)

**Transaction Flow:**
```
1. User adds to cart (Finnsys stores in their system)
2. Frontend triggers purchase endpoint
3. Backend fetches user + cart from Finnsys
4. Constructs NSE transaction payload with:
   - Order reference number (unique, via generate_unique_code)
   - Scheme code (mapped from product)
   - User's primary bank account
   - KYC flag, EUIN, declaration fields
5. Submits to Finnsys NSE API
6. Receives transaction order ID
7. Generates short URL for OTP confirmation
8. Returns payment link to user
```

#### Redemption

**Types:**
- **Full Redemption** - Sell all units
- **Partial Redemption** - Sell specific amount OR units (mutually exclusive)

**Important:** Frontend sends either `redemption_amount` OR `redemption_units`, never both. Backend validates this constraint via Zod schema.

**Redemption Process:**
```
User selects product from holdings
↓
Resolves product code (from DB if transaction, direct if cart)
↓
Constructs redemption payload
  - All units = "Y" for full
  - All units = "N" for partial
  - Remaining fields populated accordingly
↓
Submits to Finnsys (same endpoint as purchase, different trxn_type)
↓
Gets OTP link for confirmation
↓
User confirms via SMS OTP
↓
Amount credited to primary bank account (typically 6-8 hours)
```

### Fixed Deposits (Blostem)

Aggregated marketplace for bank FDs. Each product supports multiple payout frequencies and customer types (standard, senior citizen, etc).

**Key Concept: Payout Frequencies**

Not all frequencies available for all products. Each product-tenor combination maps to specific frequencies:

| Frequency | Definition |
|-----------|-----------|
| CUMULATIVE | Interest at maturity |
| MONTHLY | Monthly payout |
| QUARTERLY | Quarterly payout |
| HALF_YEARLY | Semi-annual |
| ANNUAL | Yearly payout |

When fetching FD details, if no `payout_frequency` specified, returns ALL frequencies. If specified, returns only that frequency's interest rates.

**Purchasing Flow:**
```
1. User selects FD + tenure + payout frequency
2. Backend looks up interest rate for this combination
3. Creates transaction record (PAYMENT_PENDING)
4. Encrypts user phone number (AES-256-GCM)
5. Calls Blostem: create_transaction_with_purchase_url
6. Receives encrypted payment URL
7. User redirected to payment page
8. Payment processed → Webhook received
9. Transaction status updated
10. If VKYC required, user completes video KYC
11. FD confirmed, confirmation email sent
```

**Encryption:** Uses PBKDF2 key derivation with 1000 iterations. Critical for Blostem integration security.

### FIRE Report Generation

Personalized Financial Independence, Retire Early analysis. Uses Puppeteer to render React components as PDFs.

**Data Pipeline:**
```
Fetch user portfolio (all holdings, assets, liabilities)
↓
Calculate metrics:
  - Current net worth
  - Monthly savings rate
  - Years to financial independence
  - Safe withdrawal rate (4% rule)
↓
Render React component with charts
↓
Puppeteer screenshots component at specific viewport
↓
pdf-lib embeds screenshot + text into PDF
↓
Email PDF to user
↓
Cache calculation in Redis (30 days)
```

**Triggered by:**
- User manual request → Immediate generation
- Cloud Scheduler (daily) → Batch generation for all users

## Third-Party Integrations

### Finnsys

**Services Used:**
- Authentication API
- KYC verification (Aadhaar, PAN)
- Mutual fund product catalog
- NSE trading account creation
- Transaction processing

**API Characteristics:**
- REST endpoints
- XML response format (converted to JSON internally)
- Rate limits: ~100 requests/second per account
- Fallback: Retry with exponential backoff

**Error Handling:**
Custom `AppError` class wraps Finnsys errors. Maps specific error codes to user-friendly messages.

### Blostem

**Services Used:**
- FD product catalog (30+ banks)
- Interest rate aggregation
- Payment processing
- Transaction management
- KYC integration

**API Characteristics:**
- Encrypted payload exchange
- URL-based transaction flow
- IP whitelisting (implemented via VPC)
- Webhook callbacks for payment confirmation

**Security:**
All sensitive data (phone numbers, transaction IDs) encrypted with AES-256-GCM before transmission.

## Deployment

### Docker Multi-Stage Build

Optimized for Cloud Run. Caches layers aggressively to minimize rebuild time.

```dockerfile
Stage 1: System Libraries (50+ MB)
  - APT packages for Chrome runtime
  - Only rebuilds if apt-packages file changes
  - Result: 99% cache hit rate

Stage 2: Chrome Installation (150+ MB)
  - Puppeteer + Chrome binaries
  - Only rebuilds if package.json changes
  - Bundled into image (survives Cold Run)

Stage 3: Prisma Generation (5 MB)
  - Generates TypeScript types from schema
  - Only rebuilds if schema.prisma changes
  - Dependencies: Minimal

Stage 4: Source Build (20 MB)
  - TypeScript compilation
  - Copy custom fonts for PDF rendering
  - Rebuilds on every code change
  - Fastest layer to rebuild
```

### Cloud Run Configuration

Deployed as serverless container on Google Cloud Run.

**Why Cloud Run:**
- Auto-scaling from 0 to N instances
- Pay per request (not per hour)
- Cold start acceptable for financial use case (typical: 1-2s)
- Built-in VPC connector support

**Resource Allocation:**
- Memory: 2GB (sufficient for Puppeteer + database connections)
- CPU: 2 cores (shared among all invocations)
- Timeout: 3600s (needed for batch jobs)
- Concurrency: 80 requests per instance

**Networking:**
- Wrapped within Cloud VPC
- IP whitelisting for Blostem API calls
- Cloud SQL Proxy for database access
- Redis connection via internal IP

### Environment Setup

```bash
# Database
DATABASE_URL=postgresql://user:pass@host/velvet_db

# Redis
REDIS_HOST=redis.internal
REDIS_PORT=6379
REDIS_PASS=your_password
REDIS_USERNAME=default

# External APIs
FINNSYS_BASE_URL=https://api.finnsys.com
FINNSYS_ACCOUNT_ID=your_account
BLOSTEM_API_KEY=your_key
BLOSTEM_ENCRYPTION_KEY=32_char_hex_key
BLOSTEM_ENCRYPTION_SALT=16_char_hex_salt

# Application
JWT_SECRET=your_jwt_secret
ARN=sub_broker_arn_code
EUIN=euin_code_for_investments

# Email
SENDGRID_API_KEY=your_sendgrid_key
EMAIL_FROM=noreply@velvet.co
```

## Project Structure

```
src/
├── controller/          Request handlers, validation, response formatting
├── services/            Business logic, database queries, external APIs
├── routes/              Express route definitions
├── middleware/          Authentication, logging, error handling
├── lib/
│   ├── config-env.ts    Environment variable validation (startup)
│   ├── redis.ts         Redis client singleton
│   ├── db.ts            Prisma client singleton
│   ├── types.ts         TypeScript types + Zod schemas
│   ├── utils.ts         Utility functions
│   ├── fire-report.*    FIRE report generation pipeline
│   └── fonts/           Custom TTF fonts for PDF rendering
├── prisma/
│   ├── schema.prisma    Database schema definition
│   ├── migrations/      Versioned schema changes
│   └── generated/       Prisma-generated client types
├── helpers/             One-off utilities (unique ID generation, etc.)
└── server.ts            Express app entry point
```

## Key Flows

### Mutual Fund Redemption

```
POST /mutual-fund/redeem
{
  "source": "transaction" | "cart",
  "scheme_id": 12345,                    // If from transaction
  "prod_code": "DS651-GR",               // If from cart
  "redem_type": "PARTIAL" | "FULL",
  "redemption_amount": 50000,            // PARTIAL by amount
  "redemption_units": 100,               // PARTIAL by units
  "folio_no": "ABC123XYZ"
}
    ↓
Validate: If PARTIAL, ensure only ONE of (amount, units) provided
    ↓
Resolve product code:
  - If "transaction": Look up DB by scheme_id
  - If "cart": Use prod_code directly
    ↓
Construct Finnsys payload with order_ref_number, bank details
    ↓
POST to Finnsys NSE API (trxn_type: "R")
    ↓
Get transaction order ID
    ↓
Call NSE service to generate OTP link
    ↓
Return link to user
    ↓
User confirms OTP → Fund transfer initiated (6-8 hours)
```

### FD Purchase

```
POST /fd/create-purchase-url
{
  "product_id": "sbi-1y",
  "tenure": 365,
  "payout_frequency": "MONTHLY",
  "investment_amount": 100000,
  "customer_type": "SENIOR_CITIZEN"
}
    ↓
Look up interest rate for (product_id, tenure, payout_frequency, customer_type)
    ↓
Create FdTransaction record with status: PAYMENT_PENDING
    ↓
Encrypt user phone (AES-256-GCM)
    ↓
Call Blostem API with encrypted params
    ↓
Get encrypted payment URL
    ↓
Return URL to frontend
    ↓
User completes payment
    ↓
Blostem sends webhook confirmation
    ↓
Update transaction status: PAYMENT_CONFIRMED
    ↓
If VKYC required, redirect to video verification
    ↓
Send confirmation email
```

### Daily Sync Job

Triggered by Cloud Scheduler every morning at 6 AM IST.

```
POST /jobs/mf-daily
    ↓
For each mutual fund in database:
  1. Call Finnsys API for latest NAV
  2. Calculate returns (1Y, 3Y, 5Y)
  3. Update mfMetrics table
  4. Publish metrics to Redis
    ↓
Invalidate MF list caches
    ↓
Trigger NAV history sync job
    ↓
Send completion webhook to monitoring system
```

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev

# Start development server
npm run dev

# Server runs on http://localhost:8080
```

### Code Standards

- Always use Prisma-generated types (e.g., `MfProductWhereInput`)
- Validate inputs with Zod before service calls
- Use `AppError` for consistent error handling
- Cache large datasets in Redis with explicit TTL
- Log strategically (entry, success, errors)—no debug spam
- Never use `any` type

### Adding a Feature

1. Update `src/prisma/schema.prisma` if DB change needed
2. Create service in `src/services/domain.service.ts`
3. Create controller in `src/controller/domain.controller.ts`
4. Define routes in `src/routes/domain.router.ts`
5. Add routes to main server in `src/server.ts`
6. Test locally
7. Deploy via Cloud Run

## Monitoring

- Logs: Cloud Logging (automatic from logger middleware)
- Metrics: Cloud Monitoring dashboard
- Alerts: Error rate > 5%, latency > 1000ms
- Tracing: Cloud Trace for request analysis