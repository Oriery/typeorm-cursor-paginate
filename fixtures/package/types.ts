import paginateDefault, {
  Base64Transformer,
  CursorPaginator,
  JsonTransformer,
  PaginationInputError,
  paginate,
  paginateRaw,
  type CursorEnvelope,
  type CursorPaginatorPaginateParams,
  type CursorPaginatorParams,
  type CursorTransformer,
  type CursorValue,
  type NormalizedOrder,
  type Order,
  type OrderBy,
  type PaginateOptions,
  type Paginated,
  type PaginationInputErrorCode,
} from "typeorm-cursor-paginate";
import type { SelectQueryBuilder } from "typeorm";

class User {
  id!: number;
  name!: string;
}
type RawUser = { user_id: number; display_name: string };
declare const query: SelectQueryBuilder<User>;
declare const dynamic: boolean;

const defaultIsNamed: typeof paginate = paginateDefault;
const transformer: CursorTransformer = new Base64Transformer();
const json: CursorTransformer = new JsonTransformer();
const envelope: CursorEnvelope = {
  version: 3,
  direction: "next",
  order: [{ key: "id", direction: "ASC", nulls: "LAST" }],
  values: [1],
};
const normalized: NormalizedOrder = envelope.order[0];
const value: CursorValue = envelope.values[0];
const direction: Order = "asc";
const orderBy: OrderBy<User> = { id: direction };
const settings: CursorPaginatorParams<User> = {
  orderBy,
  cursorTransformer: transformer,
};
const options: PaginateOptions<User> = {
  ...settings,
  noOppositePageCheck: dynamic,
};
const pageOptions: CursorPaginatorPaginateParams = {
  noOppositePageCheck: dynamic,
};
const code: PaginationInputErrorCode = "UNSUPPORTED_CURSOR_VERSION";
const error: Error = new PaginationInputError(code, "Restart pagination");
const paginator = new CursorPaginator(User, settings);

const ordinary: Promise<Paginated<User>> = paginator.paginate(query);
const ordinaryFalse: Promise<Paginated<User>> = paginator.paginate(query, {
  noOppositePageCheck: false,
});
const ordinaryStandalone: Promise<Paginated<User>> = paginate(User, query, {
  orderBy,
});
const unknownFlags: Promise<Paginated<User, boolean | null>> =
  paginator.paginate(query, pageOptions);
const unknownStandalone: Promise<Paginated<User, boolean | null>> = paginate(
  User,
  query,
  options,
);
// @ts-expect-error The unchecked direction can be null.
const uncheckedAsBoolean: Promise<Paginated<User>> = paginator.paginate(query, {
  noOppositePageCheck: true,
});
// @ts-expect-error A dynamic option must not promise boolean-only flags.
const dynamicAsBoolean: Promise<Paginated<User>> = paginate(
  User,
  query,
  options,
);

const raw: Promise<Paginated<RawUser>> = paginator.paginateRaw<RawUser>(query);
const rawStandalone: Promise<Paginated<RawUser>> = paginateRaw<RawUser, User>(
  User,
  query,
  { orderBy },
);
const rawUnchecked: Promise<Paginated<RawUser, boolean | null>> =
  paginator.paginateRaw<RawUser>(query, { noOppositePageCheck: true });
// @ts-expect-error Raw aliases are not hydrated entities.
const rawAsEntity: Promise<Paginated<User>> =
  paginator.paginateRaw<RawUser>(query);
// Infer the default before assigning; contextual return types can infer a raw generic.
const inferredRaw = paginator.paginateRaw(query);
const inferredRawStandalone = paginateRaw(User, query, { orderBy });
// @ts-expect-error Undeclared raw field values are unknown, never any.
const unknownRaw: Promise<Paginated<Record<string, string>>> = inferredRaw;
// @ts-expect-error The standalone API must use the same honest raw default.
const unknownRawStandalone: Promise<Paginated<Record<string, string>>> =
  inferredRawStandalone;
// @ts-expect-error Parsed codec payloads require validation before use.
const parsed: CursorEnvelope = transformer.parse(
  transformer.stringify(envelope),
);
// @ts-expect-error v2 option was removed.
new CursorPaginator(User, { orderBy, transformer });
// @ts-expect-error Raw mode is a separate API in v3.
paginator.paginate(query, {}, true);
// @ts-expect-error Raw mode is a separate standalone API in v3.
paginate(User, query, { orderBy }, true);
// @ts-expect-error CursorEnvelope is a type, not an undefined runtime export.
const runtimeEnvelope = CursorEnvelope;
