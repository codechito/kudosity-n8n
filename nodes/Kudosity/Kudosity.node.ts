import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

const BASE_URL = 'https://api.transmitmessage.com/v2';

export class Kudosity implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity',
		name: 'kudosity',
		icon: 'file:kudosity.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Send SMS, MMS, WhatsApp, and RCS messages via Kudosity',
		defaults: {
			name: 'Kudosity',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'kudosityApi',
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
		const credentials = await this.getCredentials('kudosityApi');
		const apiKey = credentials.apiKey as string;

		const headers = {
			Authorization: apiKey,
			'Content-Type': 'application/json',
		};

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const recipient = this.getNodeParameter('recipient', i) as string;
			const sender = this.getNodeParameter('sender', i) as string;
			const messageRef = (this.getNodeParameter('messageRef', i) as string) || '';

			let endpoint = '';
			let body: Record<string, unknown> = {};

			if (operation === 'sendSms') {
				const message = this.getNodeParameter('message', i) as string;
				endpoint = '/sms';
				body = {
					sender,
					recipient,
					message,
					...(messageRef && { message_ref: messageRef }),
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

			const response = await this.helpers.request({
				method: 'POST',
				url: `${BASE_URL}${endpoint}`,
				headers,
				body: JSON.stringify(body),
			});

			const json = typeof response === 'string' ? JSON.parse(response) : response;
			returnData.push({ json, pairedItem: { item: i } });
		}

		return [returnData];
	}
}
