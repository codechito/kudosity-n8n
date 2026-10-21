import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

const BASE_URL = 'https://api.transmitsms.com';

/**
 * Receives inbound messages on a Kudosity virtual number.
 *
 * v1 does have a registration mechanism, it is simply not the one v2 uses. Rather
 * than subscribing per event type, a virtual number carries a single forward_url
 * and every inbound message to that number is POSTed there. Registering means
 * writing that field with edit-number-options.json — the same call the Kudosity
 * Eloqua and Salesforce integrations make.
 *
 * Two consequences worth knowing, both of which shape the code below:
 *
 *   - A number has ONE forward_url. Activating this trigger overwrites whatever
 *     was there, so a number already feeding Salesforce or Eloqua will silently
 *     stop feeding it. There is no way to detect that in advance.
 *
 *   - There is no API to read a forward_url back. Registration state therefore
 *     cannot be confirmed against Kudosity; it is tracked in n8n's own workflow
 *     static data, which is also how the v2 trigger tracks its webhook ids.
 *
 * Delivery receipts and link hits are NOT registered here. Those are addressed per
 * send, by passing dlr_callback and link_hits_callback to send-sms.json — set them
 * to this node's webhook URL on the Kudosity V1 node.
 */
export class KudosityV1Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kudosity V1 Trigger',
		name: 'kudosityV1Trigger',
		icon: 'file:kudosity.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["number"]}}',
		description: 'Starts a workflow when a message arrives on a Kudosity v1 virtual number',
		defaults: { name: 'Kudosity V1 Trigger' },
		inputs: [],
		outputs: ['main'] as never,
		credentials: [{ name: 'kudosityV1Api', required: true }],
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
				displayName:
					'Activating this workflow points the number\'s forward URL at n8n, replacing whatever it was set to before. If this number already feeds another system — a Salesforce or Eloqua integration, for instance — that feed will stop. Kudosity provides no way to read the previous value back, so it cannot be restored automatically.',
				name: 'overwriteNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Virtual Number',
				name: 'number',
				type: 'string',
				default: '',
				required: true,
				placeholder: '61412345678',
				description:
					'The Kudosity virtual number to receive on. Use the Get Numbers operation on a Kudosity V1 node to list the numbers on your account.',
			},
			{
				displayName: 'Clear Forward URL on Deactivate',
				name: 'clearOnDelete',
				type: 'boolean',
				default: true,
				description:
					'Whether to blank the number\'s forward URL when the workflow is deactivated. Turn this off if another system set the URL and you would rather leave it alone than clear it.',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				// Kudosity exposes no way to read a number's forward_url back, so this
				// can only report what n8n itself recorded. If the value was changed
				// outside n8n, this will not notice.
				const data = this.getWorkflowStaticData('node');
				const number = this.getNodeParameter('number') as string;
				return data.forwardUrlRegisteredFor === number;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const number = this.getNodeParameter('number') as string;

				if (!number) {
					throw new NodeOperationError(this.getNode(), 'A virtual number is required to receive inbound messages');
				}

				const credentials = await this.getCredentials('kudosityV1Api');
				const apiKey = credentials.apiKey as string;
				const apiSecret = (credentials.apiSecret as string) ?? '';

				const query = new URLSearchParams({ number, forward_url: webhookUrl }).toString();

				// GET with query parameters, matching the Eloqua integration. The
				// Salesforce package POSTs the same fields form-encoded; v1 accepts
				// either, and GET is the better fit for n8n's request helper.
				await this.helpers.request({
					method: 'GET',
					url: `${BASE_URL}/edit-number-options.json?${query}`,
					headers: {
						Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
						Accept: 'application/json',
					},
				});

				const data = this.getWorkflowStaticData('node');
				data.forwardUrlRegisteredFor = number;
				data.forwardUrlValue = webhookUrl;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				const number = (data.forwardUrlRegisteredFor as string) ?? (this.getNodeParameter('number') as string);
				const clear = this.getNodeParameter('clearOnDelete', true) as boolean;

				// Forgetting locally always happens. Clearing the remote value is the
				// user's choice, because blanking a forward_url that another system
				// depends on is worse than leaving a stale one pointing at an inactive
				// n8n webhook, which simply 404s.
				delete data.forwardUrlRegisteredFor;
				delete data.forwardUrlValue;

				if (!clear || !number) return true;

				const credentials = await this.getCredentials('kudosityV1Api');
				const apiKey = credentials.apiKey as string;
				const apiSecret = (credentials.apiSecret as string) ?? '';
				const query = new URLSearchParams({ number, forward_url: '' }).toString();

				try {
					await this.helpers.request({
						method: 'GET',
						url: `${BASE_URL}/edit-number-options.json?${query}`,
						headers: {
							Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
							Accept: 'application/json',
						},
					});
				} catch {
					// Deactivation must not fail because the API was unreachable. The
					// local record is already gone, so re-activating will re-register.
					return true;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as IDataObject;
		const query = this.getQueryData() as IDataObject;

		// v1 is inconsistent about both transport and field names across callback
		// types — mobile vs msisdn, message vs response. Read both, normalise the
		// common fields, and pass the untouched payload through so nothing is lost
		// when a field we did not anticipate turns out to matter.
		const merged: IDataObject = { ...query, ...body };

		const output: IDataObject = {
			phone:       merged.mobile ?? merged.msisdn ?? merged.from ?? '',
			id:          merged.message_id ?? merged.id ?? '',
			message:     merged.response ?? merged.message ?? '',
			status:      merged.status ?? '',
			to:          merged.to ?? merged.longcode ?? '',
			received_at: merged.datetime ?? merged.received_at ?? '',
			raw:         merged,
		};

		return { workflowData: [[{ json: output }]] };
	}
}
