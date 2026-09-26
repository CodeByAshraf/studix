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
against the public key built into the Studix release it is running (see "The trust-anchor
model" below). Two tools live here:

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

## The trust-anchor model

Three different things are involved — keep them distinct:

- **Private signing key** (`license-private-key.pem`) — yours alone. Lives only in your
  owner-controlled directory; never shipped with Studix, never in the installer, never in
  the Studix source tree, and never stored in any Studix database.
- **Release public trust anchor** — your licensing **public** key, built into each Studix
  release (`backend/src/lib/licensingTrustAnchor.js`, together with its SHA-256
  fingerprint). This is the authoritative verification key: every license is verified
  against it.
- **Database value** (`license_config.licensing_public_key`) — a copy of the release's key,
  written by the installer. It is not an independent source of trust: the app uses it only
  when it is the same key the release carries.

### Provisioning is automatic

- **Fresh installation:** the installer writes the release's public key into
  `license_config` as part of installation. There is no `psql` step and nothing to do per
  customer before their first activation.
- **Upgrade / re-running the installer:** the same step runs again. If the key is already
  correct, nothing changes; an existing activation and all other data are never touched —
  only the key value itself.
- **Missing, unreadable, or mismatched key:** the app refuses to use it — the Activate screen
  reports that the licensing key does not match this Studix version (reason
  `trust_anchor_mismatch`) and activation is refused. Re-running the installer restores the
  release's key. Never "fix" this by editing the key in the database: a hand-edited key is
  simply not trusted, so it cannot be used to make a license signed with a different key
  verify.

To confirm which key a release trusts, compare the release's recorded fingerprint
(`EXPECTED_LICENSING_PUBLIC_KEY_SHA256` in `licensingTrustAnchor.js`) with your own key
file's SHA-256 (of its DER-encoded public key):

```
node -e "const c=require('crypto');const k=c.createPublicKey(require('fs').readFileSync(process.argv[1],'utf8'));console.log(c.createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex'))" "<path to license-public-key.pem>"
```

## Machine binding

Every license issued now binds to two things, both signed into the artifact and both
re-checked on every single verification (not just at activation time):

- **`installationId`** — this specific PostgreSQL installation (unchanged from before).
- **`machineId`** — the physical Windows machine that installation is running on.

`machineId` is a SHA-256 fingerprint of the machine's Windows `MachineGuid`
(`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` — a stable identifier Windows itself
generates per OS install, distinct from any disk/volume serial). The **raw** MachineGuid is
never included in the Activation Request Code, never included in the License Artifact, and
never logged — only the derived fingerprint travels between the customer and you. See
`backend/src/lib/machineIdentity.js`.

The current machine's fingerprint is always recomputed live from the machine itself at
verification time — it is never read from a database column (there is no such column;
`license_config` stores no machineId at all). The **only** source of truth for "what machine
this license belongs to" is the value inside the signed artifact; the **only** source of
truth for "what machine is this" is a fresh registry read on that machine, right now. This
is why a copied or restored PostgreSQL data directory no longer carries a working license to
a different machine (see "Known limitations" below for what changed).

### What this means for you as the issuer

The customer's **Activation Request Code** now carries their `machineId` alongside
`installationId`/`product` — decoded and shown back to you (`Machine: ...`) exactly like
`Installation: ...` already is, before you issue anything. You don't do anything differently
day-to-day; `license-issuer.js` reads it from the request code and signs it into the
artifact automatically.

### Machine identity read failures

If Studix cannot read the registry at all (non-Windows, corrupted registry, insufficient
permissions), it fails closed — the app reports the installation as unlicensed
(`machine_identity_unavailable`) rather than silently skipping the machine check. This can
never be worked around from the Activate screen; it requires fixing whatever is blocking the
registry read on that machine.

## Issuing a license for a customer

1. The customer opens the "Activate Studix" screen in their app (an admin logs in first —
   activation is admin-only) and generates an **Activation Request Code**. They send it to
   you through a channel you already trust for that customer.
2. Run:
   ```
   node tools/license-issuer.js
   ```
3. Paste the request code when prompted — it decodes to the customer's `installationId`,
   `machineId`, and `product`, shown back to you for a sanity check.
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

Because the Activation Request Code always carries the customer's **current** machine
fingerprint, a fresh request code from the same physical machine reissues a license that
still verifies fine — nothing customer-visible changes for an ordinary renewal.

### When a NEW request code (and re-issuance) is required

The Activate screen always tells the customer exactly which of these applies via the
`reason` it reports; you never have to guess which happened.

| Situation | What happens | What to do |
|---|---|---|
| **Same machine, same/restored PostgreSQL data** (routine backup restore, service restart, upgrade) | Keeps working — `installationId` and `machineId` are both unchanged. | Nothing. |
| **pgdata copied/restored onto a *different* physical machine** | Blocked (`wrong_machine`) — the signed artifact's `machineId` no longer matches this machine's fingerprint. | Not a bug — this is the intended fix for the previously-documented cloning gap. See "License transfer" below if this move is legitimate. |
| **Windows reinstalled on the same physical machine** | `MachineGuid` is regenerated by Windows on a clean reinstall (in-place "keep files" upgrades usually do NOT change it, but a genuinely clean/fresh install does) → the license may become `wrong_machine`. | Generate a new Activation Request Code from the reinstalled system and issue a fresh artifact. |
| **Motherboard/hardware replacement** | `MachineGuid` lives in the Windows installation, not in hardware — a straight motherboard swap under the *same* Windows install typically leaves it unchanged. A full Windows reinstall alongside the hardware swap changes it (see above). | Only re-issue if the customer confirms Windows itself was reinstalled or `wrong_machine` actually appears. |
| **Customer legitimately moving Studix to new hardware** (old PC retired, etc.) | Old machine's artifact will not work on the new machine. | Customer generates a fresh Activation Request Code **on the new machine** and sends it to you; issue a new artifact against it. There is no self-service "transfer" — every move goes through you, same as any other issuance, consistent with this being a fully offline, manually-issued product (no online activation server exists or is planned). |
| **A pre-machine-binding (`v1`) license still in use** | Rejected with `unbound_license` — a distinct, clear reason (never silently treated as still valid). | Customer generates a new Activation Request Code (now includes their `machineId` automatically) and you issue a new `v2` artifact. This is a one-time forced re-activation for any installation that had already activated before this feature existed. |

## Protecting and backing up the private key

- Treat `license-private-key.pem` exactly like a root password or a signing certificate: it
  is the **only** thing standing between "anyone" and "only the real software owner" being
  able to issue a valid license for any Studix installation (every release trusts your
  public key).
- Back it up to an encrypted location you control — losing it is unrecoverable for future
  licenses (see below).
- Never email it, paste it into chat, commit it to any repository, copy it onto a
  customer's machine, or store it in plain cloud storage.
- Never let it touch the same file, chat message, or backup as your Support Access private
  key — they must stay independently compromise-able/recoverable.

## If you lose the private key

There is no recovery. No current Studix release will accept a license you sign with any
other key. You would need to generate a new keypair (`license-keygen.js --force`) and follow
"Rotating the licensing key" below. Installations stay activated with their existing license
until they install the release that carries the new key — from then on that old license no
longer verifies, and each customer needs a newly issued one.

## If you suspect the private key is compromised

Follow "Rotating the licensing key" below. There is nothing further to "revoke" on the old
key itself — once customers run the release that carries the new key, the old key is no
longer trusted anywhere.

## Rotating the licensing key

Rotation always takes a new Studix release — the trust anchor is part of the release, not
something set per installation:

1. Generate a new keypair: `node tools/license-keygen.js --force` (this **overwrites** your
   existing private key file locally — make sure you actually intend this).
2. Put the new **public** key into `backend/src/lib/licensingTrustAnchor.js`
   (`EXPECTED_LICENSING_PUBLIC_KEY_PEM`) and update `EXPECTED_LICENSING_PUBLIC_KEY_SHA256`
   to its fingerprint (command above), then build and ship a new Studix release — a
   deliberate, reviewed change.
3. Installing that release replaces each installation's key automatically. A license signed
   with the old key stops verifying after that upgrade, so every customer needs a new
   license: they send a fresh Activation Request Code and you issue a new artifact with the
   new key.
4. Until the new release is installed, licenses signed with the new key will not activate
   on that installation.

## Known limitations

- **No revocation list.** A superseded artifact, if resubmitted, still verifies successfully
  (deliberate, unchanged by machine binding — see `licenseHardening.integration.test.js`).
- **`MachineGuid` is a software-level identifier, not a cryptographic hardware root of
  trust.** It is stable under normal use (reboots, updates, most hardware swaps under the
  same Windows install) but is regenerated by a clean Windows reinstall, and — in principle
  — could be read and replayed by a sufficiently privileged local attacker who also controls
  the customer's own machine. This mechanism raises the bar from "any PostgreSQL backup
  works anywhere" to "requires access to, or emulation of, the specific licensed machine's
  own OS-level identity" — it is not a substitute for physical/OS-level security on the
  customer's machine.
- **No online activation server**, by design — every issuance/re-issuance is manual and
  offline, exactly as before. This does mean every genuine machine change requires you
  personally to issue a new artifact; there is no self-service path, and none is planned.

## Security notes (do not skip)

- The private key is **never**: committed to Git, stored in the frontend, stored in backend
  source code, stored in `.env`, stored in the database, included in the production build
  or installer, embedded in this tool's source code, logged to the console, or printed by
  any diagnostic command.
- `license-issuer.js` only ever prints the **License Artifact** it computes — never the key
  material used to compute it.
- `license-keygen.js` only ever prints the **public** key — never the private one.
- Only the **public** key is ever part of a Studix release (the trust anchor). The database
  copy of it is not a trust source: changing it cannot change who is able to sign licenses.
- This tool has no relationship to the customer application's own login
  (`POST /api/session`) — its output is a signed document, structurally unrelated to any
  user id/password.
- This tool has no relationship to Support Access — separate keypair, separate directory,
  separate CLI, separate audit trail on the customer's side (`activity_logs` with
  `module='license'` vs `module='support'`).
