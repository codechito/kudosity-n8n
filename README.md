# Kudosity for n8n

Send SMS, MMS, WhatsApp, and RCS messages — and receive inbound events — directly inside your n8n workflows using your Kudosity account.

---

## What you can do

| Action | Description |
|---|---|
| **Send SMS** | Send a text message to any mobile number |
| **Send MMS** | Send a message with an image, video, or document |
| **Send WhatsApp** | Send a plain text or pre-approved template message |
| **Send RCS** | Send a rich message (with optional SMS fallback) |
| **Receive Events** | Trigger a workflow when an SMS/MMS arrives, a delivery status changes, a contact opts out, or a link is clicked |

---

## Before you start

You will need:

- An active **Kudosity account** with API access enabled
- Your **Kudosity API Key** (see below)
- An **n8n instance** with this package installed: **Settings → Community nodes → Install**, enter `n8n-nodes-kudosity`. Already have 0.1.x installed? Use **Update** instead — see *Upgrading from 0.1.x* below.

---

## Step 1 — Get your Kudosity API Key

1. Log in to your Kudosity account at [app.kudosity.com](https://app.kudosity.com)
2. Go to **Settings** → **API**
3. Copy your API Key — keep it somewhere safe, you'll need it in the next step

---

## Step 2 — Add your API Key to n8n

1. In n8n, open any workflow and add a **Kudosity V2** node (or **Kudosity V2 Trigger** node)
2. Click **Create new credential** in the credential dropdown
3. Paste your API Key into the **API Key** field
4. Click **Save** — n8n will verify the key automatically

Your credential is now saved and can be reused across all your Kudosity nodes.

---

## Step 3 — Send a message

### Send an SMS

1. Add a **Kudosity V2** node to your workflow
2. Select your saved credential
3. Set **Operation** to **Send SMS**
4. Fill in the fields:

| Field | Description | Example |
|---|---|---|
| **Recipient Phone** | The mobile number to send to (include country code) | `+61412345678` |
| **Sender** | Your registered sender number or Sender ID | `+61481074185` or `MYBRAND` |
| **Message** | The text to send (over 160 characters will be split) | `Hi John, your order is ready!` |
| **Message Reference** | *(Optional)* Your own tracking ID | `order-1234` |

---

### Send an MMS

1. Set **Operation** to **Send MMS**
2. Fill in the fields:

| Field | Description | Example |
|---|---|---|
| **Recipient Phone** | Mobile number (with country code) | `+61412345678` |
| **Sender** | Registered sender number | `+61481074185` |
| **Media URL** | A publicly accessible link to your image, video, or document | `https://example.com/promo.jpg` |
| **Subject** | *(Optional)* Subject line for the MMS | `Your special offer` |
| **Message Body** | *(Optional)* Text to accompany the media | `Check out this week's deal!` |

> **Note:** The media file must be publicly accessible on the internet. Files behind a login or on a private server won't work.

---

### Send a WhatsApp Message

1. Set **Operation** to **Send WhatsApp Message**
2. Choose a **Content Type**:

**Text Message** — a free-form message (only works within 24 hours of a contact messaging you first)

| Field | Description |
|---|---|
| **Recipient Phone** | Mobile number with country code |
| **Sender** | Your WhatsApp-registered number |
| **Text Message Body** | The message to send |

**Template Message** — use a pre-approved WhatsApp template

| Field | Description | Example |
|---|---|---|
| **Template Name** | The exact name of your approved template | `welcome_new_customer` |
| **Template Parameters** | Comma-separated values to fill in placeholders | `John, 20%OFF, 31 Dec` |
| **Template Locale** | Language code for the template | `en` |

**SMS Fallback (optional)** — if WhatsApp delivery fails, send an SMS instead:

| Field | Description |
|---|---|
| **SMS Fallback Sender** | The number to send the fallback SMS from |
| **SMS Fallback Message** | The SMS text to send if WhatsApp fails |

---

### Send an RCS Message

1. Set **Operation** to **Send RCS Message**
2. Fill in the fields:

| Field | Description |
|---|---|
| **Recipient Phone** | Mobile number with country code |
| **Sender** | Your RCS Agent ID |
| **Message** | The message body (up to 3,072 characters, supports emoji) |
| **SMS Fallback Sender** | *(Optional)* Fallback SMS number if the device doesn't support RCS |
| **SMS Fallback Message** | *(Optional)* SMS text to send as fallback |

---

### List SMS

1. Add a **Kudosity V2** node and set **Operation** to **List SMS**
2. Set a **Limit**, or turn on **Return All** to fetch every matching message page by page
3. Optionally add **Filters**: start and end date, sender, recipient, message reference, status,
   direction (inbound or outbound) and order

Each message is returned as its own item, ready for the next node.

To shorten and track links in an outgoing SMS, turn on **Track Links** on **Send SMS**.

---

## Step 4 — Receive events (Trigger node)

Use the **Kudosity V2 Trigger** node to start a workflow whenever something happens in Kudosity.

1. Add a **Kudosity V2 Trigger** node as the first node in your workflow
2. Select your saved credential
3. Choose which **Events** to listen for:

| Event | When it fires |
|---|---|
| **SMS Inbound** | A contact sends an SMS reply to your number |
| **SMS Status** | Delivery status update for an outbound SMS |
| **MMS Inbound** | A contact sends an MMS reply |
| **MMS Status** | Delivery status update for an outbound MMS |
| **RCS Status** | Delivery status update for an outbound RCS message |
| **Opt Out** | A contact opts out of receiving messages |
| **Link Hit** | A contact clicks a tracked link in your message |

4. **Activate** your workflow (top-right toggle) — this automatically registers the webhook in your Kudosity account
5. When you deactivate or delete the workflow, the webhook is removed from Kudosity automatically

**Data available in your workflow after a trigger:**

| Field | Description |
|---|---|
| `event_type` | The type of event (e.g. `SMS_INBOUND`) |
| `phone` | The contact's phone number |
| `sender` | The number the message was sent from |
| `recipient` | The number the message was sent to |
| `message` | The message content (for inbound events) |
| `status` | Delivery status (for status events) |
| `url` | The link that was clicked (for `LINK_HIT` events) |
| `message_ref` | Your custom tracking reference (if set) |
| `id` | The Kudosity message ID |
| `created_at` | Timestamp of the event |

---

## Tips

- **Phone numbers** must always include the country code in E.164 format — e.g. `+61412345678` for Australia, `+12025551234` for the US
- **Message Reference** is useful for linking Kudosity messages back to records in your CRM or database
- You can select **multiple events** in a single Kudosity Trigger node. Use a **Switch** or **Filter** node after it to route different event types to different parts of your workflow
- If a WhatsApp or RCS message fails and you have set up an SMS fallback, Kudosity will automatically send the SMS — no extra steps needed in n8n

---

## What this node tells Kudosity

Every request this node makes to Kudosity includes a few headers that identify the
integration, so Kudosity can see how it is used and which versions are still in use:

| Header | Example | Meaning |
|---|---|---|
| `User-Agent` | `kudosity-n8n/0.1.0` | This integration and its version |
| `X-Kudosity-Source` | `kudosity-n8n` | This integration |
| `X-Kudosity-Source-Version` | `0.1.0` | Its version |
| `X-Kudosity-Action` | `sms.send` | What the request is for, e.g. `connect` (testing your credentials), `sms.send`, `trigger.subscribe` |

These headers never contain message content, phone numbers, workflow names or anything
about you. Your account is already identified by your API key, as it is for any request.

## Upgrading from 0.1.x

Version 0.1.x had a single **Kudosity** node. 0.2.0 replaces it with the V1 and V2 nodes and
triggers, and **keeps the old node** so your existing workflows keep running:

1. In n8n, go to **Settings → Community nodes**, open the ⋮ menu on `n8n-nodes-kudosity` and choose
   **Update**. Don't uninstall first — that removes the node your workflows use.
2. Existing workflows and saved **Kudosity API** credentials work as before. The old node no longer
   appears in the node panel and is marked deprecated.
3. For new workflows, use **Kudosity V2**. It does everything the old node did — Send SMS (with Track
   Links) and List SMS — plus MMS, WhatsApp, RCS and triggers.

One improvement you may notice: **Return All** on the old node's List operation now returns every
message, not just the first page.

## Need help?

- Kudosity documentation: [developers.kudosity.com](https://developers.kudosity.com)
- n8n documentation: [docs.n8n.io](https://docs.n8n.io)
