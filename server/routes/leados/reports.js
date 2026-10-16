/**
 * LeadOS routes: Reports.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerReportsRoutes(app, ctx) {
const {
  Clients,
  Leads,
  NO_ID,
  Payments,
  addDays,
  auth,
  dailyLeadBuckets,
  dayKey,
  escapeRegex,
  formatReportDay,
  leadFunnel,
  leadSourceCounts,
  startOfDay,
  sumCapturedPayments,
} = ctx;
// GET /api/reports/summary — dashboard stats
app.get('/api/reports/summary', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const client_id = req.query.client_id;
    const filterBrand = client_id && client_id !== 'all' && client_id !== 'All Brands' && client_id !== 'undefined';
    const brandId = filterBrand ? Number(client_id) : null;
    const brandFilter = filterBrand ? { client_id: brandId } : {};
    const brandLeadIds = filterBrand ? await Leads.distinct('id', brandFilter) : null;
    const countLeads = (filter) => Leads.countDocuments({ ...brandFilter, ...filter });

    if (range === 'custom') {
      const from = req.query.from;
      const to = req.query.to;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
        return res.status(400).json({ error: 'Invalid custom date range' });
      }
      const [fy, fm, fd] = from.split('-').map(Number);
      const [ty, tm, td] = to.split('-').map(Number);
      const fromDay = new Date(fy, fm - 1, fd);
      const toDay = new Date(ty, tm - 1, td);
      const toEnd = addDays(toDay, 1);
      const span = Math.round((toDay - fromDay) / 86400000) + 1;
      const previousFrom = addDays(fromDay, -span);
      const inRange = { $gte: fromDay, $lt: toEnd };

      const [currentLeads, previousLeads, hot, convertedCurrent, convertedPrevious, revenueCurrent, revenuePrevious,
        weekly, sources, funnel, payments, brandClients, brandLeadCounts] = await Promise.all([
        countLeads({ created_at: inRange }),
        countLeads({ created_at: { $gte: previousFrom, $lt: fromDay } }),
        countLeads({ status: 'hot', created_at: inRange }),
        countLeads({ status: 'converted', updated_at: inRange }),
        countLeads({ status: 'converted', updated_at: { $gte: previousFrom, $lt: fromDay } }),
        sumCapturedPayments(fromDay, toEnd, brandLeadIds),
        sumCapturedPayments(previousFrom, fromDay, brandLeadIds),
        dailyLeadBuckets(fromDay, toDay, 'DD Mon', brandFilter),
        leadSourceCounts({ ...brandFilter, created_at: inRange }, 'Other'),
        leadFunnel({ ...brandFilter, created_at: inRange }),
        Payments.find({ status: 'captured', created_at: inRange, ...(brandLeadIds ? { lead_id: { $in: brandLeadIds } } : {}) }, { _id: 0, amount: 1, created_at: 1 }).lean(),
        Clients.find(filterBrand ? { id: brandId } : {}, { _id: 0, id: 1, name: 1 }).lean(),
        Leads.aggregate([{ $match: { ...brandFilter, created_at: inRange } }, { $group: { _id: '$client_id', count: { $sum: 1 } } }]),
      ]);

      const revenueByDay = new Map();
      for (const payment of payments) {
        const key = dayKey(new Date(payment.created_at));
        revenueByDay.set(key, (revenueByDay.get(key) || 0) + Number(payment.amount || 0));
      }
      const revenueTrend = [];
      for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
        revenueTrend.push({ m: formatReportDay(day, 'DD Mon'), r: revenueByDay.get(dayKey(day)) || 0 });
      }
      const leadCountByBrand = new Map(brandLeadCounts.map((row) => [row._id, row.count]));
      const brands = brandClients
        .map((client) => ({ id: client.id, name: client.name, lead_count: leadCountByBrand.get(client.id) || 0 }))
        .sort((a, b) => b.lead_count - a.lead_count);

      return res.json({
        leads_today: currentLeads, leads_yesterday: previousLeads,
        hot_leads: hot, converted_today: convertedCurrent,
        converted_yesterday: convertedPrevious, revenue_month: revenueCurrent,
        revenue_last_month: revenuePrevious, weekly, sources,
        funnel, revenue_trend: revenueTrend, brands,
        date_range: { from, to },
      });
    }

    let days = 30;
    let dateFormat = 'DD Mon';
    if (range === '7d') {
      days = 7;
      dateFormat = 'Dy';
    } else if (range === '90d') {
      days = 90;
      dateFormat = 'DD Mon';
    }

    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const [leadsToday, leadsYesterday, hot, converted, convertedYesterday, revenue, revenueLastMonth, weekly, sources, funnel] = await Promise.all([
      countLeads({ created_at: { $gte: today, $lt: tomorrow } }),
      countLeads({ created_at: { $gte: yesterday, $lt: today } }),
      countLeads({ status: 'hot' }),
      countLeads({ status: 'converted', updated_at: { $gte: today, $lt: tomorrow } }),
      countLeads({ status: 'converted', updated_at: { $gte: yesterday, $lt: today } }),
      sumCapturedPayments(monthStart, nextMonthStart, brandLeadIds),
      sumCapturedPayments(lastMonthStart, monthStart, brandLeadIds),
      dailyLeadBuckets(addDays(today, -(days - 1)), today, dateFormat, brandFilter),
      leadSourceCounts(brandFilter, null),
      leadFunnel(brandFilter),
    ]);

    const revenueTrend = [];
    for (let offset = 5; offset >= 0; offset--) {
      const month = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const nextMonth = new Date(today.getFullYear(), today.getMonth() - offset + 1, 1);
      revenueTrend.push({ m: formatReportDay(month, 'Mon'), r: await sumCapturedPayments(month, nextMonth, brandLeadIds) });
    }

    res.json({
      leads_today: leadsToday,
      leads_yesterday: leadsYesterday,
      hot_leads: hot,
      converted_today: converted,
      converted_yesterday: convertedYesterday,
      revenue_month: revenue,
      revenue_last_month: revenueLastMonth,
      weekly,
      sources,
      funnel,
      revenue_trend: revenueTrend,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports/leads — for reports page
app.get('/api/reports/leads', auth, async (req, res) => {
  try {
    const { from, to, brand } = req.query;
    const filter = {};
    if (from || to) filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
    const reportClients = await Clients.find(
      brand && brand !== 'All Brands' ? { name: { $regex: escapeRegex(brand), $options: 'i' } } : {},
      { id: 1, name: 1 }
    ).lean();
    if (brand && brand !== 'All Brands') filter.client_id = { $in: reportClients.map((c) => c.id) };
    const brandNames = new Map(reportClients.map((c) => [c.id, c.name]));
    const rows = (await Leads.find(filter, NO_ID).sort({ created_at: -1 }).limit(500).lean())
      .map((lead) => ({ ...lead, brand_name: brandNames.get(lead.client_id) ?? null }));
    res.json({ leads: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
};
