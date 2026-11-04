import type { ObjectLiteral, ObjectType, SelectQueryBuilder } from "typeorm";
import { PaginationInputError } from "./errors";
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
  options: PaginateOptions<TEntity>,
) {
  if (arguments.length > 3) {
    throw new PaginationInputError(
      "UNSUPPORTED_QUERY",
      "Positional raw mode was removed; use paginateRaw",
    );
  }
  return new CursorPaginator(entity, options).paginate(qb, options);
}

export function paginateRaw<
  TRaw extends ObjectLiteral,
  TEntity extends ObjectLiteral = ObjectLiteral,
>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
) {
  return new CursorPaginator(entity, options).paginateRaw<TRaw>(qb, options);
}
