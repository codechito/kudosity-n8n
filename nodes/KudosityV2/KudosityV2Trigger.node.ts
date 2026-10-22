import {
	IHookFunctions,
	IWebhookFunctions,
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';

const BASE_URL = 'https://api.transmitmessage.com/v2';

// Event types mirrored from the AC app
const EVENT_TYPES = [
	{ name: 'SMS Inbound',   value: 'SMS_INBOUND',  key: 'wh_sms_inbound'  },
	{ name: 'SMS Status',    value: 'SMS_STATUS',   key: 'wh_sms_status'   },
	{ name: 'MMS Inbound',   value: 'MMS_INBOUND',  key: 'wh_mms_inbound'  },
	{ name: 'MMS Status',    value: 'MMS_STATUS',   key: 'wh_mms_status'   },
	{ name: 'RCS Status',    value: 'RCS_STATUS',   key: 'wh_rcs_status'   },
	{ name: 'Opt Out',       value: 'OPT_OUT',      key: 'wh_opt_out'      },
	{ name: 'Link Hit',      value: 'LINK_HIT',     key: 'wh_link_hit'     },
];

export class KudosityV2Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity V2 Trigger',
		name: 'kudosityV2Trigger',
		icon: 'file:kudosity.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Triggers when Kudosity events occur: inbound SMS/MMS, delivery status, opt-out, or link click',
		defaults: {
			name: 'Kudosity V2 Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'kudosityV2Api',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: EVENT_TYPES.map((e) => ({ name: e.name, value: e.value })),
				default: ['SMS_INBOUND'],
				description: 'Kudosity event types to listen for. Use a Filter node to narrow by event_type.',
			},
		],
	};

	webhookMethods = {
		default: {
			// ── Check whether webhooks already exist ──────────────────────────────────
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				// If we have stored IDs for any event, assume they exist
				return EVENT_TYPES.some((e) => webhookData[e.key] !== undefined);
			},

			// ── Register one Kudosity webhook per selected event type ─────────────────
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const credentials = await this.getCredentials('kudosityV2Api');
				const apiKey = credentials.apiKey as string;
				const events = this.getNodeParameter('events') as string[];
				const webhookData = this.getWorkflowStaticData('node');

				const headers = {
					'x-api-key': apiKey,
					'Content-Type': 'application/json',
				};

				for (const eventType of EVENT_TYPES) {
					if (!events.includes(eventType.value)) continue;

					const response = await this.helpers.request({
						method: 'POST',
						url: `${BASE_URL}/webhook`,
						headers,
						body: JSON.stringify({
							event_type: eventType.value,
							url: webhookUrl,
							webhook_name: `n8n - ${eventType.name}`,
						}),
					});

					const json: IDataObject =
						typeof response === 'string' ? JSON.parse(response) : response;
					webhookData[eventType.key] = json.id;
				}

				return true;
			},

			// ── Delete all registered webhooks for this workflow ──────────────────────
			async delete(this: IHookFunctions): Promise<boolean> {
				const credentials = await this.getCredentials('kudosityV2Api');
				const apiKey = credentials.apiKey as string;
				const webhookData = this.getWorkflowStaticData('node');

				const headers = { 'x-api-key': apiKey };

				for (const eventType of EVENT_TYPES) {
					const id = webhookData[eventType.key];
					if (!id) continue;
					try {
						await this.helpers.request({
							method: 'DELETE',
							url: `${BASE_URL}/webhook/${id}`,
							headers,
						});
					} catch (_) {
						// Ignore errors on delete (already removed)
					}
					delete webhookData[eventType.key];
				}

				return true;
			},
		},
	};

	// ── Handle incoming webhook payload ────────────────────────────────────────
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData() as IDataObject;

		// Normalise the payload to match the AC app's data_pipeline source shape
		const eventType = (bodyData.event_type as string) ?? '';
		const isInbound = eventType === 'SMS_INBOUND' || eventType === 'MMS_INBOUND';

		const output: IDataObject = {
			event_type:   eventType,
			phone:        isInbound ? bodyData.sender : bodyData.recipient,
			id:           bodyData.id ?? '',
			status:       bodyData.status ?? '',
			message:      bodyData.message ?? '',
			url:          bodyData.url ?? '',
			message_ref:  bodyData.message_ref ?? '',
			sender:       bodyData.sender ?? '',
			recipient:    bodyData.recipient ?? '',
			created_at:   bodyData.created_at ?? '',
		};

		return {
			workflowData: [[{ json: output }]],
		};
	}
}
