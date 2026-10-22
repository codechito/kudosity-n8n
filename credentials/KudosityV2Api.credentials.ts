import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class KudosityV2Api implements ICredentialType {
	name = 'kudosityV2Api';
	displayName = 'Kudosity V2 API';
	documentationUrl = 'https://developers.kudosity.com';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'Enter your Kudosity API Key',
			description:
				'Find your API key in your Kudosity account under <strong>Settings &gt; API</strong>.',
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

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.transmitmessage.com/v2',
			url: '/sms?limit=1',
			method: 'GET',
		},
	};
}
