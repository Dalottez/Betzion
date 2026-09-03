const http = require('http');
const https = require('https');

// Keep-Alive HTTP/HTTPS agents to avoid TLS/TCP handshake latency on every STK push request
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 10000,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 60000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 10000,
});

// ─────────────────────────────────────────────────────────────────────────────
// ArchPay REST API v1 integration service (M-Pesa STK Push)
// Docs: https://pay.archietech.app  •  Base: https://pay.archietech.app/api/v1
// ─────────────────────────────────────────────────────────────────────────────
const ARCHPAY_API_BASE = process.env.ARCHPAY_API_BASE || 'https://pay.archietech.app/api/v1';
// The combined key (apk_...) is the primary credential. The public/secret pair
// is ArchPay's documented split-credential alternative and is used
// automatically whenever the combined key is absent.
const ARCHPAY_API_KEY = process.env.ARCHPAY_API_KEY || '';
const ARCHPAY_PUBLIC_KEY = process.env.ARCHPAY_PUBLIC_KEY || '';
const ARCHPAY_SECRET_KEY = process.env.ARCHPAY_SECRET_KEY || '';
// Optional: route payments through a specific Paybill / Till / Bank channel.
// Omitted, ArchPay uses the account's default channel.
const ARCHPAY_CHANNEL_ID = process.env.ARCHPAY_CHANNEL_ID || '';
// ArchPay takes the webhook URL from the dashboard rather than from each
// request, so this value is never transmitted. It is kept so the exact URL to
// paste into ArchPay -> Settings -> Webhook URL (token included) can be
// printed at startup and stays version-controlled next to the code serving it.
const ARCHPAY_CALLBACK_URL = process.env.ARCHPAY_CALLBACK_URL || 'https://api.betzion.site/api/payments/archpay/callback';
// ArchPay does not sign its webhooks, so the shared token carried in the
// webhook URL's query string is the only proof a callback really came from
// ArchPay. It is required: without it, anyone who guessed a reference could
// credit a wallet.
const ARCHPAY_CALLBACK_TOKEN = process.env.ARCHPAY_CALLBACK_TOKEN || '';

// Reference shown on the customer's M-Pesa statement. ArchPay caps it at 12
// characters and the description at 20.
const ACCOUNT_REFERENCE_MAX_LENGTH = 12;
const DESCRIPTION_MAX_LENGTH = 20;

const ARCHPAY_HOSTNAME = (() => {
  try {
    return new URL(ARCHPAY_API_BASE).hostname;
  } catch {
    return 'pay.archietech.app';
  }
})();

// Pre-warm the TCP/TLS connection to ArchPay so the first and every recurring
// request carries zero handshake overhead.
function prewarmArchPayConnection() {
  try {
    const req = https.request({
      hostname: ARCHPAY_HOSTNAME,
      port: 443,
      path: '/health',
      method: 'GET',
      agent: httpsAgent,
      timeout: 5000,
    }, (res) => {
      res.resume(); // Discard data to release the socket to the keep-alive pool
    });
    req.on('error', () => {});
    req.end();
  } catch (e) {}
}

// Keep connection warm every 25 seconds
setInterval(prewarmArchPayConnection, 25000).unref();
setTimeout(prewarmArchPayConnection, 1000).unref();

function archPayUrl(endpoint) {
  return new URL(`${ARCHPAY_API_BASE.replace(/\/+$/, '')}${endpoint}`);
}

function hasCredentials() {
  return Boolean(ARCHPAY_API_KEY || (ARCHPAY_PUBLIC_KEY && ARCHPAY_SECRET_KEY));
}

function isConfigured() {
  return Boolean(hasCredentials() && ARCHPAY_CALLBACK_URL && ARCHPAY_CALLBACK_TOKEN);
}

function getConfigurationError() {
  if (!hasCredentials()) {
    return 'ArchPay authentication is not configured. Set ARCHPAY_API_KEY (or ARCHPAY_PUBLIC_KEY + ARCHPAY_SECRET_KEY).';
  }
  if (!ARCHPAY_CALLBACK_URL) return 'ARCHPAY_CALLBACK_URL is not configured.';
  if (!ARCHPAY_CALLBACK_TOKEN) return 'ARCHPAY_CALLBACK_TOKEN is not configured.';
  return null;
}

/**
 * The full webhook URL, token included, to register in the ArchPay dashboard.
 * ArchPay has no per-request callback field, so this is configured once there
 * instead of being sent with each STK push.
 */
function getCallbackUrl() {
  if (!ARCHPAY_CALLBACK_URL) return '';
  try {
    const callbackUrl = new URL(ARCHPAY_CALLBACK_URL);
    if (ARCHPAY_CALLBACK_TOKEN) callbackUrl.searchParams.set('token', ARCHPAY_CALLBACK_TOKEN);
    return callbackUrl.toString();
  } catch {
    return ARCHPAY_CALLBACK_URL;
  }
}

