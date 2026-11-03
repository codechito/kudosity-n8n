import {
	IHookFunctions,
	IWebhookFunctions,
	IDataObject,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
} from 'n8n-workflow';
import { trackingHeaders } from '../shared/tracking';

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
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				return webhookData.webhookId !== undefined;
			},

			/**
			 * ONE webhook carrying every selected event type, not one per type.
			 *
			 * Confirmed against the live API on 22 Oct 2026. Event types go in a
			 * filter.event_type array, and the label field is `name`. An earlier version
			 * looped over the types registering one webhook each with
			 * { event_type, url, webhook_name }, which the API rejects outright:
			 *   400 {"error":"invalid field in request: json: unknown field \"webhook_name\""}
			 * so registration had never actually worked.
			 */
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const events = this.getNodeParameter('events') as string[];
				const credentials = await this.getCredentials('kudosityV2Api');

				const response = await this.helpers.request({
					method: 'POST',
					url: `${BASE_URL}/webhook`,
					headers: {
						'x-api-key': credentials.apiKey as string,
						'Content-Type': 'application/json',
						...trackingHeaders('trigger.subscribe'),
					},
					body: JSON.stringify({
						name: 'n8n',
						url: webhookUrl,
						filter: { event_type: events },
					}),
				});

				const json = typeof response === 'string' ? JSON.parse(response) : response;
				const webhookData = this.getWorkflowStaticData('node');
				webhookData.webhookId = json.id;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');
				const id = webhookData.webhookId as string | undefined;
				delete webhookData.webhookId;
				if (!id) return true;

				const credentials = await this.getCredentials('kudosityV2Api');
				try {
					await this.helpers.request({
						method: 'DELETE',
						url: `${BASE_URL}/webhook/${id}`,
						headers: {
							'x-api-key': credentials.apiKey as string,
							...trackingHeaders('trigger.unsubscribe'),
						},
					});
				} catch {
					// Deactivation must not fail because the API was unreachable. The local
					// record is already gone, so re-activating registers afresh.
					return true;
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
