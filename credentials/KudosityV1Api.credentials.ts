import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { trackingHeaders } from '../nodes/shared/tracking';

/**
 * Credentials for the v1 API (api.transmitsms.com/*.json).
 *
 * v1 authenticates with HTTP Basic over `key:secret`, which is what the Kudosity
 * Salesforce package sends and is proven in production.
 *
 * Both halves are required. The Kudosity Salesforce package and the Eloqua
 * integrator have both sent key:secret against this API in production for a long
 * time, and no evidence has been found that a key alone is accepted.
 *
 * Note this is a different scheme entirely from v2, which needs no secret and sends
 * its key in an x-api-key header. A v2 key does not authenticate here under any
 * scheme tested, including x-api-key — the two APIs issue separate credentials.
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
			required: true,
			description:
				'Your Kudosity API secret. v1 authenticates with Basic auth over key:secret, so both halves are needed.',
		},
	];

	/**
	 * Used only by the credential test below. The V1 nodes build their own Basic
	 * header, so this does not change how they authenticate.
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			auth: {
				username: '={{$credentials.apiKey}}',
				password: '={{$credentials.apiSecret}}',
			},
		},
	};

	/**
	 * Lets n8n's "Test connection" check the key and secret, and sends the
	 * 'connect' action (SAL-94) — the install signal for V1 customers, who
	 * otherwise never trigger one. get-balance.json is read-only, documented, and
	 * unlike get-client.json does not echo the key and secret back. The Make app's
	 * V1 connection validates with the same call.
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.transmitsms.com',
			url: '/get-balance.json',
			method: 'GET',
			headers: trackingHeaders('connect'),
		},
	};
}