/**
 * Normalize a Kenyan mobile number to the 254XXXXXXXXX form ArchPay requires
 * (12 digits, leading 254).
 */
function formatArchPayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;
  return digits;
}

/**
 * Authentication headers for the ArchPay API. The combined API key wins; the
 * public/secret pair is the documented split-credential fallback.
 */
function getAuthHeaders() {
  if (ARCHPAY_API_KEY) {
    return { 'x-api-key': ARCHPAY_API_KEY };
  }
  return {
    'x-public-key': ARCHPAY_PUBLIC_KEY,
    'x-secret-key': ARCHPAY_SECRET_KEY,
  };
}

/**
 * Send an HTTP request to the ArchPay API.
 */
function archPayRequest(method, endpoint, bodyData) {
  return new Promise((resolve, reject) => {
    const url = archPayUrl(endpoint);
    const postData = bodyData === undefined ? null : JSON.stringify(bodyData);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      agent: url.protocol === 'https:' ? httpsAgent : httpAgent,
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
      timeout: 10000,
    };

    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ArchPay API request timed out'));
    });

    if (postData) req.write(postData);
    req.end();
  });
}

function archPayPost(endpoint, bodyData) {
  return archPayRequest('POST', endpoint, bodyData);
}

function archPayGet(endpoint) {
  return archPayRequest('GET', endpoint).catch((err) => ({ statusCode: 500, error: err.message }));
}

// ArchPay error codes that mean the STK push definitively never reached the
// customer. These must fail the deposit immediately rather than leave it
// pending, because no webhook will ever arrive for them.
const DEFINITIVE_ERROR_CODES = new Set([
  'MISSING_FIELDS',
  'INVALID_PHONE',
  'INVALID_AMOUNT',
  'UNAUTHORIZED',
  'ACCOUNT_DISABLED',
  'INSUFFICIENT_CREDITS',
  'CHANNEL_NOT_FOUND',
  'CHANNEL_INACTIVE',
  'B2C_DISABLED',
  'MPESA_ERROR',
]);

// Codes describing an ArchPay-side outage rather than a bad request. The
// deposit still fails (nothing was sent), but the player sees the
// "temporarily unavailable" wording instead of a validation message.
const UNAVAILABLE_ERROR_CODES = new Set(['SERVICE_UNAVAILABLE']);

/**
 * Initiate an STK Push payment via the ArchPay API.
 * Docs: POST https://pay.archietech.app/api/v1/stkpush
 */
async function initiateSTKPush({ amount, phone, reference, customerName, channelId, description }) {
  const configurationError = getConfigurationError();
  if (configurationError || !isConfigured()) {
    return { success: false, configurationError: true, message: configurationError || 'ArchPay is not configured for live payments.' };
  }

  const phoneFormatted = formatArchPayPhone(phone);
  if (!/^254\d{9}$/.test(phoneFormatted)) {
    return { success: false, message: 'A valid Safaricom number is required (2547XXXXXXXX).' };
  }

  // ArchPay requires a whole-number amount of at least 1 KES.
  const amountValue = Math.round(Number(amount));
  if (!Number.isFinite(amountValue) || amountValue < 1) {
    return { success: false, message: 'Deposit amount must be a whole number of at least KES 1.' };
  }

  const payload = {
    phone: phoneFormatted,
    amount: amountValue,
    // ArchPay caps this at 12 characters and prints it on the customer's
    // M-Pesa statement. Our own full reference stays on the transaction and is
    // echoed back on the webhook as accountReference.
    accountReference: String(reference).slice(0, ACCOUNT_REFERENCE_MAX_LENGTH),
    description: String(description || customerName || 'Deposit').slice(0, DESCRIPTION_MAX_LENGTH),
  };

  const activeChannelId = channelId || ARCHPAY_CHANNEL_ID;
  if (activeChannelId) {
    payload.channelId = String(activeChannelId);
  }

  try {
    console.log('ArchPay STK Push request:', {
      amount: payload.amount,
      phone: `***${phoneFormatted.slice(-4)}`,
      channelId: payload.channelId || 'default',
      reference: payload.accountReference,
    });

    const res = await archPayPost('/stkpush', payload);
    const body = res?.data || {};

    console.log(`ArchPay STK Push response: HTTP ${res?.statusCode}`, {
      success: body?.success ?? null,
      code: body?.code || null,
      checkoutRequestId: body?.checkoutRequestId || null,
      creditsRemaining: body?.creditsRemaining ?? null,
    });

    if (res && (res.statusCode === 200 || res.statusCode === 201) && body.success !== false) {
      const checkoutRequestId = body.checkoutRequestId || body.CheckoutRequestID || body.checkout_request_id || reference;
      return {
        success: true,
        status: 'PENDING',
        checkoutRequestId,
        // ArchPay verifies strictly by checkoutRequestId, so that doubles as
        // the provider reference we poll with. `externalReference` remains our
        // own application reference, used for webhook matching.
        reference: checkoutRequestId,
        externalReference: reference,
        merchantRequestId: body.merchantRequestId || null,
        creditsRemaining: body.creditsRemaining ?? null,
        message: body.message || 'STK Push sent successfully. Check your phone to enter M-Pesa PIN.',
        data: body,
      };
    }

    const code = String(body.code || '').toUpperCase();
    const isDefinitive = DEFINITIVE_ERROR_CODES.has(code) ||
      UNAVAILABLE_ERROR_CODES.has(code) ||
      (res && res.statusCode >= 400 && res.statusCode < 500);

    return {
      success: false,
      code: code || null,
      // Anything ArchPay answered explicitly means the push was not sent, so
      // the deposit can fail right away. Only an unclassifiable 5xx stays
      // retryable, where a push may in fact have gone out.
      retryable: !isDefinitive,
      configurationError: code === 'UNAUTHORIZED' || UNAVAILABLE_ERROR_CODES.has(code),
      message: body.error || body.message || `ArchPay returned HTTP ${res?.statusCode}`,
      data: body,
    };
  } catch (err) {
    console.error('ArchPay STK Push connection failed:', err.message);
    return {
      success: false,
      retryable: true,
      message: err.message || 'Failed to connect to the ArchPay payment gateway',
    };
  }
}

