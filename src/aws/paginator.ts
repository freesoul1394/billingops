/**
 * Generic paginator for AWS SDK v3 commands.
 * Loops until NextToken is null — does NOT stop on empty pages
 * (AWS Org List* ops can return empty pages with a non-null token).
 */

import { withBackoff } from "./backoff";

/**
 * Options for paginateAll.
 * Uses `any` at the SDK boundary since AWS command outputs don't satisfy
 * Record<string, unknown> index signatures under strict mode.
 */
interface PaginateOptions<TItem> {
  /** The function that sends a page request. Receives { NextToken, ...input }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (input: any) => Promise<any>;
  /** Base input (without NextToken) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  /** Extract items from the response */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getItems: (output: any) => TItem[] | undefined;
  /** Max results per page (optional) */
  maxResults?: number;
}

/**
 * Paginates through all pages, collecting all items.
 * Never stops on an empty page if NextToken is present.
 */
export async function paginateAll<TItem>(options: PaginateOptions<TItem>): Promise<TItem[]> {
  const { send, input, getItems, maxResults } = options;
  const allItems: TItem[] = [];
  let nextToken: string | undefined;

  do {
    const pageInput = {
      ...input,
      NextToken: nextToken,
      ...(maxResults ? { MaxResults: maxResults } : {}),
    };

    const output = await withBackoff(() => send(pageInput));
    const items = getItems(output);
    if (items && items.length > 0) {
      allItems.push(...items);
    }
    // CRITICAL: keep going even if items is empty — AWS may return empty pages with a token
    nextToken = output.NextToken;
  } while (nextToken);

  return allItems;
}
