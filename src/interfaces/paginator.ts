import type { FindOptionsOrderValue, ObjectLiteral } from "typeorm";

export type Order = FindOptionsOrderValue;
/** Root column property paths, including dotted embedded paths; checked against metadata. */
export type OrderBy<TEntity extends ObjectLiteral> = {
  [TKey in keyof TEntity]?: Order;
} & { [propertyPath: string]: Order | undefined };

export interface NormalizedOrder {
  key: string;
  direction: "ASC" | "DESC";
  nulls: "FIRST" | "LAST";
}

/** Database representations, never hydrated entity/column-transformer values. */
export type CursorValue = string | number | boolean | null;
export interface CursorEnvelope {
  version: 3;
  direction: "next" | "prev";
  order: NormalizedOrder[];
  values: CursorValue[];
}

export interface Paginated<TNode> {
  /** Matching root rows before the cursor; null when noTotalCount is true. */
  readonly totalCount: number | null;
  /** Availability at the time of the corresponding read, not a snapshot guarantee. */
  readonly hasPrevPage: boolean;
  readonly hasNextPage: boolean;
  /** Nonempty pages retain both boundary cursors, even when a flag is false. */
  readonly prevPageCursor: string | null;
  readonly nextPageCursor: string | null;
  readonly nodes: TNode[];
}

/** Encoding only. Parsed data is always validated by the paginator. */
export interface CursorTransformer {
  parse(text: string): unknown;
  stringify(cursor: CursorEnvelope): string;
}
