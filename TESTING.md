# First live test — n8n

Everything in this package is unit-tested against fakes and has **never touched the real
API**. This is the run that finds out what is actually true.

Work top to bottom. Each step says what to record, because several later decisions depend
on what the earlier steps return.

---

## Before you start

You need:

- SSH access to the n8n server
- A Kudosity account with credit
- **A spare virtual number** — see the warning at step 7. Do not use one that feeds
  Salesforce or Eloqua.
- A real handset you can send to and reply from

---

## 1. Install

**Not** through Settings → Community nodes. That installer only accepts npm package names
— it runs `npm install` against the npm registry — and this package is not published. It
will not take a GitHub URL.

Use n8n's custom-extensions directory instead.

### Straight from GitHub — simplest

On the n8n server:

```bash
mkdir -p ~/.n8n/custom
cd ~/.n8n/custom
npm init -y                                  # first time only
npm install github:codechito/kudosity-n8n
# restart n8n
```

The package has a `prepare` script, so npm compiles it after cloning. Nothing to copy and
nothing to publish. To pick up later changes, push to `main` and re-run the same command.

### From a tarball — if the server cannot reach GitHub

On this Mac:

```bash
cd ~/Developer/kudosity/kudosity-n8n
npm test            # builds, then runs 41 tests. Must be green before you ship it.
npm pack            # → n8n-nodes-kudosity-0.1.0.tgz
scp n8n-nodes-kudosity-0.1.0.tgz you@server:/tmp/
```

On the server:

```bash
cd ~/.n8n/custom && npm install /tmp/n8n-nodes-kudosity-0.1.0.tgz
```

### Docker

`~/.n8n` is inside the container. Either exec in and run the same commands against
`/home/node/.n8n/custom`, or mount a host directory there so installs survive a restart.
`N8N_CUSTOM_EXTENSIONS` can point somewhere else if you prefer.

**Verify:** open n8n, search the node panel for "Kudosity". Four nodes should appear:

- Kudosity V1
- Kudosity V1 Trigger
- Kudosity V2
- Kudosity V2 Trigger

Each should show the Kudosity icon, not a generic placeholder. A missing icon means the
`copy-icons` build step did not run.

**If nothing appears at all**, n8n did not load the package. Check its startup log for the
custom-extensions path it is actually reading.

---

## 2. The question that blocks everything else

**Does the v1 API accept the API key with no secret?**

This is first because both integrations are built on an unanswered guess. The n8n V1
credential and the Make V1 connection both mark the secret optional, pending this.

1. Create a **Kudosity V1 API** credential. Fill in the API Key. **Leave API Secret blank.**
2. Add a **Kudosity V1** node, operation **Get Account**. Execute it.

This is a read-only call that costs nothing and sends no message.

| Result | Meaning | Do this |
|---|---|---|
| Account JSON comes back | Key alone is enough | Record it. The secret can stay optional, and Make can drop it too |
| 401 or auth error | The secret is required | Fill the secret in, re-run. Then make the field **required** in both n8n and Make |

**Record:** which one, and the exact error text if it failed.

Do not move on until this is settled — every later v1 step depends on the credential
working.

---

## 3. Read-only v1 operations

Still on the **Kudosity V1** node. These cost nothing, so they are the cheap way to prove
the request shapes are right before spending credit.

| Operation | Expect |
|---|---|
| Get Account | Account details and balance |
| Get Numbers | Your virtual numbers — **note one you can spare for step 7** |
| Get Sender IDs | Sender IDs on the account |
| Format Number | Give it `0412345678` and `AU`; expect international format back |

**Record:** anything that errors, and the full error body. The error shape is itself an
open question — the Make app guesses at `body.error.message` falling back to
`body.message`, and a real one settles it.

---

## 4. First v1 send

**Kudosity V1**, operation **Send SMS**. To your own handset.

- **To** — your number
- **Message** — anything
- **From** — leave blank first, to confirm the account default works

**Expect:** the message arrives, and the response contains a message ID.

**Record:** the response JSON. The `message_id` field name matters for step 5.

Then try one with **Country Code** set to `AU` and a local-format number like
`0412345678`, which is the case the Salesforce package handles specially.

---

## 5. v1 lookups against a real message

Using the ID from step 4:

- **Get Delivery Status** — does it return a status?
- **Cancel SMS** — only meaningful on a scheduled message. Send one with **Send At** set a
  few minutes ahead, then cancel it and confirm it never arrives.

**Record:** whether `get-delivery-status.json` wants `message_id` or something else. This
endpoint was taken from the Eloqua integrator, not from documentation.

---

## 6. v2 operations

Create a **Kudosity V2 API** credential — API Key only, no secret.

On a **Kudosity V2** node, run each in turn:

| Operation | Note |
|---|---|
| Send SMS | Baseline |
| Send MMS | Needs a publicly reachable image URL |
| Send WhatsApp — Text | Only works to a number that has opted in |
| Send WhatsApp — Template | Needs an approved template name; parameters are comma-separated |
| Send RCS | Try once with an SMS fallback sender set, once without |

**Record:** the response for each, and any field the API rejects or ignores. The tests pin
the exact body shape, so anything different means the tests need correcting — tell me what
came back and I will fix them.

---

## 7. The V1 trigger — read this first

