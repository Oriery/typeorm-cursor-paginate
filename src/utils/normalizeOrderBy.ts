import { ObjectLiteral } from "typeorm";
import { Order, OrderBy } from "../interfaces/paginator";

export function normalizeOrderBy<TEntity extends ObjectLiteral>(
  orderBy: OrderBy<TEntity> | OrderBy<TEntity>[],
): [string, boolean][] {
  const orders = [] as [string, boolean][];
  for (const order of Array.isArray(orderBy) ? orderBy : [orderBy]) {
    for (const [key, value] of Object.entries(order)) {
      if (value === undefined) continue;
      orders.push([key, value === "ASC"]);
    }
  }
  return orders;
}
