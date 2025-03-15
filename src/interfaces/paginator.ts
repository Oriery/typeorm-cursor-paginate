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

export interface CursorPagination<TEntity extends ObjectLiteral> {
  readonly count: number;
  readonly nodes: TEntity[];
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
  readonly prevCursor: string | null;
  readonly nextCursor: string | null;
}

export interface PromiseCursorPagination<TEntity extends ObjectLiteral> {
  readonly count: Promise<number>;
  readonly nodes: Promise<TEntity[]>;
  readonly hasPrev: Promise<boolean>;
  readonly hasNext: Promise<boolean>;
  readonly prevCursor: Promise<string | null>;
  readonly nextCursor: Promise<string | null>;
}

export interface CursorTransformer<TEntity extends ObjectLiteral> {
  parse(text: string): Cursor<TEntity>;
  stringify(cursor: Cursor<TEntity>): string;
}

export interface PagePagination<TEntity extends ObjectLiteral> {
  readonly count: number;
  readonly nodes: TEntity[];
  readonly hasNext: boolean;
}

export interface PromisePagePagination<TEntity extends ObjectLiteral> {
  readonly count: Promise<number>;
  readonly nodes: Promise<TEntity[]>;
  readonly hasNext: Promise<boolean>;
}
