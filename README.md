# LexAI LMS Backend

Fastify + Prisma + PostgreSQL API backend for the LexAI learning management system.

## Tech Stack

- **Runtime:** Node.js 22
- **Framework:** Fastify 5
- **ORM:** Prisma 6 (PostgreSQL)
- **Auth:** JWT (cookies) + Google OAuth
- **Payments:** Razorpay
- **Video Hosting:** Gumlet
- **Email:** Resend

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Fill in your secrets in .env

# Set up database
npx prisma migrate dev
npm run db:seed

# Start dev server
npm run dev
```

The server runs at `http://localhost:4000` with Swagger docs at `/docs`.

## Environment Variables

See [`.env.example`](.env.example) for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth credentials |
| `RAZORPAY_KEY_ID/SECRET` | Razorpay payment gateway |
| `GUMLET_API_KEY` | Gumlet video hosting |
| `PLATFORM_PRICE` | Platform price in paise (49900 = ₹499) |

## Database Commands

```bash
npx prisma migrate dev      # Create and apply migrations (dev)
npx prisma migrate deploy   # Apply migrations (production)
npm run db:seed              # Seed with sample data
npx prisma studio            # Open database GUI
```

## Testing

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:verbose    # Verbose output
```

## Docker Deployment

For deploying to a VPS (Ubuntu 22.04):

```bash
# Quick deploy (run on VPS)
bash deploy.sh

# Or manually:
cp .env.example .env
# Edit .env with production values
# Add POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB

docker compose up -d --build
docker compose exec -T app npx prisma migrate deploy
docker compose exec -T app npx tsx prisma/seed.ts  # optional
```

Services:
- **app** — Fastify backend (port 4000, internal)
- **postgres** — PostgreSQL 16 (port 5432, localhost only)
- **nginx** — Reverse proxy (port 80, public)
- **backup** — Daily pg_dump with 30-day retention

Health check: `GET /health/ready`

## Test Accounts (after seeding)

| Role | Email | Password |
|------|-------|----------|
| Platform Admin | admin@lexai.com | admin123456 |
| Institution Admin | admin@demo-university.edu | instadmin123 |
| Premium Student | student@gmail.com | student123 |
