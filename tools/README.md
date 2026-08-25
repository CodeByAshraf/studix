# Studix Support Access — Owner Tools

Owner-only tooling for the Support Access feature (Phase 4a–4d). Nothing in this directory
is shipped to customers, bundled into the application build, or included in the installer —
it exists purely for the software owner/support operator to run on their own machine.

If you are a customer or a tutoring-center admin: this directory is not for you. Use the
"Support Access" screen inside the Studix app instead.

## What this is

Studix's Support Access mechanism (see the architecture notes in `backend/src/lib/`) is an
offline, asymmetric challenge-response system: a customer's app generates a short-lived
challenge, the owner signs it with a private key that never leaves the owner's machine, and
the customer's app verifies that signature against a public key it already has. Two tools
live here:

- **`support-signer.js`** — the day-to-day tool. Paste in a customer's challenge, get back
  the response code to send them.
- **`support-keygen.js`** — a one-time (or deliberate-rotation) tool that generates the
  Ed25519 keypair itself.

## Where the private key lives

By default: `<your home directory>/StudixSupport/support-private-key.pem` (resolved via
Node's `os.homedir()` — whatever your OS user account is, automatically; never hardcoded).

Override the location (e.g. to keep it on an encrypted external drive) with:

```
STUDIX_SUPPORT_KEY_DIR=D:\Encrypted\StudixSupport
```

or set `STUDIX_SUPPORT_PRIVATE_KEY_PATH` / `STUDIX_SUPPORT_PUBLIC_KEY_PATH` individually.

**This directory must never be inside this repository, never committed to Git, and never
copied onto a customer's machine.** See the Security section below.

## Generating your first keypair

Only ever done once per keypair (see "If you suspect the key is compromised" below for the
one legitimate reason to redo it):

```
node tools/support-keygen.js
```

This will:
1. Generate a new Ed25519 keypair using Node's built-in `crypto` (no third-party library).
2. Save the **private** key to your owner-controlled directory (see above) — never printed,
   never logged.
3. Save the **public** key alongside it, and also print it to the console (public keys are
   safe to share — that's the point of asymmetric crypto).

If a private key already exists at that location, the command refuses to run (protects you
from accidentally destroying your existing root credential). Only pass `--force` if you are
deliberately rotating the key — see below.

## Installing (provisioning) the public key into a customer installation

Phase 4b added a `support_access_config` table to each customer's local Studix database,
with a `support_public_key` column — empty by default. A customer's Support Access screen
refuses to generate a challenge at all until that column holds your public key
(fail-closed by design).

Getting the public key from `support-keygen.js`'s output into that column for a specific
customer's database is an operational step, not automated by any tool in this repository —
Phase 4d intentionally does not add a network/API provisioning path (see the Scope
Boundary note in the Phase 4d report). Today that means running a one-time update against
that customer's local Postgres (e.g. via `psql` or Prisma Studio) with the public key PEM
you generated. A smoother provisioning flow (e.g. as part of the installer) is a reasonable
future improvement, out of scope here.

## Signing a customer's challenge

1. The customer opens the "Support Access" page in their Studix app and clicks "Generate
   Support Code". They read you the resulting code over the phone, or send it via WhatsApp
   / email — any channel you already trust for that customer.
2. Run:
   ```
   node tools/support-signer.js
   ```
3. Paste the challenge when prompted. The tool validates it locally (correct format, not
   expired) before ever touching your private key, and rejects anything malformed with a
   clear error.
4. You get back a **Response Code** and its expiry. Send the Response Code back to the
   customer through the same trusted channel.
5. The customer pastes it into their Support Access screen. If it's valid, unexpired, and
   not already used, their app grants a short-lived (30-minute) support session and shows
   it as active.

The tool never connects to any network or database — it is safe to run fully offline, and
in fact should be, since the private key never needs to touch the internet to do its job.

## Protecting and backing up the private key

- Treat `support-private-key.pem` exactly like you would a root password or a signing
  certificate: it is the **only** thing standing between "anyone" and "only the real
  software owner" being able to grant Support Access on any customer's installation that
  has your public key installed.
- Back it up to an encrypted location you control (an encrypted external drive, a password
  manager that supports file attachments, etc.) — losing it is unrecoverable (see below).
- Never email it, never paste it into chat, never commit it to any repository (this one or
  any other), never copy it onto a customer's machine, never store it in plain cloud
  storage.

## If you lose the private key

There is no recovery. Support Access for every installation that already has your public
key installed can no longer be granted — you would need to generate a new keypair
(`support-keygen.js --force`) and re-provision the new public key to each customer
installation (see "Installing the public key" above). This does not affect anything else in
the application — it only affects future Support Access grants.

## If you suspect the private key is compromised

Treat it as an incident:
1. Generate a new keypair: `node tools/support-keygen.js --force` (this **overwrites** your
   existing private key file locally — make sure you actually intend this).
2. Re-provision the new public key to customer installations through a controlled
   application update (this is a deliberate, reviewed change to what ships to customers —
   not an automatic/silent update, by design; see the Security Rules in the Phase 4d
   report).
3. The old public key still installed anywhere will simply stop accepting your (new)
   signatures — there is nothing further to "revoke" on the compromised key itself, since
   it was never trusted to do anything on its own (only the private key can produce a valid
   signature).

## Security notes (do not skip)

- The private key is **never**: committed to Git, stored in the frontend, stored in backend
  source code, stored in `.env`, stored in the database, included in the production build
  or installer, embedded in this tool's source code, logged to the console, or printed by
  any diagnostic command.
- `support-signer.js` only ever prints the **response code** it computes — never the key
  material used to compute it.
- `support-keygen.js` only ever prints the **public** key — never the private one.
- This tool has no relationship to the customer application's own login
  (`POST /api/session`) — its output is a signature over a challenge, structurally
  unrelated to any user id/password.
