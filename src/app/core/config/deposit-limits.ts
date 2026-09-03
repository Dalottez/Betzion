/**
 * Deposit ceiling shown to the player before a push is attempted.
 *
 * The backend is the authority — it rejects anything above its own
 * MAX_DEPOSIT_AMOUNT — but the browser needs the figure up front so the
 * player gets a warning instead of watching a push start and then fail.
 * The wallet reads the live value from /api/payments/config and falls back
 * to this; keep it in step with MAX_DEPOSIT_AMOUNT in backend/server.js.
 */
export const MAX_DEPOSIT_AMOUNT = 1999;
