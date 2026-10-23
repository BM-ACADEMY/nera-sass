Import each WF*.json in n8n (Workflows > Import from file). Not run against a live n8n yet.
Create 3 Header Auth credentials and pick them in the nodes:
  Nera Webhook Secret : header x-getnera-secret = N8N_WEBHOOK_SECRET value
  Nera Internal Key   : header x-internal-key   = INTERNAL_API_KEY value
  LLM API Key         : header Authorization    = Bearer <key>
Edit the Config node in each workflow (api host, model). Add internal-additions.js to the server.
Keep workflows inactive until a test tenant passes.
