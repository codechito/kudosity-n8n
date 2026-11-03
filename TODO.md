# TODO — Kudosity n8n community node

Tasks are tracked in Jira, in the **SAL** project (Salesforce Integration) under the label
`n8n`. That is a temporary home until an integrations project exists. Moved there on
3 Nov 2026; this file is no longer the task list.

All n8n tickets: https://kudosity.atlassian.net/issues/?jql=project%3DSAL%20AND%20labels%3Dn8n

## Open

| Ticket | Task |
|---|---|
| [SAL-95](https://kudosity.atlassian.net/browse/SAL-95) | Resolve the npm package name and publish |
| [SAL-96](https://kudosity.atlassian.net/browse/SAL-96) | Install on the n8n server and test both triggers end to end |
| [SAL-97](https://kudosity.atlassian.net/browse/SAL-97) | Decide on verified community node status |
| [SAL-94](https://kudosity.atlassian.net/browse/SAL-94) | Tag API requests with source, version and action headers (shared with Make) |
| [SAL-103](https://kudosity.atlassian.net/browse/SAL-103) | Provision WhatsApp and RCS senders, or document the limit (shared with Make) |
| [SAL-104](https://kudosity.atlassian.net/browse/SAL-104) | Decide whether to move the repo to a company GitHub org (shared with Make) |

## Done

| Ticket | Work | Completed |
|---|---|---|
| [SAL-105](https://kudosity.atlassian.net/browse/SAL-105) | Make the package build and install from GitHub | 22 Oct 2026 |
| [SAL-106](https://kudosity.atlassian.net/browse/SAL-106) | Add the V1 node for api.transmitsms.com | 21 Oct 2026 |
| [SAL-107](https://kudosity.atlassian.net/browse/SAL-107) | Live-check harness and first live run against the real API | 22 Oct 2026 |
| [SAL-108](https://kudosity.atlassian.net/browse/SAL-108) | Fix V2 authentication and stop leaking credentials | 22 Oct 2026 |
| [SAL-109](https://kudosity.atlassian.net/browse/SAL-109) | Register one webhook with an event-type filter | 22 Oct 2026 |
| [SAL-110](https://kudosity.atlassian.net/browse/SAL-110) | Translate Kudosity API errors into readable messages | 22 Oct 2026 |
| [SAL-111](https://kudosity.atlassian.net/browse/SAL-111) | Cover the continueOnFail path and verify live | 2 Nov 2026 |

Put the ticket key in commit messages (e.g. `fix: ... (SAL-96)`), as the Salesforce repos do.
