/**
 * Usage tracking headers (SAL-94).
 *
 * Every request to a Kudosity API carries these, so Kudosity can report usage of
 * this integration per account: which integration, which release, and what the
 * request was for. The account itself is already identified by the API key, so
 * nothing here identifies a person.
 *
 * Never add message content, phone numbers, workflow names or user details.
 *
 * The values are prefixed `kudosity-` rather than plain "n8n" so they cannot be
 * confused with n8n's own generic HTTP Request node calling the same API.
 */

export const SOURCE = 'kudosity-n8n';

/** Must match package.json — test/headers.test.js enforces it. */
export const VERSION = '0.2.0';

/**
 * What a request is for. Shared vocabulary with the Make app, so reports can
 * compare the two integrations directly.
 *
 * `connect` is the credential test, which fires when a customer first connects.
 * Neither n8n nor Make tells us about installs, so this is the install signal.
 */
export type KudosityAction =
	| 'connect'
	| 'trigger.subscribe'
	| 'trigger.unsubscribe'
	| 'sms.send'
	| 'sms.list'
	| 'mms.send'
	| 'rcs.send'
	| 'whatsapp.send'
	| 'sms.cancel'
	| 'status.get'
	| 'replies.get'
	| 'account.get'
	| 'numbers.get'
	| 'senderids.get'
	| 'number.format'
	| 'number.forward';

export function trackingHeaders(action: KudosityAction): Record<string, string> {
	return {
		'User-Agent': `${SOURCE}/${VERSION}`,
		'X-Kudosity-Source': SOURCE,
		'X-Kudosity-Source-Version': VERSION,
		'X-Kudosity-Action': action,
	};
}
