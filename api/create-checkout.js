// api/create-checkout.js
// FIX: use CommonJS (module.exports) not ESM (export default)
// because package.json has no "type":"module"
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    // FIX: destructure ALL fields the frontend sends (postcode + deliveryType were ignored before)
    const { items, delivery, postcode, address, deliveryType } = req.body;

    // ── Validation ──────────────────────────────────────────────
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty' });
    }
    if (!postcode || !postcode.trim()) {
      return res.status(400).json({ error: 'Postcode is required' });
    }
    if (!address || !address.trim()) {
      return res.status(400).json({ error: 'Delivery address is required' });
    }

    // ── Build Stripe line items ──────────────────────────────────
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'gbp',
        product_data: {
          name: item.name,
          description: `Handmade Middle Eastern dessert from Mimas Desserts`,
        },
        unit_amount: Math.round(item.price * 100), // pence
      },
      quantity: item.quantity,
    }));

    if (delivery > 0) {
      const deliveryLabel =
        deliveryType === 'local' ? 'Local Delivery (15–45 min)' :
        deliveryType === 'uk'    ? 'UK Nationwide Delivery (1–5 days)' :
        'Delivery Fee';

      lineItems.push({
        price_data: {
          currency: 'gbp',
          product_data: { name: deliveryLabel },
          unit_amount: Math.round(delivery * 100),
        },
        quantity: 1,
      });
    }

    // ── Human-readable order summary for metadata ────────────────
    const orderSummary = items
      .map(i => `${i.name} x${i.quantity} (£${(i.price * i.quantity).toFixed(2)})`)
      .join(' | ');

    const siteUrl = process.env.SITE_URL || 'https://mimas.uk.com';

    // ── Create Stripe Checkout Session ───────────────────────────
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${siteUrl}/success.html`,
      cancel_url:  `${siteUrl}/cancel.html`,
      // Let Stripe collect shipping address for UK delivery
      ...(deliveryType === 'uk' && {
        shipping_address_collection: { allowed_countries: ['GB'] },
      }),
      // Store full order details so they appear in the Stripe Dashboard
      metadata: {
        postcode,
        delivery_address: address.substring(0, 500), // Stripe metadata limit: 500 chars per value
        delivery_type: deliveryType || 'unknown',
        delivery_cost: `£${Number(delivery).toFixed(2)}`,
        order_items: orderSummary.substring(0, 500),
        order_source: 'website',
      },
      // Creates a customer record in Stripe for repeat orders
      customer_creation: 'always',
    });

    // ── Notify shop owner by email ───────────────────────────────
    // Set NOTIFY_EMAIL + GMAIL_USER + GMAIL_APP_PASSWORD in Vercel env vars
    // Generate a Gmail App Password at: https://myaccount.google.com/apppasswords
    if (process.env.NOTIFY_EMAIL && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
      try {
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        const total    = subtotal + Number(delivery);

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });

        const itemRows = items
          .map(i => `<tr>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;">${i.name}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;">${i.quantity}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">£${(i.price * i.quantity).toFixed(2)}</td>
          </tr>`)
          .join('');

        await transporter.sendMail({
          from: `"Mimas Desserts" <${process.env.GMAIL_USER}>`,
          to:   process.env.NOTIFY_EMAIL,
          subject: `🧁 New Order – £${total.toFixed(2)} – ${postcode}`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#0b3d2e;padding:20px;text-align:center;">
                <h1 style="color:#d4af37;margin:0;">🧁 New Order!</h1>
              </div>
              <div style="padding:20px;background:#f9f9f9;">
                <table style="width:100%;border-collapse:collapse;">
                  <thead>
                    <tr style="background:#0b3d2e;color:white;">
                      <th style="padding:8px 12px;text-align:left;">Item</th>
                      <th style="padding:8px 12px;text-align:center;">Qty</th>
                      <th style="padding:8px 12px;text-align:right;">Price</th>
                    </tr>
                  </thead>
                  <tbody>${itemRows}</tbody>
                </table>

                <table style="width:100%;margin-top:16px;">
                  <tr>
                    <td style="padding:4px 0;"><strong>Delivery:</strong></td>
                    <td style="text-align:right;">${deliveryType === 'local' ? 'Local (15–45 min)' : deliveryType === 'uk' ? 'UK Nationwide' : 'Click & Collect'} — £${Number(delivery).toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td style="padding:4px 0;"><strong>Total:</strong></td>
                    <td style="text-align:right;color:#0b3d2e;font-size:18px;font-weight:bold;">£${total.toFixed(2)}</td>
                  </tr>
                </table>

                <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">

                <p><strong>📍 Postcode:</strong> ${postcode}</p>
                <p><strong>🏠 Address:</strong><br>${address}</p>

                <hr style="margin:20px 0;border:none;border-top:1px solid #ddd;">
                <p style="color:#888;font-size:13px;">
                  Payment is pending completion via Stripe.<br>
                  View order in <a href="https://dashboard.stripe.com" style="color:#0b3d2e;">Stripe Dashboard</a>.
                </p>
              </div>
            </div>
          `,
        });
      } catch (emailErr) {
        // Don't fail the checkout if email fails — just log it
        console.error('Email notification failed:', emailErr.message);
      }
    }

    // Return the Stripe-hosted checkout URL
    return res.status(200).json({ url: session.url });

  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message });
  }
};
