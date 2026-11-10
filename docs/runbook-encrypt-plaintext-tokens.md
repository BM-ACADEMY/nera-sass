# Runbook: encrypt the plain-text token columns on production

For Aakash. One-time job. It encrypts tokens that older code stored in plain text:

- `mafiya_gmb_tokens.access_token`, `refresh_token` (Google Business Profile)
- `thedal_gsc_tokens.access_token`, `refresh_token` (Google Search Console)
- `clients.access_token`, `refresh_token` (older Google connect on the brand)
- `clients.wa_access_token` (old WhatsApp token column; moved to `wa_access_token_enc`)

It uses `TOKEN_ENCRYPTION_KEY` with key versions, so it needs the key-rotation
change to be live first. It can run before or after the key itself is rotated
(`docs/runbook-rotate-token-encryption-key.md`); just never run the two scripts
at the same time. No downtime. The script prints counts only.

Do the steps in order and stop if a result is not the expected one.

## 1. Deploy the code first

```bash
cd /opt/getnera && git pull && bash deploy/deploy.sh server
```

From now on every new write to these columns is encrypted, and old plain rows
still work. Do not roll the server back to an older commit after this: old code
would send the encrypted text to Google as if it were the token.

Check that a Local SEO (Mafiya) client with Google connected still loads its reviews.

## 2. Dry run

```bash
cd /opt/getnera/server && node scripts/security/encrypt-plaintext-tokens.js
```

Writes nothing. Note the `to encrypt` and `conflicts` totals.

## 3. Back up the database

```bash
mkdir -p /root/nera-rotation && chmod 700 /root/nera-rotation
```

```bash
cd /opt/getnera/server && MONGODB_URI="$(grep -E '^MONGODB_URI=' .env | cut -d= -f2- | tr -d '\r')" && mongodump --uri="$MONGODB_URI" --gzip --archive=/root/nera-rotation/before-encrypt.archive.gz
```

## 4. Encrypt

```bash
cd /opt/getnera/server && node scripts/security/encrypt-plaintext-tokens.js --apply --backup /root/nera-rotation/before-encrypt.archive.gz
```

Expected last line: `RESULT: no plain-text token is left in these columns.`

- Stopped with an error, or "changed meanwhile" above 0: run the same command again. It skips what is done.
- `conflicts` above 0: those brands have an old plain WhatsApp token and a
  different (or unreadable) encrypted one. The script changed nothing for them
  and the app keeps using the encrypted one. Send the report to Samsudeen; do
  not edit the database by hand.

## 5. Confirm

Run the dry run again (step 2): `to encrypt` must be 0. Then check in the
product: reviews load for a Mafiya client with Google connected, and a
WhatsApp message sends from one workspace.

## 6. Clean up

The backup holds the tokens in plain text. After a week without problems:

```bash
shred -u /root/nera-rotation/before-encrypt.archive.gz
```
