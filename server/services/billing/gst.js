/**
 * GST on plan prices (N7). India charges 18 percent GST on software
 * subscriptions; the rate is added on top of the table price, never hidden in
 * it. Every order and invoice keeps the price, the tax and the total apart.
 * BILLING_GST_PERCENT overrides the rate (not a secret); default 18.
 */
const DEFAULT_RATE_PERCENT = 18;

function ratePercent() {
  const raw = process.env.BILLING_GST_PERCENT;
  if (raw === undefined || raw === '') return DEFAULT_RATE_PERCENT;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_RATE_PERCENT;
}

/** Splits a price in paise into price, GST and total (all whole paise). */
function split(pricePaise, rate = ratePercent()) {
  const price = Number(pricePaise);
  if (!Number.isInteger(price) || price < 0) throw new Error('Price must be a whole number of paise');
  const gst = Math.round((price * rate) / 100);
  return { price_paise: price, gst_rate_percent: rate, gst_paise: gst, total_paise: price + gst };
}

module.exports = { DEFAULT_RATE_PERCENT, ratePercent, split };
