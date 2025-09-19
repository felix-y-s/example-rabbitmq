// rebbitMQ 용 dtos

import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export enum StockOperationType {
  REDUCE = 'reduce',
  RESERVE = 'reserve',
  RELEASE = 'release',
  INCREASE = 'increase',
}

export class StockReductionMessage {
  @IsNumber()
  productionId: number;

  @IsNumber()
  quantity: number;

  @IsString()
  orderId: string;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  correlationId: string;

  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @IsOptional()
  @IsNumber()
  retryCount?: number;

  @IsOptional()
  @IsEnum(StockOperationType)
  operation?: StockOperationType;

  @IsOptional()
  priority?: number; // 0-10 우선순위
}

export class StockOperationResult {
  success: boolean;
  message: string;
  productId: number;
  finalStock?: number;
  processingTime?: number;
  correlationId?: string;
}

export class BatchStockMessage {
  @IsString()
  batchId: string;

  items: Array<{
    productId: number;
    quantity: number;
    operation: StockOperationType;
  }>;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  correlationId?: string;
}