import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';

/** REQ-API-002: every error is `{ error: { code, message, details? } }`. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
};

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse();
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details === undefined
            ? {}
            : { details: exception.details }),
        },
      });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json({
        error: {
          code: CODES[status] ?? 'error',
          message: exception.message,
        },
      });
      return;
    }
    // Never echo internals (they may carry secrets); log the cause server-side.
    this.logger.error(
      exception instanceof Error ? exception.message : String(exception),
    );
    response.status(500).json({
      error: { code: 'internal_error', message: 'Internal server error' },
    });
  }
}
