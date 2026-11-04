import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { kudosityApiError } from '../shared/errors';
import { listSms, STATUS_OPTIONS } from '../shared/listSms';
import { trackingHeaders } from '../shared/tracking';

/**
 * The single "Kudosity" node from the original n8n-nodes-kudosity (≤ 0.1.6).
 *
 * Kept so workflows built with that package keep running after upgrading to 0.2.0.
 * The node name (`kudosity`), credential (`kudosityApi`) and every parameter name
 * must stay exactly as they were — n8n matches saved workflows by them.
 *
 * Hidden from the node panel: new workflows should use Kudosity V2 (or V1), which
 * covers everything this node does plus MMS, WhatsApp, RCS and triggers.
 *
 * Differences from 0.1.6, all compatible:
 * - "Return All" on List now actually pages (0.1.6 offered it but returned one page).
 * - Errors are translated into readable messages, and Continue On Fail works.
 * - Requests carry the usage headers (SAL-94).
 * - The status filter accepts every status the API supports (0.1.6 offered four).
 */
export class Kudosity implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity (legacy)',
		name: 'kudosity',
		icon: 'file:kudosity.svg',
		group: ['transform'],
		version: 1,
		hidden: true,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Deprecated — use Kudosity V2. Kept so workflows from n8n-nodes-kudosity 0.1.x keep working.',
		defaults: { name: 'Kudosity' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'kudosityApi', required: true }],
		properties: [
			{
				displayName: 'This node is deprecated. Use the Kudosity V2 node for new workflows — it also sends MMS, WhatsApp and RCS, and has triggers.',
				name: 'deprecationNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [{ name: 'SMS', value: 'sms' }],
				default: 'sms',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['sms'] } },
				options: [
					{ name: 'Send', value: 'send', action: 'Send an SMS', description: 'Send a new SMS message' },
					{ name: 'List', value: 'list', action: 'List SMS messages', description: 'Get a list of SMS messages' },
				],
				default: 'send',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
				default: '',
				description: 'The message to send (up to 5,000 characters)',
			},
			{
				displayName: 'Sender',
				name: 'sender',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getSenderOptions' },
				required: true,
				displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
				default: '',
				description: 'The sender number to use',
			},
			{
				displayName: 'Recipient',
				name: 'recipient',
				type: 'string',
				required: true,
				displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
				default: '',
				description: 'The recipient number in E.164 format (e.g., 61438333061)',
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: { resource: ['sms'], operation: ['send'] } },
				options: [
					{
						displayName: 'Message Reference',
						name: 'message_ref',
						type: 'string',
						default: '',
						description: 'Your system reference (max 500 chars)',
					},
					{
						displayName: 'Track Links',
						name: 'track_links',
						type: 'boolean',
						default: false,
						description: 'Whether to enable link tracking and shortening',
					},
				],
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: { show: { resource: ['sms'], operation: ['list'] } },
				default: false,
				description: 'Whether to return all results or only up to a given limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: { show: { resource: ['sms'], operation: ['list'], returnAll: [false] } },
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 50,
				description: 'Max number of results to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { resource: ['sms'], operation: ['list'] } },
				options: [
					{ displayName: 'Start Date', name: 'start_date', type: 'dateTime', default: '', description: 'Start date for filtering messages' },
					{ displayName: 'End Date', name: 'end_date', type: 'dateTime', default: '', description: 'End date for filtering messages' },
					{ displayName: 'Message Reference', name: 'message_ref', type: 'string', default: '', description: 'Filter by message reference' },
					{ displayName: 'Sender', name: 'sender', type: 'string', default: '', description: 'Filter by sender number' },
					{ displayName: 'Recipient', name: 'recipient', type: 'string', default: '', description: 'Filter by recipient number' },
					{ displayName: 'Status', name: 'status', type: 'options', options: STATUS_OPTIONS, default: '', description: 'Filter by message status' },
					{
						displayName: 'Direction',
						name: 'direction',
						type: 'options',
						options: [
							{ name: 'Inbound', value: 'IN' },
							{ name: 'Outbound', value: 'OUT' },
						],
						default: '',
						description: 'Filter by message direction',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			/** Same as 0.1.6: the account's numbers, via the v1 API with Basic auth. */
			async getSenderOptions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const credentials = await this.getCredentials('kudosityApi');
				const basic = Buffer.from(`${credentials.apiKey}:${credentials.password}`).toString('base64');
				const response = await this.helpers.request({
					method: 'GET',
					url: 'https://api.transmitsms.com/get-numbers.json',
					headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', ...trackingHeaders('numbers.get') },
					json: true,
				});
				if (!response || !Array.isArray(response.numbers)) {
					throw new NodeOperationError(this.getNode(), 'Unexpected response from get-numbers.json');
				}
				return response.numbers.map((n: IDataObject) => ({ name: String(n.number), value: String(n.number) }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('kudosityApi');
		const auth = { 'x-api-key': credentials.apiKey as string };

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			try {
				if (operation === 'send') {
					const extra = this.getNodeParameter('additionalFields', i, {}) as IDataObject;
					const body: IDataObject = {
						message: this.getNodeParameter('message', i) as string,
						sender: String(this.getNodeParameter('sender', i)),
						recipient: String(this.getNodeParameter('recipient', i)),
					};
					if (extra.message_ref) body.message_ref = extra.message_ref;
					if (extra.track_links !== undefined) body.track_links = extra.track_links;

					const response = await this.helpers.request({
						method: 'POST',
						url: 'https://api.transmitmessage.com/v2/sms',
						headers: { ...auth, 'Content-Type': 'application/json', Accept: 'application/json', ...trackingHeaders('sms.send') },
						body: JSON.stringify(body),
					});
					const json = typeof response === 'string' ? JSON.parse(response) : response;
					returnData.push({ json, pairedItem: { item: i } });
				} else if (operation === 'list') {
					// 0.1.6 returned the whole response as one item; keep that shape.
					const result = await listSms(
						this,
						{ ...auth, Accept: 'application/json', ...trackingHeaders('sms.list') },
						this.getNodeParameter('filters', i, {}) as IDataObject,
						this.getNodeParameter('returnAll', i, false) as boolean,
						this.getNodeParameter('limit', i, 50) as number,
					);
					returnData.push({ json: result as unknown as IDataObject, pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
				}
			} catch (error) {
				if (error instanceof NodeOperationError) throw error;
				if (this.continueOnFail()) {
					const translated = kudosityApiError(this.getNode(), error, 'v2');
					returnData.push({ json: { error: translated.message, description: translated.description }, pairedItem: { item: i } });
					continue;
				}
				throw kudosityApiError(this.getNode(), error, 'v2');
			}
		}
		return [returnData];
	}
}
