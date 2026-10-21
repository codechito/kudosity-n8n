import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credentials for the v1 API (api.transmitsms.com/*.json).
 *
 * v1 authenticates with HTTP Basic over `key:secret`, which is what the Kudosity
 * Salesforce package sends and is proven in production.
 *
 * The secret is marked optional because v1 may accept the key alone — Basic auth
 * with an empty password is a common pattern — but that has not been verified
 * against the live API. Leave it blank to test; if authentication fails, fill it in.
 * Do not assume key-only works until a real request has returned 200.
 *
 * Note this is a different scheme from v2, which sends the key raw in the
 * Authorization header with no Basic encoding and no secret.
 */
export class KudosityV1Api implements ICredentialType {
	name = 'kudosityV1Api';

	displayName = 'Kudosity V1 API';

	documentationUrl = 'https://developers.kudosity.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Your Kudosity API key. Found under Settings > API in your account.',
		},
		{
			displayName: 'API Secret',
			name: 'apiSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Your Kudosity API secret. Try leaving this blank first — v1 may accept the key alone. If requests come back 401, fill it in.',
		},
	];
}
