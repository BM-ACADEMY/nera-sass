# AllianceOS WhatsApp follow-up setup

1. Import `AllianceOS_WhatsApp_Followups_n8n.json` into n8n.
2. Create a **Header Auth** credential named `Alliance API Relay`.
3. Set its header name to `x-internal-key` and its value to the same `INTERNAL_API_KEY` configured on the LeadOS API server.
4. Open `Claim due reminders` and select the `Alliance API Relay` credential.
5. Open `Policy check and send` and select the same credential.
6. Activate the workflow after sending a test campaign to an opted-in internal contact.

The production API URL is configured directly in both HTTP nodes. This workflow does not access n8n environment variables.

The workflow claims up to 20 due reminders each minute. The API performs the final consent and lead-status check and sends the registered Meta template. A 15-minute claim lease makes retries safe if an n8n execution stops unexpectedly.

Automation stops for an inbound reply, STOP/unsubscribe, not interested, converted, closed, suppression, missing consent, or a stopped campaign. After an inbound reply, communication continues manually in the Alliance Inbox.
