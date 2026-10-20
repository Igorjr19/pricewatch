import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { API_DEPS, type ApiDeps } from './deps.js';
import { ApiError } from './errors.js';

export const PUBLIC = 'public';
export const RUN_ROUTE = 'run-route';
/** No authentication (`GET /health`). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Also accepts `PW_RUN_TOKEN` (REQ-RUN-004). */
export const AcceptsRunToken = () => SetMetadata(RUN_ROUTE, true);

/** Constant-time comparison (REQ-API-001); hashing first makes the lengths equal. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  const length = Math.max(left.length, right.length, 1);
  const pad = (buffer: Buffer) => Buffer.concat([buffer], length);
  return timingSafeEqual(pad(left), pad(right)) && left.length === right.length;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(API_DEPS) private readonly deps: ApiDeps,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const header: string | undefined = context.switchToHttp().getRequest()
      .headers.authorization;
    const match = /^Bearer (.+)$/.exec(header ?? '');
    const presented = match?.[1];
    if (presented) {
      const accepted = [this.deps.apiToken];
      if (this.reflector.getAllAndOverride<boolean>(RUN_ROUTE, targets)) {
        accepted.push(this.deps.runToken);
      }
      let ok = false;
      for (const token of accepted) {
        if (token && safeEqual(presented, token)) ok = true;
      }
      if (ok) return true;
    }
    throw new ApiError(401, 'unauthorized', 'Missing or invalid bearer token');
  }
}
