import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { kudosityApiError } from '../shared/errors';
import { KudosityAction, trackingHeaders } from '../shared/tracking';

/**
 * The v1 API, as used in production by the Kudosity Salesforce package.
 *
 * Shares a host with v2 — api.transmitsms.com serves v1 at /<verb>.json and v2
 * under /v2/ — but not an auth scheme: v1 is HTTP Basic, v2 sends the key raw.
 *
 * Everything here is form-encoded, not JSON. Endpoints and field names are taken
 * from the Salesforce package's working calls rather than from documentation.
 */
const BASE_URL = 'https://api.transmitsms.com';

/** The X-Kudosity-Action sent for each operation (SAL-94). */
const ACTIONS: Record<string, KudosityAction> = {
	sendSms: 'sms.send',
	cancelSms: 'sms.cancel',
	getDeliveryStatus: 'status.get',
	formatNumber: 'number.format',
	getSenderIds: 'senderids.get',
	getAccount: 'account.get',
	getNumbers: 'numbers.get',
	getSmsResponses: 'replies.get',
	setForwardUrl: 'number.forward',
};

export class KudosityV1 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity V1',
		name: 'kudosityV1',
		icon: 'file:kudosity.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send SMS and manage numbers via the Kudosity v1 API',
		defaults: { name: 'Kudosity V1' },
		inputs: ['main'] as never,
		outputs: ['main'] as never,
		credentials: [{ name: 'kudosityV1Api', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Send SMS', value: 'sendSms', action: 'Send an SMS', description: 'Send a text message' },
					{ name: 'Cancel SMS', value: 'cancelSms', action: 'Cancel a scheduled SMS', description: 'Cancel a message that has not yet been sent' },
					{ name: 'Get Delivery Status', value: 'getDeliveryStatus', action: 'Get delivery status', description: 'Look up the delivery status of a sent message' },
					{ name: 'Format Number', value: 'formatNumber', action: 'Format a number', description: 'Normalise a number to international format' },
					{ name: 'Get Sender IDs', value: 'getSenderIds', action: 'Get sender IDs', description: 'List the sender IDs available on the account' },
					{ name: 'Get Account', value: 'getAccount', action: 'Get account details', description: 'Fetch account details and balance' },
					{ name: 'Get Numbers', value: 'getNumbers', action: 'Get virtual numbers', description: 'List the virtual numbers on the account' },
					{ name: 'Get Replies', value: 'getSmsResponses', action: 'Get replies', description: 'Poll for replies, as an alternative to a forward URL' },
					{ name: 'Set Number Forward URL', value: 'setForwardUrl', action: 'Set a number forward URL', description: 'Point a virtual number at a URL for inbound messages' },
				],
				default: 'sendSms',
			},

			// ── Send SMS ────────────────────────────────────────────────────────
			{
				displayName: 'To',
				name: 'to',
				type: 'string',
				default: '',
				required: true,
				placeholder: '+61412345678',
				description: 'Recipient number. Combine with Country Code for local-format numbers.',
				displayOptions: { show: { operation: ['sendSms'] } },
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				displayOptions: { show: { operation: ['sendSms'] } },
			},
			{
				displayName: 'From',
				name: 'from',
				type: 'string',
				default: '',
				placeholder: '+61481074185',
				description: 'Sender ID or virtual number. Leave blank to use the account default.',
				displayOptions: { show: { operation: ['sendSms'] } },
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { operation: ['sendSms'] } },
				options: [
					{
						displayName: 'Country Code',
						name: 'countrycode',
						type: 'string',
						default: '',
						placeholder: 'AU',
						description: 'Two-letter country code, used to expand local-format numbers',
					},
					{
						displayName: 'Tracked Link URL',
						name: 'tracked_link_url',
						type: 'string',
						default: '',
						description: 'URL to shorten and track. Put [tracked-link] in the message where it should appear.',
					},
					{
						displayName: 'Validity (Minutes)',
						name: 'validity',
						type: 'number',
						default: 0,
						description: 'Give up on delivery after this many minutes. 0 leaves it to the carrier.',
					},
					{
						displayName: 'Send At',
						name: 'send_at',
						type: 'string',
						default: '',
						placeholder: 'YYYY-MM-DD HH:MM:SS',
						description: 'Schedule the message instead of sending immediately',
					},
					{
						displayName: 'Delivery Receipt Callback URL',
						name: 'dlr_callback',
						type: 'string',
						default: '',
						description: 'URL to POST delivery receipts to. Use a Kudosity V1 Trigger node URL.',
					},
					{
						displayName: 'Reply Callback URL',
						name: 'reply_callback',
						type: 'string',
						default: '',
						description: 'URL to POST inbound replies to. Use a Kudosity V1 Trigger node URL.',
					},
					{
						displayName: 'Link Hits Callback URL',
						name: 'link_hits_callback',
						type: 'string',
						default: '',
						description: 'URL to POST tracked-link clicks to. Use a Kudosity V1 Trigger node URL.',
					},
				],
			},

			// ── Message ID operations ───────────────────────────────────────────
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				description: 'The ID returned when the message was sent',
				displayOptions: { show: { operation: ['cancelSms', 'getDeliveryStatus'] } },
			},
			{
				displayName: 'Message ID',
				name: 'messageId',
				type: 'string',
				default: '',
				required: true,
				description: 'Replies to this sent message. The API requires it — there is no "all recent replies" call.',
				displayOptions: { show: { operation: ['getSmsResponses'] } },
			},

			{
				displayName: 'Recipient Number',
				name: 'msisdn',
				type: 'string',
				default: '',
				required: true,
				description: 'The number the message was sent to. Required alongside the message ID.',
				displayOptions: { show: { operation: ['getDeliveryStatus'] } },
			},

			// ── Format Number ───────────────────────────────────────────────────
			{
				displayName: 'Number',
				name: 'msisdn',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['formatNumber'] } },
			},
			{
				displayName: 'Country Code',
				name: 'countrycode',
				type: 'string',
				default: 'AU',
				required: true,
				placeholder: 'AU',
				displayOptions: { show: { operation: ['formatNumber'] } },
			},

			// ── Forward URL ─────────────────────────────────────────────────────
			{
				displayName: 'Virtual Number',
				name: 'number',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { operation: ['setForwardUrl'] } },
			},
			{
				displayName: 'Forward URL',
				name: 'forwardUrl',
				type: 'string',
				default: '',
				required: true,
				description: 'Where inbound messages to this number are POSTed. Use a Kudosity V1 Trigger node URL.',
				displayOptions: { show: { operation: ['setForwardUrl'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('kudosityV1Api');
		const apiKey = credentials.apiKey as string;
		const apiSecret = (credentials.apiSecret as string) ?? '';

		// v1 is HTTP Basic over key:secret. An empty secret still produces a valid
		// header — base64("key:") — which is what makes the secret-optional test
		// possible without a separate code path.
		const headers = {
			Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		};

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;

			let endpoint = '';
			let method: 'GET' | 'POST' = 'POST';
			const form: Record<string, string> = {};

			if (operation === 'sendSms') {
				endpoint = '/send-sms.json';
				form.to = this.getNodeParameter('to', i) as string;
				form.message = this.getNodeParameter('message', i) as string;

				const from = (this.getNodeParameter('from', i) as string) || '';
				if (from) form.from = from;

				const extra = this.getNodeParameter('additionalFields', i, {}) as Record<string, unknown>;
				for (const [key, value] of Object.entries(extra)) {
					// 0 and '' mean "not set" for every optional field here, so they are
					// omitted rather than sent — v1 treats an empty validity as invalid.
					if (value === '' || value === 0 || value === undefined || value === null) continue;
					form[key] = String(value);
				}
			} else if (operation === 'cancelSms') {
				endpoint = '/cancel-sms.json';
				form.id = this.getNodeParameter('messageId', i) as string;
			} else if (operation === 'getDeliveryStatus') {
				// Both fields are required. message_id alone returns
				// 400 FIELD_EMPTY "Field msisdn is required". Note the endpoint name:
				// /get-delivery-status.json (without "sms") is 404 NOT_IMPLEMENTED.
				endpoint = '/get-sms-delivery-status.json';
				method = 'GET';
				form.message_id = this.getNodeParameter('messageId', i) as string;
				form.msisdn = this.getNodeParameter('msisdn', i) as string;
			} else if (operation === 'formatNumber') {
				endpoint = '/format-number.json';
				method = 'GET';
				form.msisdn = this.getNodeParameter('msisdn', i) as string;
				form.countrycode = this.getNodeParameter('countrycode', i) as string;
			} else if (operation === 'getSenderIds') {
				endpoint = '/get-sender-ids.json';
				method = 'GET';
			} else if (operation === 'getAccount') {
				endpoint = '/get-client.json';
				method = 'GET';
			} else if (operation === 'getNumbers') {
				endpoint = '/get-numbers.json';
				method = 'GET';
			} else if (operation === 'getSmsResponses') {
				// Polling alternative to a forward URL. Useful when a number's
				// forward_url already belongs to another system and must not be taken.
				endpoint = '/get-sms-responses.json';
				method = 'GET';
				// Not optional: without it the API returns 400 FIELD_INVALID
				// "You must provide 'message_id' or 'keyword_id', or both 'keyword' and 'number'".
				form.message_id = this.getNodeParameter('messageId', i) as string;
			} else if (operation === 'setForwardUrl') {
				endpoint = '/edit-number-options.json';
				form.number = this.getNodeParameter('number', i) as string;
				form.forward_url = this.getNodeParameter('forwardUrl', i) as string;
			} else {
				throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
			}

			const query = new URLSearchParams(form).toString();

			// GET operations carry their parameters in the query string. The Salesforce
			// package puts them in the body of a GET, which works but is unusual enough
			// that proxies and HTTP clients sometimes drop it.
			try {
				const response = await this.helpers.request({
					method,
					url: method === 'GET' && query ? `${BASE_URL}${endpoint}?${query}` : `${BASE_URL}${endpoint}`,
					headers: { ...headers, ...trackingHeaders(ACTIONS[operation]) },
					...(method === 'POST' ? { body: query } : {}),
				});

				const json = typeof response === 'string' ? JSON.parse(response) : response;
				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				// continueOnFail lets a bad row pass through as an item rather than
				// halting the run — one malformed number should not kill a batch.
				if (this.continueOnFail()) {
					const translated = kudosityApiError(this.getNode(), error, 'v1');
					returnData.push({
						json: { error: translated.message, description: translated.description },
						pairedItem: { item: i },
					});
					continue;
				}
				throw kudosityApiError(this.getNode(), error, 'v1');
			}
		}

		return [returnData];
	}
}