/**
 * Ask ArchPay for the live status of one STK push.
 * Docs: POST https://pay.archietech.app/api/v1/verify { checkoutRequestId }
 */
async function checkSTKPushStatusForCheckoutId(checkoutRequestId) {
  try {
    const res = await archPayPost('/verify', { checkoutRequestId });
    const data = res?.data || {};
    let responseObj = data.transaction || data.data || data;
    if (Array.isArray(responseObj)) {
      responseObj = responseObj[0] || {};
    }

    const rawStatus = (
      responseObj.status ||
      responseObj.Status ||
      data.status ||
      ''
    ).toString().toUpperCase();

    const receiptNumber =
      responseObj.mpesaReceiptNumber ||
      responseObj.mpesa_receipt_number ||
      responseObj.MpesaReceiptNumber ||
      data.mpesaReceiptNumber ||
      data.mpesa_receipt_number ||
      null;

    // ArchPay's `success` flag reports whether the verify call itself worked;
    // it is not proof the customer approved the STK prompt. Only an explicit
    // final payment status may credit or fail a deposit.
    const isSuccess = rawStatus === 'COMPLETED';
    const isFailed = ['FAILED', 'CANCELLED', 'CANCELED', 'TIMEOUT', 'EXPIRED', 'REJECTED'].includes(rawStatus);

    if (isSuccess || isFailed) {
      return {
        checked: true,
        isSuccess: Boolean(isSuccess),
        isFailed: Boolean(!isSuccess && isFailed),
        status: isSuccess ? 'COMPLETED' : 'FAILED',
        receiptNumber: receiptNumber || null,
        amount: responseObj.amount ?? responseObj.Amount ?? data.amount ?? null,
        reason: responseObj.resultDesc || responseObj.message || data.error || data.message || null,
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function checkSTKPushStatus({ reference, checkoutRequestId, externalReference }) {
  if (!isConfigured()) return null;

  // /verify is keyed on checkoutRequestId, but a transaction saved before the
  // push was acknowledged can still carry our own reference in that slot.
  // Probe each distinct candidate so a delayed webhook cannot leave an
  // otherwise-final payment stuck as pending.
  const candidates = [...new Set([checkoutRequestId, reference, externalReference]
    .map((value) => String(value || '').trim())
    .filter(Boolean))];

  for (const candidate of candidates) {
    const result = await checkSTKPushStatusForCheckoutId(candidate);
    if (result) return result;
  }
  return null;
}

/**
 * Payment channels (Paybill / Till / Bank) configured on the ArchPay account.
 * Docs: GET https://pay.archietech.app/api/v1/channels
 */
async function listChannels() {
  if (!hasCredentials()) return { success: false, channels: [], message: 'ArchPay credentials are not configured.' };
  const res = await archPayGet('/channels');
  const body = res?.data || {};
  return {
    success: Boolean(body.success),
    channels: Array.isArray(body.channels) ? body.channels : [],
    message: body.error || body.message || null,
  };
}

/**
 * Remaining STK push credits on the ArchPay account. Each successful push
 * consumes one, so a zero balance stops deposits with INSUFFICIENT_CREDITS.
 * Docs: GET https://pay.archietech.app/api/v1/balance
 */
async function getBalance() {
  if (!hasCredentials()) return { success: false, credits: null, message: 'ArchPay credentials are not configured.' };
  const res = await archPayGet('/balance');
  const body = res?.data || {};
  return {
    success: Boolean(body.success),
    credits: body.credits ?? null,
    businessName: body.businessName || null,
    message: body.error || body.message || null,
  };
}

module.exports = {
  isConfigured,
  getConfigurationError,
  getCallbackUrl,
  initiateSTKPush,
  checkSTKPushStatus,
  listChannels,
  getBalance,
  ACCOUNT_REFERENCE_MAX_LENGTH,
};
