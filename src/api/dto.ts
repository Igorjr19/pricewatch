import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PageQuery {
  /** REQ-API-004: default 50, max 500. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(26)
  cursor?: string;
}

export class RangeQuery extends PageQuery {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class HistoryQuery {
  @IsOptional()
  @IsIn(['day'])
  bucket?: 'day';

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export class NotificationsQuery extends PageQuery {
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsIn(['sent', 'failed'])
  status?: 'sent' | 'failed';

  @IsOptional()
  @IsString()
  ruleId?: string;
}

export class ProbeBody {
  @IsString()
  @MinLength(1)
  url!: string;
}

export class CreateProductBody {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateProductBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class DeleteQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  confirm?: string;
}

export class CreateListingBody {
  @IsString()
  @MinLength(1)
  url!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  checkIntervalMinutes?: number;
}

export class CreateListingQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  probe?: string;
}

export class UpdateListingBody {
  @IsOptional()
  @IsIn(['active', 'paused'])
  status?: 'active' | 'paused';

  @IsOptional()
  @IsInt()
  @Min(1)
  checkIntervalMinutes?: number;
}

export class CreateRuleBody {
  @IsIn(['target_price', 'new_low', 'back_in_stock'])
  type!: 'target_price' | 'new_low' | 'back_in_stock';

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  cooldownMinutes?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRuleBody {
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  channels?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  cooldownMinutes?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
