# Changelog

## 0.2.1 — 9 Nov 2026 (SAL-121)

### Security
- **Kudosity V1 → Get Account** no longer outputs the account's API key and secret.
  `get-client.json` returns them in its response, so they reached workflow data and execution
  logs. They are now removed; every other field is unchanged, so existing workflows keep working.
  If you ran Get Account on 0.2.0 or earlier, consider rotating that account's API secret.
- The V1 credential test now calls `get-balance.json`, which does not echo the credentials.

## 0.2.0 — 5 Nov 2026

First release from this repository under the `n8n-nodes-kudosity` name. 0.1.x (one node,
"Kudosity") came from the earlier Burst SMS repository; 0.2.0 replaces it and keeps it working.

### Added
- **Kudosity V2** node: Send SMS, MMS, WhatsApp (text and template, with SMS fallback) and RCS;
  **List SMS** with filters (dates, sender, recipient, reference, status, direction, order) and
  real paging for Return All; **Track Links** on Send SMS.
- **Kudosity V1** node for the `api.transmitsms.com` API: send, cancel, delivery status, replies,
  numbers, sender IDs, account, format number, set forward URL.
- **Kudosity V1 Trigger** (inbound to a virtual number) and **Kudosity V2 Trigger** (inbound,
  delivery and other events, one webhook for all selected events).
- Readable error messages for every error shape the APIs return; Continue On Fail support.
- Usage headers on every request (`User-Agent`, `X-Kudosity-Source`, `X-Kudosity-Source-Version`,
  `X-Kudosity-Action`) — no message content or personal data.

### Kept for 0.1.x users
- The original **Kudosity** node and **Kudosity API** credential are still included, under the
  same names, so existing workflows and saved credentials keep working after updating. The node is
  hidden from the node panel and marked deprecated; use Kudosity V2 for new workflows.
- Fixed in that node: **Return All** on List now pages through every result (0.1.x returned only
  the first page); errors are readable; the status filter accepts every API status.

### Removed
- The unused `regex-not` runtime dependency from 0.1.x. The package has no runtime dependencies.
