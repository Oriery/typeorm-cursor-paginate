import { ObjectLiteral } from "typeorm";

export type Nullable<T> = {
  [P in keyof T]?: T[P] | null;
};

export interface Take {
  default: number;
  min: number;
  max: number;
}

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
  readonly nodes: TEntity[];
  readonly hasPrevPage: boolean;
  readonly hasNextPage: boolean;
  readonly prevPageCursor: string | null;
  readonly nextPageCursor: string | null;
}

export interface CursorTransformer<TEntity extends ObjectLiteral> {
  parse(text: string): Cursor<TEntity>;
  stringify(cursor: Cursor<TEntity>): string;
}

export interface PagePagination<TEntity extends ObjectLiteral> {
  readonly totalCount: number;
  readonly nodes: TEntity[];
  readonly hasNextPage: boolean;
}

export interface PromisePagePagination<TEntity extends ObjectLiteral> {
  readonly totalCount: Promise<number>;
  readonly nodes: Promise<TEntity[]>;
  readonly hasNextPage: Promise<boolean>;
}
