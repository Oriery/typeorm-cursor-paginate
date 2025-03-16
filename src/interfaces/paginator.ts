import { ObjectLiteral } from "typeorm";

export type Order = "ASC" | "DESC";

export type OrderBy<TEntity extends ObjectLiteral> = {
  [TKey in keyof TEntity]?: Order;
};

export type Cursor<TEntity extends ObjectLiteral> = {
  [TKey in keyof TEntity]?: any;
};

export type DirectionalCursor<TEntity extends ObjectLiteral> = {
  cursor: Cursor<TEntity>;
  direction: "next" | "prev";
};

export interface CursorPagination<TEntity extends ObjectLiteral> {
  readonly totalCount: number;
  /**
   * Indicates whether a previous page is available.
   *
   * Note: In rare scenarios, this value may be `true` even when no previous page exists. This can occur if
   * the current page was retrieved using a cursor, but all nodes prior to that cursor have been deleted.
   */
  readonly hasPrevPage: boolean;
  /**
   * Indicates whether a next page is available.
   *
   * Note: In rare scenarios, this value may be `true` even when no next page exists. This can occur if
   * the current page was retrieved using a cursor, but all nodes after that cursor have been deleted.
   */
  readonly hasNextPage: boolean;
  /**
   * The cursor to the previous page.
   *
   * It is a string even if hasPrevPage is false. It is null only if no nodes are found in the current page.
   */
  readonly prevPageCursor: string | null;
  /**
   * The cursor to the next page.
   *
   * It is a string even if hasNextPage is false. It is null only if no nodes are found in the current page.
   */
  readonly nextPageCursor: string | null;
  /**
   * The list of nodes in the current page.
   */
  readonly nodes: TEntity[];
}

export interface CursorTransformer<TEntity extends ObjectLiteral> {
  parse(text: string): Cursor<TEntity>;
  stringify(cursor: Cursor<TEntity>): string;
}
