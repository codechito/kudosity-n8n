import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { trackingHeaders } from '../nodes/shared/tracking';

/**
 * Credential of the original n8n-nodes-kudosity (≤ 0.1.6), kept so workflows and
 * saved credentials created with that package keep working after upgrading.
 *
 * The name and field names (`apiKey`, `password`) must not change: n8n matches
 * saved credentials by them. New workflows should use the V1 or V2 credentials.
 */
export class KudosityApi implements ICredentialType {
	name = 'kudosityApi';

	displayName = 'Kudosity API (legacy)';

	documentationUrl = 'https://developers.kudosity.com';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The API key obtained from your Kudosity account (also used as Basic Auth username)',
		},
		{
			displayName: 'API Secret',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'The API secret from your Kudosity account (also used as Basic Auth password)',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	/** Not in 0.1.6; harmless read, and sends the 'connect' signal (SAL-94). */
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.transmitmessage.com/v2',
			url: '/sms?limit=1',
			method: 'GET',
			headers: trackingHeaders('connect'),
		},
	};
}
