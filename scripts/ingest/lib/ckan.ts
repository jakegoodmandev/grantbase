// Minimal client for the open.canada.ca CKAN datastore API.
//
// Hard constraints discovered on the Proactive Disclosure of Grants &
// Contributions resource (>100k rows): full-text `q` is disabled, the
// `datastore_search_sql` action is disabled, and `distinct=true` is unreliable.
// The only dependable server-side selection is exact-match `filters=` plus
// `offset`/`limit` pagination, optionally with `sort`.

const CKAN_DATASTORE_SEARCH =
  "https://open.canada.ca/data/api/3/action/datastore_search";

export type CkanRecord = Record<string, unknown>;

type DatastoreResponse = {
  success: boolean;
  result: { total: number; records: CkanRecord[] };
};

// Async generator that yields successive pages of records for a resource.
export async function* datastorePages(opts: {
  resourceId: string;
  filters: Record<string, string>;
  sort?: string;
  pageSize?: number;
}): AsyncGenerator<CkanRecord[]> {
  const pageSize = opts.pageSize ?? 1000;
  let offset = 0;

  while (true) {
    const url = new URL(CKAN_DATASTORE_SEARCH);
    url.searchParams.set("resource_id", opts.resourceId);
    url.searchParams.set("filters", JSON.stringify(opts.filters));
    url.searchParams.set("limit", String(pageSize));
    url.searchParams.set("offset", String(offset));
    if (opts.sort) url.searchParams.set("sort", opts.sort);

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`CKAN ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as DatastoreResponse;
    if (!body.success) {
      throw new Error("CKAN datastore_search returned success=false");
    }

    const { records, total } = body.result;
    if (records.length === 0) return;
    yield records;

    offset += records.length;
    if (offset >= total) return;
  }
}
