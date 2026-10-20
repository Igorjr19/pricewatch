import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { AcceptsRunToken, Public } from './auth.guard.js';
import { CatalogService } from './catalog.service.js';
import { API_DEPS, type ApiDeps } from './deps.js';
import {
  CreateListingBody,
  CreateListingQuery,
  CreateProductBody,
  CreateRuleBody,
  DeleteQuery,
  HistoryQuery,
  NotificationsQuery,
  PageQuery,
  ProbeBody,
  RangeQuery,
  UpdateListingBody,
  UpdateProductBody,
  UpdateRuleBody,
} from './dto.js';
import { ApiError } from './errors.js';

@Controller('api/v1')
export class ApiController {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(API_DEPS) private readonly deps: ApiDeps,
  ) {}

  // REQ-API-012: a single `select 1`, no other work.
  @Public()
  @Get('health')
  async health(
    @Res({ passthrough: true }) res: { status(code: number): void },
  ) {
    const ok = await this.catalog.health();
    if (!ok) res.status(503);
    return {
      status: ok ? 'ok' : 'error',
      version: this.deps.version,
      db: ok ? 'ok' : 'error',
    };
  }

  @Get('adapters')
  adapters() {
    return this.catalog.adapters();
  }

  @Post('probe')
  @HttpCode(200)
  probe(@Body() body: ProbeBody) {
    return this.catalog.probe(body.url);
  }

  @Get('products')
  products(@Query() query: PageQuery) {
    return this.catalog.listProducts(query);
  }

  @Post('products')
  createProduct(@Body() body: CreateProductBody) {
    return this.catalog.createProduct(body);
  }

  @Get('products/:id')
  product(@Param('id') id: string) {
    return this.catalog.getProduct(id);
  }

  @Patch('products/:id')
  updateProduct(@Param('id') id: string, @Body() body: UpdateProductBody) {
    return this.catalog.updateProduct(id, body);
  }

  @Delete('products/:id')
  @HttpCode(204)
  async deleteProduct(@Param('id') id: string, @Query() query: DeleteQuery) {
    await this.catalog.deleteProduct(id, query.confirm === 'true');
  }

  @Post('products/:id/listings')
  async createListing(
    @Param('id') id: string,
    @Body() body: CreateListingBody,
    @Query() query: CreateListingQuery,
  ) {
    const created = await this.catalog.createListing(
      id,
      body,
      query.probe === 'true',
    );
    return query.probe === 'true'
      ? { ...created.listing, probe: created.probe }
      : created.listing;
  }

  @Get('products/:id/history')
  history(@Param('id') id: string, @Query() query: HistoryQuery) {
    return this.catalog.history(id, query);
  }

  @Get('products/:id/rules')
  rules(@Param('id') id: string) {
    return this.catalog.listRules(id);
  }

  @Post('products/:id/rules')
  createRule(@Param('id') id: string, @Body() body: CreateRuleBody) {
    return this.catalog.createRule(id, body);
  }

  @Patch('listings/:id')
  updateListing(@Param('id') id: string, @Body() body: UpdateListingBody) {
    return this.catalog.updateListing(id, body);
  }

  @Delete('listings/:id')
  @HttpCode(204)
  async deleteListing(@Param('id') id: string) {
    await this.catalog.deleteListing(id);
  }

  @Post('listings/:id/check')
  @HttpCode(200)
  check(@Param('id') id: string) {
    return this.catalog.checkListing(id);
  }

  @Get('listings/:id/observations')
  observations(@Param('id') id: string, @Query() query: RangeQuery) {
    return this.catalog.observations(id, query);
  }

  @Get('listings/:id/attempts')
  attempts(@Param('id') id: string, @Query() query: PageQuery) {
    return this.catalog.attempts(id, query);
  }

  @Patch('rules/:id')
  updateRule(@Param('id') id: string, @Body() body: UpdateRuleBody) {
    return this.catalog.updateRule(id, body);
  }

  @Delete('rules/:id')
  @HttpCode(204)
  async deleteRule(@Param('id') id: string) {
    await this.catalog.deleteRule(id);
  }

  @Get('channels')
  channels() {
    return this.catalog.channels();
  }

  @Post('channels/:name/test')
  @HttpCode(200)
  testChannel(@Param('name') name: string) {
    return this.catalog.testChannel(name);
  }

  @Get('notifications')
  notifications(@Query() query: NotificationsQuery) {
    return this.catalog.notifications(query);
  }

  @Get('runs')
  runs(@Query() query: PageQuery) {
    return this.catalog.runs(query);
  }

  /** REQ-RUN-004: synchronous; 409 when another cycle holds the lock. */
  @AcceptsRunToken()
  @Post('run')
  @HttpCode(200)
  async run() {
    const result = await this.deps.cycle.run('api');
    if (result.lockBusy) {
      throw new ApiError(409, 'run_in_progress', 'Another cycle is running');
    }
    return result.summary;
  }
}
