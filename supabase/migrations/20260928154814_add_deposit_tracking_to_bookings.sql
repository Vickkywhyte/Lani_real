-- Deposit tracking columns, populated by the stripe-webhook Edge Function
-- after a Stripe checkout.session.completed event confirms a customer's
-- $40 deposit.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_paid boolean DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_paid_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_payment_id text;
