// ─────────────────────────────────────────────────────────────────────────
// notify-booking — Supabase Edge Function
//
// Called after a new row lands in `bookings` (customer_name, customer_email,
// customer_phone, service, date, time_slot). It does two things:
//   1. Notifies the salon owner via Formspree (unchanged from before).
//   2. Emails the customer a booking confirmation via Resend (new).
//
// ── SET UP RESEND BEFORE DEPLOYING ──
//   1. Create a free account at https://resend.com
//   2. Get your API key from the Resend dashboard
//   3. Set it as a Supabase secret:
//        supabase secrets set RESEND_API_KEY=re_xxxxxxxxx --project-ref roxbhzmdawiaxixeuhob
//   4. lanistylez.com is now verified in Resend, so emails send from
//      Lani Stylez <bookings@lanistylez.com> and deliver to any customer
//      — no more sandbox restriction to the account owner's own inbox.
// ─────────────────────────────────────────────────────────────────────────

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xzdqznbw';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

const GOLD = '#B8924A';
const DARK = '#0f0f0f';
const LIGHT = '#F7F3EE';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BookingPayload {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  service: string;
  date: string;      // 'YYYY-MM-DD'
  time_slot: string;  // e.g. '9:00 AM'
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

function buildConfirmationEmailHtml(booking: BookingPayload): string {
  const firstName = escapeHtml((booking.customer_name || '').trim().split(' ')[0] || 'there');
  const service = escapeHtml(booking.service || '');
  const dateFormatted = formatDate(booking.date);
  const time = escapeHtml(booking.time_slot || '');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Booking Received — Lani Stylez</title>
</head>
<body style="margin:0; padding:0; background:${LIGHT}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT}; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background:#ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 18px rgba(0,0,0,.06);">

          <!-- Header -->
          <tr>
            <td style="background:${DARK}; padding: 32px 32px 28px; text-align:center;">
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; letter-spacing: .08em; color:#ffffff; margin-bottom: 4px;">
                Lani <span style="color:${GOLD};">Stylez</span>
              </div>
              <div style="color: rgba(255,255,255,.55); font-size: 11px; letter-spacing: .15em; text-transform: uppercase;">
                Hamilton's Premier Hair Styling Experience
              </div>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 8px;">
              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 24px; color:${DARK}; margin: 0 0 12px;">
                Thank You, ${firstName}!
              </h1>
              <p style="font-size: 15px; line-height: 1.6; color:#2C2C2C; margin: 0 0 24px;">
                Your booking request has been received. Here are your details:
              </p>
            </td>
          </tr>

          <!-- Booking details card -->
          <tr>
            <td style="padding: 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${LIGHT}; border-radius: 8px; padding: 4px 0;">
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(0,0,0,.06);">
                    <span style="font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color:#888;">Service(s)</span><br/>
                    <span style="font-size: 15px; color:${DARK}; font-weight: 600;">${service}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px; border-bottom: 1px solid rgba(0,0,0,.06);">
                    <span style="font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color:#888;">Date</span><br/>
                    <span style="font-size: 15px; color:${DARK}; font-weight: 600;">${dateFormatted}</span>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 14px 20px;">
                    <span style="font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color:#888;">Time</span><br/>
                    <span style="font-size: 15px; color:${DARK}; font-weight: 600;">${time}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Deposit section -->
          <tr>
            <td style="padding: 28px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left: 3px solid ${GOLD}; background: rgba(184,146,74,0.06); border-radius: 8px;">
                <tr>
                  <td style="padding: 20px 24px;">
                    <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; color:${GOLD}; margin: 0 0 10px;">
                      Secure Your Appointment
                    </h2>
                    <p style="font-size: 14px; line-height: 1.6; color:#2C2C2C; margin: 0 0 16px;">
                      A $40 deposit is required to confirm your booking.
                    </p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius: 6px; margin-bottom: 10px;">
                      <tr>
                        <td style="padding: 14px 16px;">
                          <p style="margin: 0 0 6px; font-size: 14px; color:${DARK};">💳 <strong>Pay Online (Stripe)</strong></p>
                          <a href="https://buy.stripe.com/28E4gBbkR9u66FcfSw6kg00" target="_blank"
                             style="display:inline-block; background:${GOLD}; color:#ffffff; text-decoration:none; padding: 10px 22px; border-radius: 5px; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; margin-top: 4px;">
                            Pay $40 Deposit
                          </a>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius: 6px; margin-bottom: 14px;">
                      <tr>
                        <td style="padding: 14px 16px;">
                          <p style="margin: 0 0 4px; font-size: 14px; color:${DARK};">🏦 <strong>Interac e-Transfer</strong></p>
                          <p style="margin: 0; font-size: 13.5px; color:#555;">Send $40 to <strong>lanistylez2@gmail.com</strong></p>
                        </td>
                      </tr>
                    </table>

                    <p style="font-size: 13px; color:#8a6a30; font-style: italic; margin: 0;">
                      Your appointment is not confirmed until the deposit is received.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Visit Us / Get In Touch -->
          <tr>
            <td style="padding: 24px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${DARK}; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px 28px;">
                    <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 17px; color:${GOLD}; margin: 0 0 12px;">Visit Us at Our Upper James Street Studio ✨</h2>
                    <p style="font-size: 14px; line-height: 1.7; color:${LIGHT}; margin: 0 0 6px;">📍 550 Upper James Street, Hamilton, ON</p>
                    <p style="font-size: 14px; line-height: 1.7; color:${LIGHT}; margin: 0 0 10px;">Your beauty experience awaits. 🤍</p>
                    <p style="font-size: 13px; line-height: 1.7; color: rgba(247,243,238,.65); margin: 0 0 20px;">Planning your visit? Free parking is conveniently available around the area, with our name on the sign — making your appointment experience as seamless as possible.</p>

                    <h3 style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color:${GOLD}; margin: 0 0 10px; padding-top: 18px; border-top: 1px solid rgba(184,146,74,.25);">Let's Get You Booked 💌</h3>
                    <p style="font-size: 14px; line-height: 1.7; color:${LIGHT}; margin: 0 0 10px;">Have a question or ready to reserve your next appointment? We're just a message away.</p>
                    <p style="font-size: 14px; line-height: 1.7; color:${LIGHT}; margin: 0 0 4px;">📞 Call or Text: <strong style="color:${GOLD};">+1 416 473-4578</strong></p>
                    <p style="font-size: 14px; line-height: 1.7; color:${LIGHT}; margin: 0;">📧 Email: <strong style="color:${GOLD};">lanistylez2@gmail.com</strong></p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Policy reminders -->
          <tr>
            <td style="padding: 24px 32px 8px;">
              <p style="font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color:#888; margin: 0 0 10px;">Good to Know</p>
              <p style="font-size: 13.5px; line-height: 1.7; color:#555; margin: 0;">
                ✦ 24-hour cancellation notice required for deposit refund<br/>
                ✦ Late arrivals may result in shortened service time
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:${DARK}; padding: 24px 32px; text-align:center; margin-top: 24px;">
              <div style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; color:#ffffff; margin-bottom: 6px;">
                Lani <span style="color:${GOLD};">Stylez</span>
              </div>
              <div style="font-size: 12.5px; color: rgba(255,255,255,.5); line-height: 1.7;">
                550 Upper James Street, Hamilton, ON<br/>
                +1 416 473-4578
              </div>
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

async function notifyOwnerViaFormspree(booking: BookingPayload): Promise<void> {
  await fetch(FORMSPREE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      _subject: 'New Booking Request — Lani Stylez',
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      customer_phone: booking.customer_phone,
      service: booking.service,
      date: booking.date,
      time_slot: booking.time_slot,
    }),
  });
}

async function sendCustomerConfirmationEmail(booking: BookingPayload): Promise<void> {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY is not set — skipping customer confirmation email.');
    return;
  }
  if (!booking.customer_email) {
    console.error('Booking has no customer_email — skipping customer confirmation email.');
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Lani Stylez <bookings@lanistylez.com>',
      to: [booking.customer_email],
      subject: 'Booking Received — Lani Stylez',
      html: buildConfirmationEmailHtml(booking),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API responded ${res.status}: ${body}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const booking: BookingPayload = await req.json();

    // 1. Notify the salon owner — unchanged, existing behavior.
    await notifyOwnerViaFormspree(booking);

    // 2. Email the customer a confirmation via Resend. This must never take
    //    down the response if it fails — the owner notification above has
    //    already succeeded and shouldn't be reported as a failure because
    //    of an unrelated email-provider issue.
    try {
      await sendCustomerConfirmationEmail(booking);
    } catch (emailErr) {
      console.error('Failed to send customer confirmation email via Resend:', emailErr);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('notify-booking error:', err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Deploy:
//   supabase functions deploy notify-booking --project-ref roxbhzmdawiaxixeuhob
// ─────────────────────────────────────────────────────────────────────────
