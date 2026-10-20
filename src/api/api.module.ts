import {
  type DynamicModule,
  Module,
  type ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { CatalogService } from './catalog.service.js';
import { ApiController } from './controllers.js';
import { API_DEPS, type ApiDeps } from './deps.js';
import { ApiError, ErrorFilter } from './errors.js';

/** REQ-API-003: validation failures list the invalid fields in `details`. */
function flatten(errors: ValidationError[], prefix = ''): unknown[] {
  return errors.flatMap((error) => {
    const field = prefix + error.property;
    const own = error.constraints
      ? [{ field, errors: Object.values(error.constraints) }]
      : [];
    return [...own, ...flatten(error.children ?? [], `${field}.`)];
  });
}

@Module({})
export class ApiModule {
  static register(deps: ApiDeps): DynamicModule {
    return {
      module: ApiModule,
      controllers: [ApiController],
      providers: [
        { provide: API_DEPS, useValue: deps },
        CatalogService,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
            exceptionFactory: (errors) =>
              new ApiError(
                400,
                'validation_error',
                'Request validation failed',
                flatten(errors),
              ),
          }),
        },
      ],
    };
  }
}
