# Facebook Lead Forms (Lead Ads) per workspace

Each Getnera customer connects **their own** Facebook Page. When someone fills in a
Lead Form (Instant Form) on that Page's Facebook or Instagram ad, the lead is added
to **that customer's workspace only**, with the campaign and ad names.

Click-to-WhatsApp ad leads are a different thing: they already arrive through the
WhatsApp webhook (`referral.source_id`) and are not touched by this feature.

The feature is off unless `FACEBOOK_LEADS_ENABLED=true`. While it is off, every route
below answers 404 and the Settings > Integrations page says the feature is not available.

The older lead-ads handlers (`/webhook/meta-leads` in `routes/leados/webhook-meta-leads.js`
and `controllers/integrationsController.js`, which match by brand name) are separate,
not tenant-safe and stay untouched. Do not point Meta at them.

## How it works

### Connect (Settings > Integrations, Owner or Admin only)

1. The owner clicks **Connect Facebook**. `POST /api/facebook-leads/connect` returns the
   Facebook Login dialog URL with a signed `state` (JWT, 15 minutes, names the workspace).
   - With `FACEBOOK_LOGIN_CONFIG_ID` set, the dialog uses that Facebook Login for Business
     configuration; otherwise it asks for the scopes directly:
     `pages_show_list, pages_read_engagement, pages_manage_metadata, leads_retrieval`.
2. Facebook redirects to `GET /api/facebook-leads/callback?code&state`. The server:
   - checks the state (a forged or expired state stores nothing),
   - exchanges the code for a user token, then for a **long-lived** user token,
   - checks `/me/permissions`; if any of the four permissions was switched off it says
     which ones, in plain English, and stores nothing,
   - lists the user's Pages (`/me/accounts`) and keeps them for 30 minutes as a pending
     choice, with the user token encrypted (`facebook_lead_connections`),
   - sends the browser back to `/settings/integrations?facebook=choose`.
3. The owner ticks the Pages and clicks **Connect selected Pages**
   (`POST /api/facebook-leads/pages { page_ids }`). For each Page the server:
   - refuses it if it is already connected to another Getnera workspace (a Page feeds one
     workspace only; `page_id` is unique across tenants),
   - calls `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` with the Page token,
   - stores page id, name and the **Page token encrypted** with `encryptToken`
     (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) in `facebook_lead_pages`, linked to the tenant,
   - writes the audit event `FACEBOOK_PAGE_CONNECTED`.
   The user token is deleted once Pages are saved. Page tokens from a long-lived user
   token do not expire unless the user changes password, loses the Page role or removes
   the app.
4. **Disconnect** (`DELETE /api/facebook-leads/pages/:pageId`) calls
   `DELETE /{page-id}/subscribed_apps` and deletes the stored token
   (audit `FACEBOOK_PAGE_DISCONNECTED`). If Facebook does not confirm, the Page is still
   removed in Getnera and the owner is told to remove Getnera under the Page's
   *Settings > Business integrations*.
   `DELETE /api/facebook-leads` disconnects every Page; `DELETE /api/facebook-leads/pending`
   closes the Page picker.

The page shows: connected / not connected, each Page's name, "Receiving leads" or
"Needs attention", when the last lead arrived and how many, and the last error in plain
English (for example "Facebook access has expired or was removed. Please reconnect Facebook.").
Agents and managers can view the page but not connect or disconnect.

### Receive leads (webhook)

- `GET /api/webhooks/facebook-leads`: Meta's verification. Answers `hub.challenge` when
  `hub.verify_token` equals `FACEBOOK_LEADS_VERIFY_TOKEN`, else 403.
- `POST /api/webhooks/facebook-leads`: checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw
  body with the app secret; same check as the WhatsApp webhook, `isValidMetaSignature`).
  Missing or wrong signature: 401. No secret configured: 503. Then it answers **200 at once**
  and processes the leads afterwards.
