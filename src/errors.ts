export type PaginationInputErrorCode =
  | "INVALID_CURSOR"
  | "UNSUPPORTED_CURSOR_VERSION"
  | "INVALID_LIMIT"
  | "INVALID_OPTION"
  | "INVALID_ORDER"
  | "UNSUPPORTED_QUERY"
  | "UNSUPPORTED_VALUE";

/** Stable, inspectable errors for unsupported pagination inputs. */
export class PaginationInputError extends Error {
  readonly name = "PaginationInputError";
  constructor(
    readonly code: PaginationInputErrorCode,
    message: string,
  ) {
    super(message);
  }
}
