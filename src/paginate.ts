import { ObjectLiteral, ObjectType, SelectQueryBuilder } from "typeorm";
import {
  CursorPaginator,
  CursorPaginatorPaginateParams,
  CursorPaginatorParams,
} from "./cursor-paginator";

export type PaginateOptions<TEntity extends ObjectLiteral> =
  CursorPaginatorPaginateParams & CursorPaginatorParams<TEntity>;

export function paginate<TEntity extends ObjectLiteral>(
  entity: ObjectType<TEntity>,
  qb: SelectQueryBuilder<TEntity>,
  options: PaginateOptions<TEntity>,
  isRaw = false,
) {
  const paginator = new CursorPaginator<TEntity>(entity, options);

  return paginator.paginate(qb, options, isRaw);
}