- For every `leadgen` change:
  1. The workspace is found **only** from the stored `page_id`. Unknown Page: ignored and
     logged, no Graph call.
  2. Idempotent on `leadgen_id`: a lead already saved, or already being processed
     (`processed_webhook_events`, provider `facebook_leadgen`), is skipped.
  3. `GET /{leadgen_id}?fields=field_data,created_time,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform`
     with that Page's token (plus `appsecret_proof`).
  4. Mapping: `full_name` (or first + last name) → name, `phone_number` → phone (digits only,
     as the rest of the app stores phones), `email` → email. Every other question is kept in
     `lead_form_answers` and appended to `notes` ("Facebook lead form answers: - question: answer").
     A question about WhatsApp / consent / opt-in with a yes-type answer records the
     contact's WhatsApp opt-in (`consent.recordOptIn`, source `lead_form`).
  5. Dedupe by phone inside the workspace (last 10 digits, like the rest of the app; email
     when there is no phone). An existing contact keeps its name and first source and gets
     the new ad details, the email if it had none, and the answers in its notes.
  6. New leads get `source: 'facebook'`, or `'instagram'` when `platform` is `ig`, plus
     `leadgen_id`, `meta_lead_id`, `lead_ad_form_id`, `ad_id`, `ad_name`, `adset_name`,
     `campaign_id`, `campaign_name`, `facebook_page_id`, `lead_form_platform`,
     `lead_form_submitted_at`. The Leads page's existing "facebook" filter matches both.
  7. The Page's `last_lead_at` / `leads_received` are updated, the audit event
     `FACEBOOK_LEAD_RECEIVED` is written, the workspace gets a live `lead_created` event, and
     (outside tests, when `N8N_NEW_LEAD_WEBHOOK_URL` is set) the same welcome hook as a lead
     added by hand is called.
  8. If Meta refuses the lead fetch, the Page shows the error in plain English, a
     `failed_webhooks` row is written, and the `leadgen_id` is released so a redelivery
     can be processed.

Code: `server/services/facebookLeads.js`, `server/routes/facebookLeads.js`,
`server/models/FacebookLeadPages.js`, `server/models/FacebookLeadConnections.js`,
`client/src/views/settings/IntegrationsSection.jsx`. Tests:
`server/test/facebook-lead-forms.test.js` (Meta mocked).

## Environment variables (server)

| Variable | Needed | What it is |
|---|---|---|
| `FACEBOOK_LEADS_ENABLED` | yes | `true` turns the feature on. Anything else = all routes 404. |
| `FACEBOOK_APP_ID` | yes | App ID of the Meta app used for Facebook Login. |
| `FACEBOOK_APP_SECRET` | yes* | Secret of the same app. Used for the code exchange, `appsecret_proof` and the webhook signature. *Empty = `NERA_META_APP_SECRET` is used, which is right only if it is the same Meta app as WhatsApp. |
| `FACEBOOK_LEADS_VERIFY_TOKEN` | yes | Any long random string; type the same value in the Meta dashboard webhook setup. |
| `FACEBOOK_LOGIN_CONFIG_ID` | recommended | Facebook Login for Business configuration ID. Empty = classic Facebook Login with scopes. |
| `FACEBOOK_LEADS_REDIRECT_URI` | optional | Defaults to `${PUBLIC_API_URL}/api/facebook-leads/callback`. Must be listed in *Valid OAuth Redirect URIs*. |
| `PUBLIC_API_URL` | yes | e.g. `https://api.getnera.in` (already used elsewhere). |
| `NERA_APP_URL` or `PORTAL_URL` | yes | Customer app, e.g. `https://app.getnera.in`; the callback sends the browser back to `/settings/integrations`. |
| `META_GRAPH_VERSION` | optional | Existing Graph version constant (default `v19.0`). |
| `TOKEN_ENCRYPTION_KEY` | existing | Encrypts the Page tokens. |

## Meta app setup

1. In the Meta app (developers.facebook.com > your app):
   - Add the **Facebook Login for Business** product. Under *Settings*, add
     `https://api.getnera.in/api/facebook-leads/callback` to *Valid OAuth Redirect URIs*.
   - Under *Configurations*, create a configuration: login variation **General**, token
     type **User access token**, assets **Pages**, permissions `pages_show_list`,
     `pages_read_engagement`, `pages_manage_metadata`, `leads_retrieval`. Put its ID in
     `FACEBOOK_LOGIN_CONFIG_ID`.
2. Add the **Webhooks** product, object **Page**:
   - Callback URL `https://api.getnera.in/api/webhooks/facebook-leads`
   - Verify token = `FACEBOOK_LEADS_VERIFY_TOKEN`
   - Subscribe to the field **leadgen**.
   (The server must already run with `FACEBOOK_LEADS_ENABLED=true`, or verification gets 404.)
3. Business verification of the Getnera business must be complete (needed for Advanced
   Access to `leads_retrieval` and the Pages permissions).
4. Privacy policy URL, Terms URL, app icon, category and Data Deletion instructions URL
   filled in under *App settings > Basic*.

## Meta App Review checklist

Ask for **Advanced Access** for each permission below. `business_management` is **not**
requested: the flow only needs the Pages the user picks.

