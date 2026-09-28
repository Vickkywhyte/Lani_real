// ─────────────────────────────────────────────────────────────────────────
// stripe-webhook — Supabase Edge Function
//
// Stripe calls this after a deposit checkout completes. It verifies the
// webhook signature, marks the matching `bookings` row as deposit_paid,
// and emails Deborah a "Deposit Received" notification via Resend.
//
// ── SET UP BEFORE THIS WORKS ──
//   1. Deploy this function first (see the deploy command at the bottom of
//      this file).
//   2. In the Stripe Dashboard: Developers -> Webhooks -> Add endpoint,
//      using this function's URL —
//        https://roxbhzmdawiaxixeuhob.supabase.co/functions/v1/stripe-webhook
//      — and select the "checkout.session.completed" event.
//   3. Copy that endpoint's "Signing secret" (starts with whsec_) and set it:
//        supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxx --project-ref roxbhzmdawiaxixeuhob
//   4. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY need no setup — Supabase
//      injects them into every Edge Function automatically.
//   5. RESEND_API_KEY must already be set (same secret notify-booking uses).
//   6. Run the migration that adds the deposit columns, then deploy:
//        supabase db push --project-ref roxbhzmdawiaxixeuhob
//        supabase functions deploy stripe-webhook --project-ref roxbhzmdawiaxixeuhob
// ─────────────────────────────────────────────────────────────────────────

import { createClient } from 'npm:@supabase/supabase-js@2';

const GOLD = '#B8924A';
const DARK = '#0f0f0f';
const LIGHT = '#F7F3EE';

const OWNER_NOTIFICATION_EMAIL = 'lanistylez2@gmail.com';
const DEPOSIT_AMOUNT_FALLBACK = '$40 CAD';

interface BookingRow {
  id: string;
  customer_name: string;
  customer_email: string;
  service: string;
  date: string;
  time_slot: string;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ── Stripe signature verification (no Stripe SDK needed — just the
   webhook signing secret, per Stripe's documented HMAC scheme) ── */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  let timestamp = '';
  const v1Signatures: string[] = [];
  for (const part of sigHeader.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't') timestamp = value;
    else if (key === 'v1' && value) v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return v1Signatures.some(sig => timingSafeEqual(sig, expected));
}

/* ── Booking lookup + update ── */

async function updateBookingDeposit(bookingId: string, paymentIntentId: string): Promise<BookingRow | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data, error } = await supabase
    .from('bookings')
    .update({
      deposit_paid: true,
      deposit_paid_at: new Date().toISOString(),
      stripe_payment_id: paymentIntentId || null,
    })
    .eq('id', bookingId)
    .select('id, customer_name, customer_email, service, date, time_slot')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* ── Owner notification email ── */

function detailRow(label: string, valueHtml: string, isLast = false): string {
  return `
    <tr>
      <td style="padding: 14px 20px; ${isLast ? '' : 'border-bottom: 1px solid rgba(0,0,0,.06);'}">
        <span style="font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color:#888;">${label}</span><br/>
        <span style="font-size: 15px; color:${DARK}; font-weight: 600;">${valueHtml}</span>
      </td>
    </tr>`;
}

const MISSING = '<span style="color:#999; font-weight: 400;">Not available</span>';

