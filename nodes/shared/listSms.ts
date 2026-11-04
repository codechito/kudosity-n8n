import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';

/**
 * GET /v2/sms, shared by the V2 node and the legacy node.
 *
 * The response is { smses: [...], total_records: "N", total_segments: "N" } and
 * pages with `page` + `limit`. There is no next-page marker, so "return all"
 * requests pages until one comes back empty or total_records is reached.
 * (The original 0.1.6 package offered "Return All" but never paged.)
 */

export const LIST_URL = 'https://api.transmitmessage.com/v2/sms';
export const PAGE_SIZE = 100;
/** Safety stop: 1,000 pages × 100 = 100,000 messages. */
export const MAX_PAGES = 1000;

export interface ListResult {
	smses: IDataObject[];
	total_records: string;
	total_segments: string;
}

/** Filters exactly as the API names them. Empty values are dropped. */
export function listQuery(filters: IDataObject): Record<string, string> {
	const qs: Record<string, string> = {};
	for (const [key, value] of Object.entries(filters || {})) {
		if (value === '' || value === undefined || value === null) continue;
		qs[key] = key === 'start_date' || key === 'end_date' ? new Date(value as string).toISOString() : String(value);
	}
	return qs;
}

function parse(response: unknown): ListResult {
	const json = (typeof response === 'string' ? JSON.parse(response) : response) as Partial<ListResult>;
	return {
		smses: Array.isArray(json.smses) ? json.smses : [],
		total_records: String(json.total_records ?? '0'),
		total_segments: String(json.total_segments ?? '0'),
	};
}

export async function listSms(
	ctx: IExecuteFunctions,
	headers: Record<string, string>,
	filters: IDataObject,
	returnAll: boolean,
	limit: number,
): Promise<ListResult> {
	const base = listQuery(filters);
	const get = async (page: number, size: number) => {
		const qs = new URLSearchParams({ ...base, limit: String(size), page: String(page) }).toString();
		return parse(await ctx.helpers.request({ method: 'GET', url: `${LIST_URL}?${qs}`, headers }));
	};

	if (!returnAll) return get(1, limit);

	const all: IDataObject[] = [];
	let first: ListResult | undefined;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const result = await get(page, PAGE_SIZE);
		first = first || result;
		all.push(...result.smses);
		if (result.smses.length === 0 || all.length >= Number(result.total_records)) break;
	}
	return { smses: all, total_records: first!.total_records, total_segments: first!.total_segments };
}

/** Status values the API accepts (developers.kudosity.com, GET /v2/sms). */
export const STATUS_OPTIONS = [
	'PENDING', 'SENT', 'FAILED', 'DELIVERED', 'ACCEPTED', 'SOFT_BOUNCE', 'HARD_BOUNCE',
	'OTHER', 'REJECTED', 'PENDING_APPROVAL', 'SUBMITTED', 'UNDELIVERABLE', 'READ',
].map((value) => ({
	name: value.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' '),
	value,
}));
