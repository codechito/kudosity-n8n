import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/**
 * Turns a Kudosity API failure into something a user can act on.
 *
 * The APIs return six different error shapes, observed live on 22 Oct 2026:
 *
 *   v1 auth       {"error":{"code":"AUTH_FAILED","description":"..."}}
 *   v1 field      {"error":{"code":"FIELD_EMPTY","description":"Field msisdn is required"}}
 *   v1 non-Basic  Authorisation failed                        <- plain text, not JSON
 *   v2 auth       {"status":"Unauthorized"} / {"status":"Invalid api key"}
 *   v2 simple     {"error":"sender: required"}                <- error is a string
 *   v2 rich       {"error":{"detail":"Request validation failed",
 *                           "issues":[{"name":"sender","message":"invalid sender number"}]}}
 *
 * Extracting the text is only half the job. "invalid sender number" and "Invalid
 * content_url" are accurate and still leave the user guessing, so known causes carry
 * the fix with them.
 */

interface Parsed {
	code?: string;
	text: string;
	fields: string[];
}

function parse(body: unknown): Parsed {
	if (body === null || body === undefined) return { text: '', fields: [] };

	if (typeof body === 'string') {
		const trimmed = body.trim();
		if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
			return { text: trimmed, fields: [] };   // plain text, e.g. "Authorisation failed"
		}
		try { return parse(JSON.parse(trimmed)); } catch { return { text: trimmed, fields: [] }; }
	}

	const obj = body as JsonObject;
	const err = obj.error;

	if (typeof err === 'string') return { text: err, fields: [] };

	if (err && typeof err === 'object') {
		const e = err as JsonObject;
		const issues = Array.isArray(e.issues) ? (e.issues as JsonObject[]) : [];
		const fields = issues.map((i) => String(i.name)).filter(Boolean);
		const detail = issues.length
			? issues.map((i) => `${i.name}: ${i.message}`).join('; ')
			: '';
		return {
			code: e.code ? String(e.code) : undefined,
			text: String(detail || e.description || e.detail || e.message || e.title || ''),
			fields,
		};
	}

	if (obj.status) return { text: String(obj.status), fields: [] };
	if (obj.message) return { text: String(obj.message), fields: [] };
	return { text: '', fields: [] };
}

/** Guidance for causes we have actually seen, keyed on what the API says. */
function advise(p: Parsed, status: number | undefined, apiVersion: 'v1' | 'v2'): string {
	const t = p.text.toLowerCase();

	if (p.code === 'AUTH_FAILED' || status === 401 || t.includes('unauthorized') || t.includes('invalid api key') || t.includes('authorisation failed')) {
		return apiVersion === 'v1'
			? 'The v1 API needs BOTH the API key and its secret — it authenticates with HTTP Basic over key:secret. Check both fields in the Kudosity V1 API credential, under Settings > API in your Kudosity account. A v2 key alone will not work here.'
			: 'The v2 API needs only the API key, sent as the x-api-key header. Check the key in the Kudosity V2 API credential, under Settings > API in your Kudosity account. Note the v1 secret is not used by v2.';
	}

	if (p.fields.includes('sender') || t.includes('invalid sender')) {
		return 'The sender is not valid for this channel. Run the Get Sender IDs operation on a Kudosity V1 node to see what this account may send as. A virtual number that works for SMS is often not provisioned for WhatsApp or RCS — that needs enabling on the account.';
	}

	if (t.includes('sender: required')) {
		return 'The v2 API requires a sender and will not fall back to an account default — unlike v1, where leaving From blank is allowed. Set Sender to one of the values returned by Get Sender IDs.';
	}

	if (t.includes('content_url')) {
		return 'Kudosity fetches this URL itself, so it must be publicly reachable and serve an image content type. A URL that opens fine in a browser can still fail: some hosts block Kudosity\'s fetcher, and a redirect to an HTML page will be rejected as the wrong content type.';
	}

	if (p.code === 'FIELD_EMPTY' && t.includes('msisdn')) {
		return 'Get Delivery Status needs the recipient number as well as the message ID. Set Recipient Number to the number the message was sent to.';
	}

	if (p.code === 'FIELD_INVALID' && t.includes('message_id')) {
		return 'Get Replies needs a Message ID — the API has no "all recent replies" call. Use the ID returned when the message was sent.';
	}

	if (p.code === 'NOT_IMPLEMENTED' || status === 404) {
		return 'The endpoint does not exist on this API. If this came from a Kudosity node rather than a custom call, it is a bug worth reporting.';
	}

	if (status === 429) {
		return 'Rate limited. Add a Wait node, or lower the batch size on the node feeding this one.';
	}

	if (status && status >= 500) {
		return 'Kudosity returned a server error, so the request itself is probably fine. Retrying shortly is usually the right move — turn on "Retry On Fail" in this node\'s settings to do that automatically.';
	}

	return '';
}

/**
 * @param apiVersion which API was called — the remedies differ, and telling a v2 user
 *                   to check their secret would send them looking for one they do not have.
 */
export function kudosityApiError(
	node: INode,
	error: unknown,
	apiVersion: 'v1' | 'v2',
): NodeApiError {
	const e = error as { statusCode?: number; status?: number; message?: string; body?: unknown; error?: unknown };
	const status = e.statusCode ?? e.status;
	const parsed = parse(e.body ?? e.error ?? e);

	const headline = parsed.text || e.message || 'The request to Kudosity failed';
	const guidance = advise(parsed, status, apiVersion);
	const label = apiVersion.toUpperCase();

	return new NodeApiError(node, (e as JsonObject) ?? {}, {
		message: `Kudosity ${label}${status ? ` (HTTP ${status})` : ''}: ${headline}`,
		description: guidance || undefined,
		httpCode: status ? String(status) : undefined,
	});
}
