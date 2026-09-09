# WF-AL10 Meta WhatsApp Callback Relay

This workflow receives AllianceOS WhatsApp callbacks from Meta and forwards them to the isolated Alliance Inbox API.

## n8n credential

Open **Credentials → Create Credential → Header Auth** and create:

```text
Credential name: Alliance API Relay
Header name: x-internal-key
Header value: <the same INTERNAL_API_KEY configured on the Express server>
```

After importing, open both HTTP Request nodes and select the `Alliance API Relay` credential:

- Verify Through Alliance API
- Forward to Alliance Inbox API

No n8n Variables or Code nodes are used. The Alliance Phone Number ID and Meta verification token remain in the Express server environment. Express validates both.

The Meta access token is deliberately not stored in this workflow. Outbound messages are sent by the Alliance backend, where the token remains server-side.

Use the same `ALLIANCE_WA_VERIFY_TOKEN` in the Express server environment.

## Installation

1. Import `WF-AL10_Meta_WhatsApp_Callback_Relay.json` into n8n.
2. Activate the workflow.
3. In Meta App Dashboard, configure the WhatsApp callback URL as:

   `https://leados-n8n.abmgroups.org/webhook/whatsapp-incoming`

4. Enter the configured `ALLIANCE_WA_VERIFY_TOKEN` as Meta's verify token.
5. Subscribe the WhatsApp Business Account to the `messages` webhook field.

## Runtime flow

- Sending: AllianceOS backend sends approved templates to Meta.
- Statuses and replies: Meta calls n8n.
- n8n accepts only events matching the Alliance Phone Number ID.
- n8n forwards the unchanged Meta payload to `/api/alliance-inbox/webhook`.
- Express updates sent/delivered/read/failed status and stores inbound replies in Alliance Inbox.

Do not configure a second workflow on the same `whatsapp-incoming` path and HTTP methods.
