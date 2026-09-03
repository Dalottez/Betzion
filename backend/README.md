# Betzion Backend

Sanitized Node.js backend source for the Aviator game: authentication, the
round engine, Socket.IO updates, player presence, admin endpoints, predictor
data, and optional MongoDB persistence.

Payment gateways, deposit/withdrawal routes, callbacks, webhooks, provider
polling, transaction emails, production data, seed credentials, and deployment
files are intentionally excluded.

## Setup

1. Copy `.env.example` to `.env` and set a long, random `JWT_SECRET`.
2. Optionally set `MONGODB_URI` and `MONGODB_DB_NAME` for persistence.
3. To bootstrap an administrator on a new database, set `SEED_ADMIN_PHONE` and
   `SEED_ADMIN_PASSWORD` before the first start. Do not commit these values.
4. Run `npm install`, then `npm start`.

The API starts on port `3022` by default.
