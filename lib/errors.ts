import { NextResponse } from "next/server";

export type AppErrorCode =
  | "VALIDATION"
  | "INVALID_BARCODE"
  | "NO_MATCH"
  | "NOT_FOUND"
  | "UPSTREAM_UNAVAILABLE"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    public httpStatus: number,
    public userMessage: string,
    public retryable = false,
  ) {
    super(userMessage);
    this.name = "AppError";
  }
}

export const invalidBarcode = () =>
  new AppError(
    "INVALID_BARCODE",
    422,
    "That doesn't look like a valid product code. Check the digits printed under the bars.",
  );

export const noMatch = () =>
  new AppError(
    "NO_MATCH",
    404,
    "Valid code, but no product data in any source we query.",
  );

export const upstreamUnavailable = () =>
  new AppError(
    "UPSTREAM_UNAVAILABLE",
    503,
    "Some data sources are unreachable right now. Try again shortly.",
    true,
  );

export function toResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.userMessage,
          retryable: err.retryable,
        },
      },
      {
        status: err.httpStatus,
        headers: err.retryable ? { "Retry-After": "10" } : undefined,
      },
    );
  }
  console.error(err);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL",
        message: "Something broke on our side.",
        retryable: true,
      },
    },
    { status: 500 },
  );
}