function buildDepositNotificationHtml(params: {
  customerName: string;
  customerEmail: string;
  service: string;
  dateFormatted: string;
  time: string;
  amount: string;
  paymentIntentId: string;
  bookingFound: boolean;
}): string {
  const { customerName, customerEmail, service, dateFormatted, time, amount, paymentIntentId, bookingFound } = params;

  const introText = bookingFound
    ? 'A $40 deposit has been received via Stripe for the appointment below.'
    : 'A $40 deposit has been received via Stripe, but it could not be automatically matched to a booking — please check manually using the details below.';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deposit Received — Lani Stylez</title>
</head>
<body style="margin:0; padding:0; background:${LIGHT}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT}; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background:#ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 18px rgba(0,0,0,.06);">

          <!-- Header -->
          <tr>
            <td style="background:${DARK}; padding: 28px 32px; text-align:center;">
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; letter-spacing: .08em; color:#ffffff;">
                Lani <span style="color:${GOLD};">Stylez</span>
              </div>
              <div style="color: rgba(255,255,255,.55); font-size: 11px; letter-spacing: .15em; text-transform: uppercase; margin-top: 4px;">
                Deposit Notification
              </div>
            </td>
          </tr>

          <!-- Intro -->
          <tr>
            <td style="padding: 32px 32px 8px;">
              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; color:${GOLD}; margin: 0 0 10px;">
                💰 Deposit Received
              </h1>
              <p style="font-size: 14px; line-height: 1.6; color:#2C2C2C; margin: 0 0 24px;">
                ${introText}
              </p>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td style="padding: 0 32px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT}; border-radius: 8px;">
                ${detailRow('Customer', customerName ? escapeHtml(customerName) : MISSING)}
                ${detailRow('Email', customerEmail ? escapeHtml(customerEmail) : MISSING)}
                ${detailRow('Service(s)', service ? escapeHtml(service) : MISSING)}
                ${detailRow('Date', dateFormatted || MISSING)}
                ${detailRow('Time', time || MISSING)}
                ${detailRow('Amount Paid', escapeHtml(amount))}
                ${detailRow(
                  'Stripe Payment ID',
                  paymentIntentId
                    ? `<span style="font-family: 'SFMono-Regular', Consolas, monospace; font-size: 12.5px; font-weight: 500;">${escapeHtml(paymentIntentId)}</span>`
                    : MISSING,
                  true,
                )}
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${DARK}; padding: 20px 32px; text-align:center;">
              <div style="font-size: 12px; color: rgba(255,255,255,.4);">Lani Stylez Booking System</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

async function sendDepositNotificationEmail(
  // deno-lint-ignore no-explicit-any
  session: any,
  booking: BookingRow | null,
  customerEmail: string,
  paymentIntentId: string,
): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('RESEND_API_KEY is not set — skipping deposit notification email.');
    return;
  }

  const customerName = booking?.customer_name || session.customer_details?.name || '';
  const displayName = customerName || customerEmail || 'Unknown customer';
  const amount = typeof session.amount_total === 'number'
    ? `$${(session.amount_total / 100).toFixed(2)} ${(session.currency || 'cad').toUpperCase()}`
    : DEPOSIT_AMOUNT_FALLBACK;

  const html = buildDepositNotificationHtml({
    customerName,
    customerEmail,
    service: booking?.service || '',
    dateFormatted: booking?.date ? formatDate(booking.date) : '',
    time: booking?.time_slot || '',
    amount,
    paymentIntentId,
    bookingFound: !!booking,
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lani Stylez <bookings@lanistylez.com>',
      to: [OWNER_NOTIFICATION_EMAIL],
      subject: `💰 Deposit Received — ${displayName}`,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API responded ${res.status}: ${body}`);
  }
}

/* ── Event handling ── */

// deno-lint-ignore no-explicit-any
async function handleCheckoutSessionCompleted(session: any): Promise<void> {
  const customerEmail: string = session.customer_details?.email || session.customer_email || '';
  const bookingId: string | null = session.client_reference_id || null;
  const paymentIntentId: string = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || '';

  let booking: BookingRow | null = null;

  if (bookingId) {
    try {
      booking = await updateBookingDeposit(bookingId, paymentIntentId);
      if (!booking) {
        console.error(`No booking row found for id ${bookingId} — notifying with Stripe session data only.`);
      }
    } catch (err) {
      console.error(`Failed to update booking ${bookingId}:`, err);
    }
  } else {
    console.error('checkout.session.completed has no client_reference_id — notifying with Stripe session data only.');
  }

  try {
    await sendDepositNotificationEmail(session, booking, customerEmail, paymentIntentId);
  } catch (err) {
    console.error('Failed to send deposit notification email:', err);
  }
}

/* ── HTTP entrypoint ── */

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set.');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    console.error('Missing Stripe-Signature header.');
    return new Response(JSON.stringify({ error: 'Missing signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Signature verification needs the exact raw bytes Stripe signed, so the
  // body is read as text once — never re-serialized — before parsing.
  const rawBody = await req.text();

  const isValid = await verifyStripeSignature(rawBody, signature, webhookSecret);
  if (!isValid) {
    console.error('Stripe signature verification failed.');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    console.error('Failed to parse webhook body as JSON:', err);
    return new Response(JSON.stringify({ error: 'Invalid payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Past this point the event is verified and well-formed. Every failure
  // from here on is only logged — Stripe retries on non-2xx responses, and
  // we don't want it endlessly retrying a payment that already succeeded.
  if (event.type === 'checkout.session.completed') {
    try {
      await handleCheckoutSessionCompleted(event.data.object);
    } catch (err) {
      console.error('Unhandled error processing checkout.session.completed:', err);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Deploy:
//   supabase db push --project-ref roxbhzmdawiaxixeuhob
//   supabase functions deploy stripe-webhook --project-ref roxbhzmdawiaxixeuhob
// ─────────────────────────────────────────────────────────────────────────
