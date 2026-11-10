# Runbook: rotate TOKEN_ENCRYPTION_KEY on production

For Aakash. Do the steps in this order. Stop at any step that does not give the
expected result and ask before going on. Nothing here loses data: until the
last step the old key stays on the server and every value stays readable.

Rules for the whole procedure:

- Never paste a key or token into chat, a ticket, git or a terminal you are sharing.
- Never `cat` or print `server/.env`. The commands below edit it without showing it.
- Customers can keep using Nera throughout. There is no downtime.

Server paths and names are the ones in `deploy/README.md`: `/opt/getnera`, pm2 `getnera-api`.

## 1. Deploy the code first, with the key unchanged

Merge and deploy this change the normal way, without touching `.env`:

```bash
cd /opt/getnera && git pull && bash deploy/deploy.sh server
```

Check that WhatsApp sending and login with two-step verification still work.
From now on new values are stored with a key version (`k<8 characters>:` prefix).
Because of that, do not roll the server back to an older commit after this step:
old code cannot read the new format.

## 2. Look before changing anything (dry run, old key only)

```bash
cd /opt/getnera/server && node scripts/security/rotate-token-encryption-key.js
```

It writes nothing. Note the `TOTAL found` number and check `unreadable` is 0.
If `unreadable` is above 0, stop: those values are already broken today and
must be understood first.

## 3. Back up the database

```bash
mkdir -p /root/nera-rotation && chmod 700 /root/nera-rotation
```

```bash
cd /opt/getnera/server && MONGODB_URI="$(grep -E '^MONGODB_URI=' .env | cut -d= -f2- | tr -d '\r')" && mongodump --uri="$MONGODB_URI" --gzip --archive=/root/nera-rotation/before-rotation.archive.gz
```

The command reads the database address from `.env` without showing it. If
`mongodump` is not installed, install the MongoDB Database Tools first.

Check the backup can be read back (this lists it and imports nothing):

```bash
cd /opt/getnera/server && MONGODB_URI="$(grep -E '^MONGODB_URI=' .env | cut -d= -f2- | tr -d '\r')" && mongorestore --uri="$MONGODB_URI" --gzip --archive=/root/nera-rotation/before-rotation.archive.gz --dryRun
```

Also keep a copy of the current env file, readable only by root:

```bash
cp -p /opt/getnera/server/.env /root/nera-rotation/env.before && chmod 600 /root/nera-rotation/env.before
```

## 4. Put the new key in place, keep the old one as PREVIOUS

These two commands rename the existing line and add a freshly generated key.
Neither prints a key.

```bash
cd /opt/getnera/server && sed -i 's/^TOKEN_ENCRYPTION_KEY=/TOKEN_ENCRYPTION_KEY_PREVIOUS=/' .env
```

```bash
cd /opt/getnera/server && printf 'TOKEN_ENCRYPTION_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
```

Check there is exactly one line of each (prints names and counts only, expected `1` and `1`):

```bash
cd /opt/getnera/server && grep -c '^TOKEN_ENCRYPTION_KEY=' .env && grep -c '^TOKEN_ENCRYPTION_KEY_PREVIOUS=' .env
```

If `.env` uses the older name `ENCRYPTION_KEY` instead of `TOKEN_ENCRYPTION_KEY`
(first count would have been 0 before this step), stop and ask.

Store the new key in the password manager now, the same way as the other production secrets.

## 5. Restart the API with both keys

```bash
cd /opt/getnera && bash deploy/deploy.sh server
```

The app now encrypts with the new key and can read both. Check again that
WhatsApp sending and two-step login work.

## 6. Dry run with both keys

```bash
cd /opt/getnera/server && node scripts/security/rotate-token-encryption-key.js
```

Expected: `TOTAL found` about the same as step 2, `to re-encrypt` close to it,
`unreadable` 0.

## 7. Re-encrypt

```bash
cd /opt/getnera/server && node scripts/security/rotate-token-encryption-key.js --apply --backup /root/nera-rotation/before-rotation.archive.gz
```

Expected last line: `RESULT: every encrypted value is now under the current key.`

- If it stops with an error, or reports values "changed meanwhile": run the
  same command again. It skips what is already done.
- If it reports `unreadable` values: do not go on to step 9. Send the report
  (it holds only counts) to Samsudeen.
- If the backup is refused as too old, take a fresh one (step 3). Do not raise the limit.

## 8. Confirm

Run the dry run once more:

```bash
cd /opt/getnera/server && node scripts/security/rotate-token-encryption-key.js
```

Expected: `to re-encrypt` 0 and `unreadable` 0 in the TOTAL row. Then test in
the product: send a WhatsApp message from one workspace, log in with two-step
verification, open Settings > Calendar on a workspace with Google Calendar connected.

Read the line about contact-erasure records and write the second number down.

## 9. Remove the old key (only after a decision)

Wait at least one day with step 8 clean. Then:

- If the erasure line in step 8 said `hashed with a key other than the current one: 0`,
  remove the old key and restart:

```bash
cd /opt/getnera/server && sed -i '/^TOKEN_ENCRYPTION_KEY_PREVIOUS=/d' .env && cd /opt/getnera && bash deploy/deploy.sh server
```

- If that number was above 0, do NOT remove it. Those are "delete my data"
  records whose phone hash was made with the old key and cannot be converted.
  Removing the old key would let Nera message those people again. Leave
  `TOKEN_ENCRYPTION_KEY_PREVIOUS` in place and tell Samsudeen the number.

## 10. Clean up

The backup and `env.before` in `/root/nera-rotation` still hold data readable
with the old, leaked key. Once step 8 has been clean for a week:

```bash
shred -u /root/nera-rotation/env.before /root/nera-rotation/before-rotation.archive.gz
```

Older routine database backups have the same weakness; tell Samsudeen which ones exist.

## If something goes wrong

- Up to step 7 nothing in the database has changed. To undo step 4, restore the env file and restart:

```bash
cp -p /root/nera-rotation/env.before /opt/getnera/server/.env && cd /opt/getnera && bash deploy/deploy.sh server
```

  Do this only if step 7 has not run. Anything saved by customers between
  steps 5 and the undo was encrypted with the new key and would become
  unreadable, so undo quickly or not at all.
- After step 7 has started, do not go back. Keep both keys set and re-run step 7.
- Do not restore the database dump unless told to: it would discard everything
  customers did since step 3.
