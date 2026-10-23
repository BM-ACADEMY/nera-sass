/**
 * LeadOS routes: Lead import from CSV/Excel.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
const { currentTenantId } = require('../../services/tenantContext');
const { postToN8n } = require('../../services/n8n');
module.exports = function registerLeadsImportRoutes(app, ctx) {
const {
  CampaignImportRecipients,
  Clients,
  Leads,
  Templates,
  Users,
  auth,
  axios,
  fs,
  getLeadOSBrand,
  getTemplateVariableNumbers,
  ieq,
  phoneTailRegex,
  upload,
  xlsx,
} = ctx;
app.post('/api/leads/import', auth, upload.single('file'), async (req, res) => {
  try {
    const { client_id } = req.body;
    const leadOSBrand = await getLeadOSBrand();
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    const isCampaignBatch = String(req.body.force_source || '').startsWith('csv_');

    if (isCampaignBatch && req.body.template_id) {
      const importTemplate = await Templates.findOne({ id: req.body.template_id }, { _id: 0, body: 1, header: 1 }).lean();
      const templateResult = { rows: importTemplate ? [importTemplate] : [] };
      if (!templateResult.rows.length) return res.status(400).json({ error: 'Selected template was not found.' });
      let requestedMappings = {};
      try {
        requestedMappings = req.body.template_parameters ? JSON.parse(req.body.template_parameters) : {};
      } catch { requestedMappings = {}; }
      const isExcelSourced = (section, number) => {
        const mapping = requestedMappings?.[section]?.[String(number)];
        // No mapping info supplied (older client) — fall back to requiring every column.
        return !requestedMappings || Object.keys(requestedMappings).length === 0 || mapping?.source === 'excel_parameter';
      };
      const requiredColumns = [
        ...getTemplateVariableNumbers(templateResult.rows[0].header)
          .filter((number) => isExcelSourced('header', number))
          .map((number) => `Header {{${number}}}`),
        ...getTemplateVariableNumbers(templateResult.rows[0].body)
          .filter((number) => isExcelSourced('body', number))
          .map((number) => `Body {{${number}}}`),
      ];
      const headerRow = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false })[0] || [];
      const availableColumns = new Set(headerRow.map((value) => String(value).trim().toLowerCase()));
      const hasParameterColumn = (column) => {
        const prefix = column.toLowerCase();
        return [...availableColumns].some((available) => available === prefix || available.startsWith(`${prefix} - `));
      };
      const missingColumns = requiredColumns.filter((column) => !hasParameterColumn(column));
      if (missingColumns.length) {
        return res.status(400).json({ error: `Excel sheet is missing required columns: ${missingColumns.join(', ')}. Download the sheet for the selected template and keep its headings unchanged.` });
      }
      const incompleteRow = results.findIndex((row) => requiredColumns.some((column) => {
        const actualKey = Object.keys(row).find((key) => key.toLowerCase() === column.toLowerCase() || key.toLowerCase().startsWith(`${column.toLowerCase()} - `));
        return !actualKey || !String(row[actualKey] ?? '').trim();
      }));
      if (incompleteRow !== -1) {
        return res.status(400).json({ error: `Excel row ${incompleteRow + 2} has an empty template parameter. Fill every ${requiredColumns.join(', ')} value.` });
      }
    }

    const [importClients, importUsers] = await Promise.all([
      Clients.find({}, { _id: 0, id: 1, name: 1 }).lean(),
      Users.find({}, { _id: 0, id: 1, name: 1, email: 1 }).lean(),
    ]);
    const clientsMap = Object.fromEntries(
      importClients.filter((client) => client.name).map((client) => [client.name.toLowerCase(), client.id])
    );
    const usersMap = {};
    importUsers.forEach((user) => {
      if (user.name) usersMap[user.name.toLowerCase()] = user.id;
      if (user.email) usersMap[user.email.toLowerCase()] = user.id;
    });

    // Process each row
    let imported = 0;
    let inserted = 0;
    let existing = 0;
    let duplicateRows = 0;
    let failed = 0;
    const importErrors = [];
    const seenPhones = new Set();

    console.log(`[Campaign Import] Starting - isCampaignBatch: ${isCampaignBatch}, force_source: ${req.body.force_source}, client_id: ${client_id}`);

    for (const row of results) {
      try {
        const name = row.name || row.Name || row['First Name'] || 'Unknown';

        let phone = row.phone || row.Phone || row.whatsapp || row['Phone Number'] || row['phone number'] || '';
        let countryCode = row.country_code || row['country code'] || row['Country Code'] || '';

        // Excel may display large phone numbers in scientific notation, while
        // XLSX still gives us the correct raw numeric value. A cell stored as a
        // literal "9.195E+11" has already lost digits, so reject it rather than
        // risk messaging the wrong number.
        const phoneText = phone.toString().replace(/=/g, '').replace(/"/g, '').trim();
        if (/^\d+(?:\.\d+)?e\+\d+$/i.test(phoneText)) {
          phone = '';
        } else {
          phone = phoneText;
        }
        phone = phone.replace(/\D/g, '');
        countryCode = countryCode.toString().replace(/\D/g, '');

        if (countryCode && !phone.startsWith(countryCode)) {
          phone = countryCode + phone;
        }

        const status = req.body.force_status || (row.status || row.Status || 'new').toLowerCase();
        // Campaign imports use force_source as an internal recipient batch ID;
        // expose their actual lead source consistently as XLS Sheet.
        const source = isCampaignBatch
          ? 'XLS Sheet'
          : (req.body.force_source || row.source || row.Source || 'XLS Sheet');
        const score = parseInt(row.score || row.Score) || 0;
        const interest = row.interest || row.Interest || null;

        // Brand
        const rowClientId = leadOSBrand.id;

        // Assigned To
        let assignedTo = null;
        const assignedName = row.assigned || row.Assigned || row.assigned_to;
        if (assignedName && usersMap[assignedName.toLowerCase()]) {
          assignedTo = usersMap[assignedName.toLowerCase()];
        }

        // Last Contact
        let lastContact = null;
        const lc = row.last_contact || row['Last Contact'] || row.lastContact;
        if (lc) {
          const parsed = new Date(lc);
          if (!isNaN(parsed.getTime())) lastContact = parsed.toISOString();
        }

        const email = row.email || row.Email || null;

        if ((!phone && !email) || (phone && (phone.length < 10 || phone.length > 15))) {
          failed++;
          if (importErrors.length < 20) {
            importErrors.push({
              row: imported + duplicateRows + failed + 1,
              name,
              phone: phoneText,
              error: phoneText
                ? 'Phone number must contain 10 to 15 digits'
                : 'Phone number is missing or stored as unsafe scientific-notation text',
            });
          }
          continue;
        }

        const phoneDigits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
        if (phoneDigits && seenPhones.has(phoneDigits)) {
          duplicateRows++;
          continue;
        }
        if (phoneDigits) seenPhones.add(phoneDigits);

        // Check for existing lead by email or 10-digit phone
        let existingLead = null;
        if (phoneDigits || email) {
           if (phoneDigits) {
             existingLead = await Leads.findOne({ phone: phoneTailRegex(phoneDigits) }, { _id: 0, id: 1 }).lean();
           } else if (email != null) {
             existingLead = await Leads.findOne({ email: ieq(email) }, { _id: 0, id: 1 }).lean();
           }
        }

        let importedLeadId;
        const isCampaignImport = isCampaignBatch;

        if (existingLead) {
          importedLeadId = existingLead.id;
          existing++;
          if (!isCampaignImport) {
            // Normal CRM imports may refresh an existing lead. A campaign list
            // only references it and must not alter its CRM fields.
            const importChanges = { updated_at: new Date() };
            for (const [field, value] of Object.entries({ name, phone, email, status, client_id: rowClientId, source, score, interest, assigned_to: assignedTo })) {
              if (value != null) importChanges[field] = value;
            }
            await Leads.updateOne({ id: existingLead.id }, { $set: importChanges });
          }
        } else {
          // Insert new
          const insertedLead = await Leads.create({
            client_id: rowClientId, name, phone, email, status, source, score, interest, assigned_to: assignedTo, created_at: new Date(),
          });
          importedLeadId = insertedLead.id;
          inserted++;

          // ── Send welcome template for newly inserted leads (not existing ones) ──
          if (!isCampaignImport && process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
            // Stagger by 1s per lead to avoid WhatsApp rate limits on bulk import
            const delay = inserted * 1000;
            const welcome = { lead_id: importedLeadId, tenant_id: currentTenantId(), name, phone, client_id: rowClientId };
            setTimeout(() => {
              postToN8n(process.env.N8N_NEW_LEAD_WEBHOOK_URL, welcome)
                .catch(e => console.error(`[Import Welcome] Failed for lead ${importedLeadId}:`, e.message));
            }, delay);
          }
        }

        if (isCampaignImport) {
          const rowTemplateParameters = { header: {}, body: {} };
          for (const [column, value] of Object.entries(row)) {
            const match = String(column).match(/^(Header|Body)\s*\{\{\s*(\d+)\s*\}\}(?:\s*-.*)?$/i);
            if (match) rowTemplateParameters[match[1].toLowerCase()][match[2]] = String(value ?? '').trim();
          }
          console.log(`[Campaign Import] Linking lead ${importedLeadId} to batch ${req.body.force_source}`);
          await CampaignImportRecipients.updateOne(
            { batch_id: req.body.force_source, lead_id: importedLeadId },
            { $set: { template_parameters: rowTemplateParameters }, $setOnInsert: { created_at: new Date() } },
            { upsert: true }
          );
        }

        imported++;
        if (imported % 10 === 0) {
          console.log(`[Campaign Import] Progress: ${imported} imported, ${failed} failed`);
        }
      } catch (e) {
        console.error('Row import error for', row, e.message);
        failed++;
        if (importErrors.length < 5) {
          importErrors.push({
            row: imported + failed + 1,
            name: row.name || row.Name || row['First Name'] || '',
            phone: row.phone || row.Phone || row.whatsapp || row['Phone Number'] || row['phone number'] || '',
            error: e.message,
          });
        }
      }
    }

    fs.unlinkSync(req.file.path); // cleanup
    if (imported === 0 && failed > 0) {
      return res.status(400).json({
        success: false,
        imported,
        failed,
        error: importErrors[0]?.error || 'No valid contacts could be imported',
        errors: importErrors,
      });
    }
    res.json({
      success: true,
      imported,
      inserted,
      existing,
      duplicate_rows: duplicateRows,
      failed,
      errors: importErrors,
    });

  } catch (err) {
    console.error('Import error:', err);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to import leads' });
  }
});
};