| Permission | Why Getnera needs it (paste into the "How will you use" box) |
|---|---|
| `pages_show_list` | After a business owner signs in with Facebook, Getnera lists the Pages they manage so they can choose which Page's Lead Form leads should come into their Getnera workspace. |
| `pages_read_engagement` | Required with the Page token to read the Page's basic details (name) shown in Getnera, and by Meta for lead retrieval on Pages the user manages. |
| `pages_manage_metadata` | Getnera subscribes our app to the chosen Page's `leadgen` webhook (`POST /{page-id}/subscribed_apps`) so new Lead Form submissions are delivered to us, and unsubscribes when the owner disconnects. |
| `leads_retrieval` | When the webhook tells us a lead was submitted, Getnera reads that lead (name, phone, email, answers, ad and campaign name) with the Page token and saves it to the business owner's own Getnera workspace so their team can follow up on WhatsApp. |

Reviewer access: give the reviewer a Getnera test login (owner role) on a workspace with
the feature on, plus a test Facebook user that is admin of a test Page with a Lead Form
(or tell them to use their own test Page). Keep that login working until review is done.

### Screencast (one video, show each permission in use, English captions)

Record at 1080p, show the browser address bar, no cuts in the middle of a flow.

1. Open `https://app.getnera.in`, sign in as the test owner. Caption: "A business owner
   signs in to Getnera."
2. Click **Settings** > **Integrations**. Caption: "They connect their Facebook Page so
   Lead Ads leads come into Getnera."
3. Click **Connect Facebook**. The Facebook Login for Business dialog opens. Caption:
   "Facebook Login for Business: the owner chooses their Page and grants the permissions."
   Show the Page selection screen and the permissions screen, then continue.
4. Back in Getnera the list of Pages appears (**pages_show_list**). Caption: "Getnera lists
   the Pages the user manages." Tick the test Page, click **Connect selected Pages**.
5. The Page shows **Receiving leads**. Caption: "Getnera subscribed to the Page's leadgen
   webhook (pages_manage_metadata)."
6. In a second tab open the **Lead Ads Testing Tool**
   (`https://developers.facebook.com/tools/lead-ads-testing`), pick the same Page and form,
   click **Create lead**. Caption: "A person submits the Lead Form."
7. Back in Getnera, open **Leads**. The new lead appears with name, phone, email, source
   Facebook and the form answers in the notes (**leads_retrieval**,
   **pages_read_engagement**). Caption: "Getnera retrieves the lead and saves it only to
   this business's workspace." Open the lead to show the details.
8. Go back to **Settings > Integrations**: "Last lead just now", 1 lead received.
9. Click **Disconnect** > confirm. Caption: "The owner can disconnect at any time; Getnera
   unsubscribes from the Page and deletes its access token."

## Testing before App Review is approved

Before Advanced Access, the permissions work only for people with a role on the Meta app
(admin, developer or tester) and Pages they manage. That is enough for end-to-end testing.

1. Set the env vars above on staging (`staging-api.getnera.in` / staging app) with
   `FACEBOOK_LEADS_ENABLED=true`, and add the staging callback URL to *Valid OAuth Redirect
   URIs*. Point the Meta webhook (Page object, `leadgen`) at the staging URL while testing.
2. Use a Facebook account that has a role on the app and is admin of a test Page.
   Create a Lead Form on that Page (Meta Business Suite > All tools > Instant Forms), or
   let the testing tool create one.
3. In Getnera staging: Settings > Integrations > Connect Facebook, pick the test Page.
4. Open the **Lead Ads Testing Tool**: `https://developers.facebook.com/tools/lead-ads-testing`.
   Choose the Page and the form, click **Delete lead** if one exists for your user, then
   **Create lead**. Click **Track status**: it should show the webhook was delivered with
   response 200 to our callback URL.
5. The lead appears on the Leads page of the workspace that connected the Page within a
   few seconds. Check server logs for `[Facebook Leads]` lines if not.
6. Negative checks: a second workspace that did not connect the Page sees nothing; creating
   the same test lead twice only gives one lead; disconnecting stops new leads.

Note: test leads from the testing tool use `platform` `fb` and fake ad fields
(ad and campaign names may be empty); real ads fill them in.

## Not done yet / to do outside the code

- Meta App Review (above) and the production env vars.
- Leads page filter "Facebook lead form" is being added in the Leads page redesign
  (separate work); the existing "facebook" source filter already matches these leads.
- No backfill of leads submitted before a Page was connected (Meta keeps them 90 days;
  could be added with `GET /{form-id}/leads`).
