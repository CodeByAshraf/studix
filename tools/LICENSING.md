# Studix Licensing — Owner Tools

Owner-only tooling for the Licensing/Serial Activation feature (Phase 5a–5d). Nothing in
this directory is shipped to customers, bundled into the application build, or included in
the installer — it exists purely for the software owner to run on their own machine.

If you are a customer or a tutoring-center admin: this directory is not for you. Use the
"Activate Studix" screen inside the Studix app instead.

**This is a completely separate system from Support Access** (see `tools/README.md`) —
separate keypair, separate key directory, separate CLI tools. Never reuse the Support
Access keypair here, or vice versa; compromising or rotating one must never affect the
other.

## What this is

Studix's Licensing mechanism (see `backend/src/lib/licenseArtifactFormat.js` and the
approved Phase 5 investigation report) is the same asymmetric, offline pattern already
proven by Support Access: the owner signs a structured license document with a private key
that never leaves the owner's machine, and the customer's app verifies that signature
against a public key it already has. Two tools live here:

- **`license-issuer.js`** — the day-to-day tool. Paste in a customer's Activation Request
  Code, answer a few questions about the license terms, get back the License Artifact to
  send them.
- **`license-keygen.js`** — a one-time (or deliberate-rotation) tool that generates the
  Ed25519 keypair itself.

## Where the private key lives

By default: `<your home directory>/StudixLicensing/license-private-key.pem` (resolved via
Node's `os.homedir()` — automatically, never a hardcoded path).

Override the location with:

```
STUDIX_LICENSE_KEY_DIR=D:\Encrypted\StudixLicensing
```

or set `STUDIX_LICENSE_PRIVATE_KEY_PATH` / `STUDIX_LICENSE_PUBLIC_KEY_PATH` individually.

**This directory must never be inside this repository, never committed to Git, and never
copied onto a customer's machine.** See the Security section below.

## Generating your first keypair

Only ever done once per keypair (see "If you suspect the key is compromised" below for the
one legitimate reason to redo it):

```
node tools/license-keygen.js
```

This generates a new Ed25519 keypair using Node's built-in `crypto` (no third-party
library), saves the **private** key only to your owner-controlled directory (never printed,
never logged), and saves/prints the **public** key (safe to share). If a private key
already exists at that location, the command refuses to run unless you pass `--force` —
see "If you suspect the private key is compromised" below.

## Installing (provisioning) the public key into a customer installation

Each customer's local Studix database has a `license_config` table (Phase 5a) with a
`licensing_public_key` column — empty by default. A customer's Activate screen refuses to
verify any license at all until that column holds your public key (fail-closed by design).

Getting the public key from `license-keygen.js`'s output into that column for a specific
customer's database is an operational step, not automated by any tool in this repository —
Phase 5d intentionally does not add a network/API provisioning path (see the Scope
Boundary note in the Phase 5d report). Today that means running a one-time update against
that customer's local Postgres (e.g. via `psql` or Prisma Studio) with the public key PEM
you generated. A smoother provisioning flow (e.g. as part of the installer) is a reasonable
future improvement, out of scope here.

## Issuing a license for a customer

1. The customer opens the "Activate Studix" screen in their app (an admin logs in first —
   activation is admin-only) and generates an **Activation Request Code**. They send it to
   you through a channel you already trust for that customer.
2. Run:
   ```
   node tools/license-issuer.js
   ```
3. Paste the request code when prompted — it decodes to the customer's `installationId` and
   `product`, shown back to you for a sanity check.
4. Answer a few short prompts:
   - **License ID** — leave blank to auto-generate one, or supply your own reference.
   - **Perpetual license?** — `Y` (default) for no expiry, `n` to be asked for a number of
     days from today.
   - **Features** — optional, comma-separated (reserved for future tiering; safe to leave
     blank today).
   - **Notes** — optional free text (e.g. the customer's name), purely for your own
     reference — never checked or enforced by the app.
5. You get back a **License Artifact** — a single opaque string. Send it back to the
   customer through the same trusted channel.
6. The customer pastes it into their Activate screen. If it verifies (correct signature,
   bound to their installation, correct product, not expired), the app unlocks immediately.

The tool never connects to any network or database — safe, and expected, to run fully
offline.

### Renewing or re-issuing a license

There is no separate "renew" command — just run `license-issuer.js` again with the same (or
a fresh) Activation Request Code from that customer, and issue a new artifact with updated
terms (a new expiry, for instance). Activating a new artifact fully replaces whatever was
there before on that installation — this is the normal, expected renewal path, not a
special case.

## Protecting and backing up the private key

- Treat `license-private-key.pem` exactly like a root password or a signing certificate: it
  is the **only** thing standing between "anyone" and "only the real software owner" being
  able to issue a valid license for any installation that has your public key.
- Back it up to an encrypted location you control — losing it is unrecoverable for future
  licenses (see below).
- Never email it, paste it into chat, commit it to any repository, copy it onto a
  customer's machine, or store it in plain cloud storage.
- Never let it touch the same file, chat message, or backup as your Support Access private
  key — they must stay independently compromise-able/recoverable.

## If you lose the private key

There is no recovery. You can no longer issue new licenses that any already-provisioned
customer installation will accept — you would need to generate a new keypair
(`license-keygen.js --force`) and re-provision the new public key to each customer
installation (see "Installing the public key" above). Already-activated installations keep
working normally; this only affects *future* license issuance.

## If you suspect the private key is compromised

1. Generate a new keypair: `node tools/license-keygen.js --force` (this **overwrites** your
   existing private key file locally — make sure you actually intend this).
2. Re-provision the new public key to customer installations through a controlled
   application update (a deliberate, reviewed change — not an automatic/silent one).
3. The old public key still installed anywhere simply stops accepting new signatures from
   you — there is nothing further to "revoke" on the key itself, since only the private key
   can produce a valid signature in the first place.

## Security notes (do not skip)

- The private key is **never**: committed to Git, stored in the frontend, stored in backend
  source code, stored in `.env`, stored in the database, included in the production build
  or installer, embedded in this tool's source code, logged to the console, or printed by
  any diagnostic command.
- `license-issuer.js` only ever prints the **License Artifact** it computes — never the key
  material used to compute it.
- `license-keygen.js` only ever prints the **public** key — never the private one.
- This tool has no relationship to the customer application's own login
  (`POST /api/session`) — its output is a signed document, structurally unrelated to any
  user id/password.
- This tool has no relationship to Support Access — separate keypair, separate directory,
  separate CLI, separate audit trail on the customer's side (`activity_logs` with
  `module='license'` vs `module='support'`).
