Getnera n8n workflows
=====================

Import each WF*.json in n8n (Workflows > Import from file). Keep them inactive
until one test workspace has passed end to end.

  WF1  AI reply        webhook /nera-ai-reply     reply + lead score + hot-lead alert
  WF2  New lead        webhook /nera-new-lead     welcome template
  WF3  Follow-up       every 15 minutes           day 2, 5 and 10 after the customer went quiet
  WF4  Handover        webhook /nera-handover     optional: lets other systems hand a chat to a person

(Lead capture/scoring used to be WF5; it is now part of WF1, one AI call per message.)

Credentials (n8n > Credentials > Header Auth), then pick them in the nodes:
  Nera Webhook Secret : header x-getnera-secret = server N8N_WEBHOOK_SECRET
  Nera Internal Key   : header x-internal-key   = server INTERNAL_API_KEY
  LLM API Key         : header Authorization    = Bearer <OpenAI key>

Config node in each workflow: api (https://api.getnera.in), model, template names.

Server .env:
  N8N_WEBHOOK_URL=https://<n8n>/webhook/nera-ai-reply
  N8N_NEW_LEAD_WEBHOOK_URL=https://<n8n>/webhook/nera-new-lead
  N8N_WEBHOOK_SECRET=<same value as the credential>
  N8N_API_URL=https://<n8n>          (admin panel > Workflows: live status/runs)
  N8N_API_KEY=<n8n > Settings > n8n API>
  Optional: AI_REPLY_DELAY_SECONDS=10, AI_REPLIES_PER_TENANT_HOUR=200,
            AI_SENDING_HOURS=9-21, AI_FOLLOWUP_TEMPLATE=follow_up

What the server enforces (n8n cannot bypass it):
  - No AI reply when the chat is paused (handed to a person), the customer
    opted out, the workspace is suspended, or the hourly cap is reached.
  - Follow-ups use ai_followup_due / ai_followup_step, never the SalesOS
    next_followup_due. Each due lead is leased for an hour, so it is not sent
    twice. Only 9:00-21:00 in the workspace time zone.
  - Handover modes: pause (AI stops for that chat until a person resumes it
    with POST /api/leads/:id/ai {"paused": false}), notify (a person is told,
    AI continues), hot (hot-lead alert, once per lead).

Each workspace's WhatsApp account needs approved templates with the names in
Config (welcome_message, follow_up), each taking the customer name as {{1}}.
