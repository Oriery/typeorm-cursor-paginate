import type { ObjectLiteral, ObjectType, SelectQueryBuilder } from "typeorm";
import { PaginationInputError } from "./errors";
import type { Paginated } from "./interfaces/paginator";
import {
  CursorPaginator,
  type CursorPaginatorPaginateParams,
  type CursorPaginatorParams,
} from "./cursor-paginator";

export type PaginateOptions<TEntity extends ObjectLiteral> =
  CursorPaginatorPaginateParams & CursorPaginatorParams<TEntity>;

export function paginate<TEntity extends ObjectLiteral>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity> & { noOppositePageCheck?: false },
): Promise<Paginated<TEntity>>;
export function paginate<TEntity extends ObjectLiteral>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
): Promise<Paginated<TEntity, boolean | null>>;
export function paginate<TEntity extends ObjectLiteral>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
): Promise<Paginated<TEntity, boolean | null>> {
  if (arguments.length > 3) {
    throw new PaginationInputError(
      "UNSUPPORTED_QUERY",
      "Positional raw mode was removed; use paginateRaw",
    );
  }
  return new CursorPaginator(entity, options).paginate(qb, options);
}

export function paginateRaw<
  TRaw extends ObjectLiteral = Record<string, unknown>,
  TEntity extends ObjectLiteral = ObjectLiteral,
>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity> & { noOppositePageCheck?: false },
): Promise<Paginated<TRaw>>;
export function paginateRaw<
  TRaw extends ObjectLiteral = Record<string, unknown>,
  TEntity extends ObjectLiteral = ObjectLiteral,
>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
): Promise<Paginated<TRaw, boolean | null>>;
export function paginateRaw<
  TRaw extends ObjectLiteral = Record<string, unknown>,
  TEntity extends ObjectLiteral = ObjectLiteral,
>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
): Promise<Paginated<TRaw, boolean | null>> {
  return new CursorPaginator(entity, options).paginateRaw<TRaw>(qb, options);
}
