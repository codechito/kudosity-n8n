import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';
import { kudosityApiError } from '../shared/errors';
import { KudosityAction, trackingHeaders } from '../shared/tracking';
import { listSms, STATUS_OPTIONS } from '../shared/listSms';

const BASE_URL = 'https://api.transmitmessage.com/v2';

/** The X-Kudosity-Action sent for each operation (SAL-94). */
const ACTIONS: Record<string, KudosityAction> = {
	sendSms: 'sms.send',
	sendMms: 'mms.send',
	sendWhatsapp: 'whatsapp.send',
	sendRcs: 'rcs.send',
	listSms: 'sms.list',
};

export class KudosityV2 implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity V2',
		name: 'kudosityV2',
		icon: 'file:kudosity.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send SMS, MMS, WhatsApp, and RCS messages, and list SMS, via Kudosity',
		defaults: {
			name: 'Kudosity V2',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'kudosityV2Api',
				required: true,
			},
		],
		properties: [
			// ─── Operation ────────────────────────────────────────────────────────────
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Send SMS',
						value: 'sendSms',
						description: 'Send an SMS message to a contact',
						action: 'Send an SMS',
					},
					{
						name: 'Send MMS',
						value: 'sendMms',
						description: 'Send an MMS message with media attachments',
						action: 'Send an MMS',
					},
					{
						name: 'Send WhatsApp Message',
						value: 'sendWhatsapp',
						description: 'Send a WhatsApp text or template message',
						action: 'Send a WhatsApp message',
					},
					{
						name: 'Send RCS Message',
						value: 'sendRcs',
						description: 'Send an RCS message (with optional SMS fallback)',
						action: 'Send an RCS message',
					},
					{
						name: 'List SMS',
						value: 'listSms',
						description: 'List sent and received SMS, with filters',
						action: 'List SMS messages',
					},
				],
				default: 'sendSms',
			},

			// ─── Shared: Recipient ────────────────────────────────────────────────────
			{
				displayName: 'Recipient Phone',
				name: 'recipient',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendSms', 'sendMms', 'sendWhatsapp', 'sendRcs'],
					},
				},
				default: '',
				placeholder: '+61412345678',
				description: "Recipient phone number in E.164 format (e.g. <code>+61412345678</code>)",
			},

			// ─── Shared: Sender ───────────────────────────────────────────────────────
			{
				displayName: 'Sender',
				name: 'sender',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						operation: ['sendSms', 'sendMms', 'sendWhatsapp', 'sendRcs'],
					},
				},
				default: '',
				placeholder: '+61481074185',
				description:
					'Registered sender number (E.164) or alphanumeric Sender ID. For RCS, this is the RCS Agent ID.',
			},

			// ─── SMS: Message ─────────────────────────────────────────────────────────
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				displayOptions: {
					show: { operation: ['sendSms'] },
				},
				default: '',
				description:
					'SMS body text. Messages over 160 characters will be split into multiple parts.',
			},
			{
				displayName: 'Track Links',
				name: 'trackLinks',
				type: 'boolean',
				displayOptions: {
					show: { operation: ['sendSms'] },
				},
				default: false,
				description: 'Whether Kudosity should shorten and track links in the message',
			},

			// ─── List SMS ─────────────────────────────────────────────────────────────
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				displayOptions: { show: { operation: ['listSms'] } },
				default: false,
				description: 'Whether to return all matching messages, fetching page by page, or only up to a limit',
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				displayOptions: { show: { operation: ['listSms'], returnAll: [false] } },
				typeOptions: { minValue: 1, maxValue: 1000 },
				default: 50,
				description: 'Max number of messages to return',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { operation: ['listSms'] } },
				options: [
					{ displayName: 'Start Date', name: 'start_date', type: 'dateTime', default: '', description: 'Only messages created at or after this time' },
					{ displayName: 'End Date', name: 'end_date', type: 'dateTime', default: '', description: 'Only messages created at or before this time' },
					{ displayName: 'Sender', name: 'sender', type: 'string', default: '', description: 'Filter by sender number or ID' },
					{ displayName: 'Recipient', name: 'recipient', type: 'string', default: '', description: 'Filter by recipient number' },
					{ displayName: 'Message Reference', name: 'message_ref', type: 'string', default: '', description: 'Filter by your message reference' },
					{ displayName: 'Status', name: 'status', type: 'options', options: STATUS_OPTIONS, default: '', description: 'Filter by delivery status' },
					{
						displayName: 'Direction',
						name: 'direction',
						type: 'options',
						options: [
							{ name: 'Inbound (Received)', value: 'IN' },
							{ name: 'Outbound (Sent)', value: 'OUT' },
						],
						default: '',
						description: 'Filter by message direction',
					},
					{
						displayName: 'Order',
						name: 'order_by',
						type: 'options',
						options: [
							{ name: 'Oldest First', value: 'CREATED_AT_ASC' },
							{ name: 'Newest First', value: 'CREATED_AT_DESC' },
						],
						default: 'CREATED_AT_ASC',
						description: 'Sort order by creation time',
					},
				],
			},

			// ─── MMS fields ───────────────────────────────────────────────────────────
			{
				displayName: 'Media URL',
				name: 'mediaUrl',
				type: 'string',
				required: true,
				displayOptions: {
					show: { operation: ['sendMms'] },
				},
				default: '',
				placeholder: 'https://example.com/image.jpg',
				description: 'Publicly accessible URL of the media file to attach (image, video, or document)',
			},
			{
				displayName: 'Subject',
				name: 'subject',
				type: 'string',
				displayOptions: {
					show: { operation: ['sendMms'] },
				},
				default: '',
				description: 'Optional subject line for the MMS message',
			},
			{
				displayName: 'Message Body',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: {
					show: { operation: ['sendMms'] },
				},
				default: '',
				description: 'Optional text body to accompany the media',
			},

			// ─── WhatsApp fields ──────────────────────────────────────────────────────
			{
				displayName: 'Content Type',
				name: 'contentType',
				type: 'options',
				required: true,
				displayOptions: {
					show: { operation: ['sendWhatsapp'] },
				},
				options: [
					{ name: 'Text Message', value: 'text' },
					{ name: 'Template Message', value: 'template' },
				],
				default: 'text',
			},
			{
				displayName: 'Text Message Body',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				displayOptions: {
					show: { operation: ['sendWhatsapp'], contentType: ['text'] },
				},
				default: '',
				description: 'Body text for WhatsApp Text content type',
			},
			{
				displayName: 'Template Name',
				name: 'templateName',
				type: 'string',
				displayOptions: {
					show: { operation: ['sendWhatsapp'], contentType: ['template'] },
				},
				default: '',
				placeholder: 'welcome_new_customer',
				description: 'Name of your pre-approved WhatsApp template',
			},
			{
				displayName: 'Template Parameters',
				name: 'templateParams',
				type: 'string',
				displayOptions: {
					show: { operation: ['sendWhatsapp'], contentType: ['template'] },
				},
				default: '',
				placeholder: 'John, 20%OFF, 31 Dec',
				description:
					'Comma-separated values to fill template placeholders in order (e.g. <code>John, 20%OFF</code> fills <code>{{1}}</code> and <code>{{2}}</code>)',
			},
			{
				displayName: 'Template Locale',
				name: 'templateLocale',
				type: 'string',
				displayOptions: {
					show: { operation: ['sendWhatsapp'], contentType: ['template'] },
				},
				default: 'en',
				description: 'BCP-47 locale code for the template (default: <code>en</code>)',
			},
			{
				displayName: 'SMS Fallback Sender',
				name: 'smsFallbackSender',
				type: 'string',
				displayOptions: {
					show: { operation: ['sendWhatsapp', 'sendRcs'] },
				},
				default: '',
				placeholder: '+61481074185',
				description:
					'If delivery fails, fall back to SMS from this number. Leave blank to disable fallback.',
			},
			{
				displayName: 'SMS Fallback Message',
				name: 'smsFallbackMessage',
				type: 'string',
				typeOptions: { rows: 3 },
				displayOptions: {
					show: { operation: ['sendWhatsapp', 'sendRcs'] },
				},
				default: '',
				description: 'SMS message to send if primary delivery fails. Required when SMS Fallback Sender is set.',
			},

			// ─── RCS fields ───────────────────────────────────────────────────────────
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 4 },
				required: true,
				displayOptions: {
					show: { operation: ['sendRcs'] },
				},
				default: '',
				description: 'RCS message body (1–3,072 characters, supports UTF-8 and emoji)',
			},

			// ─── Shared: Message Reference ────────────────────────────────────────────
			{
				displayName: 'Message Reference',
				name: 'messageRef',
				type: 'string',
				displayOptions: {
					show: {
						operation: ['sendSms', 'sendMms', 'sendWhatsapp', 'sendRcs'],
					},
				},
				default: '',
				placeholder: 'campaign-2024-q1',
				description: 'Your own reference ID to track this message (max 500 characters). Leave blank to skip.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('kudosityV2Api');
		const apiKey = credentials.apiKey as string;

		// x-api-key, not Authorization. Confirmed against the live API: an Authorization
		// header carrying the same key returns 401 {"status":"Invalid api key"}, while
		// x-api-key returns 200. This was wrong in every version before 22 Oct 2026.
		const headers = {
			'x-api-key': apiKey,
			'Content-Type': 'application/json',
		};

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;

			if (operation === 'listSms') {
				try {
					const result = await listSms(
						this,
						{ 'x-api-key': apiKey, Accept: 'application/json', ...trackingHeaders('sms.list') },
						this.getNodeParameter('filters', i, {}) as IDataObject,
						this.getNodeParameter('returnAll', i, false) as boolean,
						this.getNodeParameter('limit', i, 50) as number,
					);
					// One output item per message, the n8n convention for list operations.
					for (const sms of result.smses) returnData.push({ json: sms, pairedItem: { item: i } });
				} catch (error) {
					if (this.continueOnFail()) {
						const translated = kudosityApiError(this.getNode(), error, 'v2');
						returnData.push({ json: { error: translated.message, description: translated.description }, pairedItem: { item: i } });
						continue;
					}
					throw kudosityApiError(this.getNode(), error, 'v2');
				}
				continue;
			}

			const recipient = this.getNodeParameter('recipient', i) as string;
			const sender = this.getNodeParameter('sender', i) as string;
			const messageRef = (this.getNodeParameter('messageRef', i) as string) || '';

			let endpoint = '';
			let body: Record<string, unknown> = {};

			if (operation === 'sendSms') {
				const message = this.getNodeParameter('message', i) as string;
				const trackLinks = this.getNodeParameter('trackLinks', i, false) as boolean;
				endpoint = '/sms';
				body = {
					sender,
					recipient,
					message,
					...(messageRef && { message_ref: messageRef }),
					...(trackLinks && { track_links: true }),
				};
			} else if (operation === 'sendMms') {
				const mediaUrl = this.getNodeParameter('mediaUrl', i) as string;
				const subject = (this.getNodeParameter('subject', i) as string) || '';
				const message = (this.getNodeParameter('message', i) as string) || '';
				endpoint = '/mms';
				body = {
					sender,
					recipient,
					content_urls: [mediaUrl],
					...(subject && { subject }),
					...(message && { message }),
					...(messageRef && { message_ref: messageRef }),
				};
			} else if (operation === 'sendWhatsapp') {
				const contentType = this.getNodeParameter('contentType', i) as string;
				const smsFallbackSender = (this.getNodeParameter('smsFallbackSender', i) as string) || '';
				const smsFallbackMessage = (this.getNodeParameter('smsFallbackMessage', i) as string) || '';
				endpoint = '/whatsapp/messages';

				const smsFallback =
					smsFallbackSender
						? { sender: smsFallbackSender, message: smsFallbackMessage }
						: null;

				if (contentType === 'text') {
					const message = this.getNodeParameter('message', i) as string;
					body = {
						sender,
						recipient,
						content_type: 'text',
						content: { text: { message } },
						...(smsFallback && { sms_fallback: smsFallback }),
						...(messageRef && { message_ref: messageRef }),
					};
				} else {
					const templateName = this.getNodeParameter('templateName', i) as string;
					const templateParams = this.getNodeParameter('templateParams', i) as string;
					const templateLocale = (this.getNodeParameter('templateLocale', i) as string) || 'en';
					const parameters = templateParams
						? templateParams.split(',').map((p) => p.trim())
						: [];
					body = {
						sender,
						recipient,
						content_type: 'template',
						content: {
							template: {
								name: templateName,
								locale: templateLocale,
								parameters,
							},
						},
						...(smsFallback && { sms_fallback: smsFallback }),
						...(messageRef && { message_ref: messageRef }),
					};
				}
			} else if (operation === 'sendRcs') {
				const message = this.getNodeParameter('message', i) as string;
				const smsFallbackSender = (this.getNodeParameter('smsFallbackSender', i) as string) || '';
				const smsFallbackMessage = (this.getNodeParameter('smsFallbackMessage', i) as string) || '';
				endpoint = '/rcs/messages';

				const smsFallback =
					smsFallbackSender
						? { sender: smsFallbackSender, message: smsFallbackMessage }
						: null;

				body = {
					sender,
					recipient,
					content_type: 'text',
					content: { text: { message } },
					...(smsFallback && { sms_fallback: smsFallback }),
					...(messageRef && { message_ref: messageRef }),
				};
			} else {
				throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
			}

			try {
				const response = await this.helpers.request({
					method: 'POST',
					url: `${BASE_URL}${endpoint}`,
					headers: { ...headers, ...trackingHeaders(ACTIONS[operation]) },
					body: JSON.stringify(body),
				});

				const json = typeof response === 'string' ? JSON.parse(response) : response;
				returnData.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					const translated = kudosityApiError(this.getNode(), error, 'v2');
					returnData.push({
						json: { error: translated.message, description: translated.description },
						pairedItem: { item: i },
					});
					continue;
				}
				throw kudosityApiError(this.getNode(), error, 'v2');
			}
		}

		return [returnData];
	}
}