⚠️ **Activating this overwrites the virtual number's forward URL.**

A v1 number has exactly one forward URL. Whatever it points at now stops receiving the
moment you activate. If that number feeds a Salesforce org or an Eloqua instance, that
feed breaks silently — nothing warns either side.

**There is no API to read the current value back**, so it cannot be recorded first or
restored afterwards. Use a number from step 3 that you know is unused.

Then:

1. Add a **Kudosity V1 Trigger**, set **Virtual Number** to `61430251585`
2. Activate the workflow — this writes the forward URL
3. **Send from the other virtual number to it.** Add a Kudosity V1 node in a second
   workflow: To `61430251585`, From `61426308477`, any message. Run it.
   (A handset works too, but is not needed.)
4. The trigger workflow should fire, with `phone`, `message` and `raw` populated
5. Deactivate, and confirm **Clear Forward URL on Deactivate** blanked it

Order matters: activate the trigger **before** sending. Inbound is forwarded, not
stored — a message that arrives with no forward URL registered is not queued and
cannot be replayed.

**Record:** which field the inbound actually arrives in. The node reads `mobile`, `msisdn`
and `from` for the sender, and `response` and `message` for the text, because v1 is
inconsistent. `raw` holds the untouched payload — paste that to me and I will narrow the
mapping to what is real.

---

## 8. The V2 trigger — the other open question

**Does Kudosity register one webhook per event type, or send everything to one URL?**

The node assumes per-event-type, and so does the Make app. If that is wrong, both need the
same change.

1. Add a **Kudosity V2 Trigger**, select two event types only — say **SMS Inbound** and
   **Opt Out**
2. Activate
3. In the Kudosity portal, look under **Settings → Webhooks**

**Expect:** two webhook entries named `n8n - SMS Inbound` and `n8n - Opt Out`.

| What you see | Meaning |
|---|---|
| Two entries, one per type | The assumption holds. Nothing to change |
| One entry | `event_type` is being ignored. Both integrations must drop the field and filter after the trigger instead |

4. Send a real inbound and confirm the workflow fires
5. Deactivate and confirm both webhook entries are removed

**Record:** how many entries appeared, and their names.

---

## Already settled — do not re-run these

Verified against the sandbox account on 22 Oct 2026 with `scripts/live-check.js`:

- **Credentials.** V1 needs key + secret via Basic. V2 needs the key alone via
  `x-api-key`. **Same key for both.**
- **V1 working:** Get Account, Get Numbers, Get Sender IDs, Format Number, Send SMS
  (default sender, named sender, country-code expansion), scheduled send, Cancel SMS,
  Get Delivery Status, Get Replies.
- **V2 working:** Send SMS (with and without `message_ref`), Send MMS.
- **V2 webhook registration.** **One** webhook carries every selected event type in a
  `filter.event_type` array; the label field is `name`. A `webhook_name` field is
  rejected outright. Both integrations had this wrong and registration had never
  worked — now fixed and verified by registering and deleting a real webhook.
- **V1 tolerates a blank sender** and falls back to the account default. **V2 rejects
  one** with 400 `{"error":"sender: required"}`.
- **The V1 trigger's whole lifecycle** against the real API: `checkExists` false,
  `create` registers the forward URL, `checkExists` true, `delete` clears it. Also
  confirmed there is genuinely no way to read a forward URL back —
  `get-number-options.json` is 404 and `get-numbers.json` does not return it.
- **Endpoint names.** `/get-delivery-status.json` is 404 NOT_IMPLEMENTED; the real one
  is `/get-sms-delivery-status.json`, and it needs `msisdn` as well as `message_id`.
  Get Replies requires `message_id` — there is no all-recent-replies call.
- **Six error shapes.** `error` is variously an object with `description`, an object with
  `detail` and `issues[]`, or a bare string; one response is not JSON at all.

## Still to bring back

1. **The raw v1 inbound payload** (step 7)
3. **WhatsApp and RCS** (step 6) returned `invalid sender number` / `invalid sender`.
   The virtual numbers are not provisioned for those channels — an account question,
   not a code one. MMS is done, but note the content URL must be one Kudosity can
   actually fetch: Wikipedia is blocked, `w3.org` works.
2. **Whether a non-auth v1 error matches the auth shape** — `FIELD_EMPTY` and
   `FIELD_INVALID` both use the same `error.code` / `error.description` object, so this
   is all but settled

### Why the inbound half needs your server

Inbound **is** reproducible on the sandbox account — send from one virtual number to the
other and the receiving number treats it as inbound. What it needs is a **publicly
reachable webhook**, because inbound is *forwarded, not stored*: with no forward URL
registered there is nothing to observe, and the message does not appear in
`GET /v2/sms` as `direction: IN` either. That is why an attempt from a laptop with no
public endpoint saw nothing.

Your n8n server has a public URL. That is the only missing piece, and it is why step 7
stays on the list while everything else is settled.

---

## If something is broken

The package is installed from a tarball, so rolling back is removing it:

```bash
cd ~/.n8n/custom && npm uninstall n8n-nodes-kudosity
# restart n8n
```

Nothing is published to npm and nothing else depends on it, so there is no wider blast
radius. The one action with a side effect outside n8n is step 7 — overwriting a number's
forward URL.
