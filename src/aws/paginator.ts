/**
 * Generic paginator for AWS SDK v3 commands.
 * Loops until NextToken is null — does NOT stop on empty pages
 * (AWS Org List* ops can return empty pages with a non-null token).
 */

import { withBackoff } from "./backoff";

interface PaginatedInput {
  NextToken?: string;
  MaxResults?: number;
}

interface PaginatedOutput {
  NextToken?: string;
}

type SendFn<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

interface PaginateOptions<TInput extends PaginatedInput, TOutput extends PaginatedOutput, TItem> {
  /** The function that sends the command (e.g. client.send bound to command) */
  send: SendFn<TInput, TOutput>;
  /** Base input (without NextToken) */
  input: Omit<TInput, "NextToken">;
  /** Extract items from the response */
  getItems: (output: TOutput) => TItem[] | undefined;
  /** Max results per page (optional) */
  maxResults?: number;
}

/**
 * Paginates through all pages, collecting all items.
 * Never stops on an empty page if NextToken is present.
 */
export async function paginateAll<
  TInput extends PaginatedInput,
  TOutput extends PaginatedOutput,
  TItem,
>(options: PaginateOptions<TInput, TOutput, TItem>): Promise<TItem[]> {
  const { send, input, getItems, maxResults } = options;
  const allItems: TItem[] = [];
  let nextToken: string | undefined;

  do {
    const pageInput = {
      ...input,
      NextToken: nextToken,
      ...(maxResults ? { MaxResults: maxResults } : {}),
    } as TInput;

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
