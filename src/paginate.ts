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
  const { pageCursor, limit, orderBy, transformer } = options;

  const paginator = new CursorPaginator<TEntity>(entity, {
    orderBy,
    transformer,
  });

  return paginator.paginate(qb, { pageCursor, limit }, isRaw);
}
