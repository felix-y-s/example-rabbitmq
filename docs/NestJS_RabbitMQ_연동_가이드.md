# 🐰 NestJS + RabbitMQ 연동 완전 가이드

## 📋 목차
1. [패키지 설치 및 기본 설정](#1-패키지-설치-및-기본-설정)
2. [환경 설정](#2-환경-설정)
3. [RabbitMQ 모듈 설정](#3-rabbitmq-모듈-설정)
4. [@RabbitSubscribe 데코레이터 완전 가이드](#4-rabbitsubscribe-데코레이터-완전-가이드)
5. [메시지 DTO 정의](#5-메시지-dto-정의)
6. [모듈 통합](#6-모듈-통합)
7. [Producer (메시지 발송) 구현](#7-producer-메시지-발송-구현)
8. [Consumer (메시지 처리) 구현](#8-consumer-메시지-처리-구현)
9. [Controller API 구현](#9-controller-api-구현)
10. [개발 환경 준비](#10-개발-환경-준비)
11. [테스트 구현](#11-테스트-구현)
12. [핵심 포인트 요약](#12-핵심-포인트-요약)

---

## 1. 패키지 설치 및 기본 설정

### 필수 패키지 설치
```bash
# RabbitMQ 관련 패키지
npm install @golevelup/nestjs-rabbitmq amqplib

# 타입 정의
npm install -D @types/amqplib
```

### 패키지 역할
- `@golevelup/nestjs-rabbitmq`: NestJS용 RabbitMQ 통합 라이브러리
- `amqplib`: Node.js용 AMQP 0-9-1 클라이언트
- `@types/amqplib`: TypeScript 타입 정의

---

## 2. 환경 설정

### .env 파일 설정
```env
# RabbitMQ 연결 설정
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_EXCHANGE=inventory-exchange
RABBITMQ_QUEUE_PREFIX=inventory

# 성능 튜닝 옵션
RABBITMQ_PREFETCH_COUNT=1
RABBITMQ_MESSAGE_TTL=300000
RABBITMQ_MAX_RETRIES=3
```

### 환경별 설정 예시
```typescript
// config/rabbitmq.config.ts
export default () => ({
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    exchange: process.env.RABBITMQ_EXCHANGE || 'inventory-exchange',
    prefetchCount: parseInt(process.env.RABBITMQ_PREFETCH_COUNT) || 1,
    messageTTL: parseInt(process.env.RABBITMQ_MESSAGE_TTL) || 300000,
    maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES) || 3,
  },
});
```

---

## 3. RabbitMQ 모듈 설정

### RabbitMQ 전용 모듈 생성
```typescript
// src/rabbitmq/rabbitmq.module.ts
import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RabbitMQModule.forRootAsync(RabbitMQModule, {
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        // 🔗 연결 설정
        uri: configService.get<string>('RABBITMQ_URL'),

        // 🏗️ Exchange 자동 생성
        exchanges: [
          {
            name: 'inventory-exchange',
            type: 'topic',        // topic, direct, fanout, headers
            options: {
              durable: true,      // 서버 재시작 시에도 유지
            },
          },
          {
            name: 'dlq-exchange', // Dead Letter Queue용
            type: 'direct',
            options: { durable: true },
          },
          {
            name: 'notification-exchange', // 알림용
            type: 'fanout',
            options: { durable: true },
          },
        ],

        // 📦 Queue 자동 생성
        queues: [
          {
            name: 'stock-reduce-queue',
            exchange: 'inventory-exchange',
            routingKey: 'stock.reduce',
            options: {
              durable: true,
              arguments: {
                'x-message-ttl': 300000,           // 5분 TTL
                'x-dead-letter-exchange': 'dlq-exchange',
                'x-dead-letter-routing-key': 'stock.failed',
                'x-max-retries': 3,
                'x-max-priority': 10,              // 우선순위 지원
              },
            },
          },
          {
            name: 'stock-urgent-queue',
            exchange: 'inventory-exchange',
            routingKey: 'stock.urgent',
            options: {
              durable: true,
              arguments: {
                'x-max-priority': 10,              // 우선순위 큐
                'x-message-ttl': 60000,            // 1분 TTL
              },
            },
          },
          {
            name: 'stock-failed-queue',
            exchange: 'dlq-exchange',
            routingKey: 'stock.failed',
            options: { durable: true },
          },
        ],

        // ⚙️ 연결 옵션
        connectionInitOptions: { wait: false },
        enableControllerDiscovery: true,  // 자동 Consumer 검색

        // 🔧 성능 튜닝
        channels: {
          'stock-channel': {
            prefetchCount: 1,              // 순차 처리
            default: true,
          },
          'notification-channel': {
            prefetchCount: 100,            // 병렬 처리
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [RabbitMQModule],
})
export class RabbitMQConfigModule {}
```

### Exchange 타입별 특징
| 타입 | 설명 | 사용 사례 |
|------|------|----------|
| **direct** | 정확한 routing key 매칭 | 특정 작업 타입별 처리 |
| **topic** | 패턴 매칭 (*, #) | 계층적 라우팅 |
| **fanout** | 모든 바인딩된 큐로 전송 | 브로드캐스트 알림 |
| **headers** | 헤더 기반 라우팅 | 복잡한 조건부 라우팅 |

---

## 4. @RabbitSubscribe 데코레이터 완전 가이드

### 기본 사용법
```typescript
// src/inventory/inventory.consumer.ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, RabbitPayload, RabbitContext } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage, Channel } from 'amqplib';

@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  // 🎯 기본 Consumer
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.reduce',
    queue: 'stock-reduce-queue',
  })
  async handleStockReduction(
    @RabbitPayload() message: StockReductionMessage,  // 메시지 내용
    @RabbitContext() context: {                       // 메타데이터
      channel: Channel;
      message: ConsumeMessage;
      correlationId: string;
      timestamp: number;
    }
  ) {
    this.logger.log(`재고 감소 요청: ${JSON.stringify(message)}`);

    try {
      // 비즈니스 로직 처리
      await this.processStockReduction(message);

      // ✅ 수동 ACK (처리 성공)
      context.channel.ack(context.message);

    } catch (error) {
      this.logger.error('재고 감소 실패:', error);

      // ❌ NACK (처리 실패 - 재시도)
      context.channel.nack(context.message, false, true);
    }
  }
}
```

### 고급 설정 옵션
```typescript
@Injectable()
export class AdvancedInventoryConsumer {

  // 🔧 상세 설정 Consumer
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.reduce',
    queue: 'stock-reduce-queue',

    // 🎯 성능 튜닝
    queueOptions: {
      durable: true,                    // 영속성
      exclusive: false,                 // 다른 연결에서도 접근 가능
      autoDelete: false,                // 자동 삭제 비활성화
      arguments: {
        'x-message-ttl': 300000,        // 메시지 TTL (5분)
        'x-max-length': 10000,          // 최대 메시지 수
        'x-max-priority': 10,           // 우선순위 지원
        'x-dead-letter-exchange': 'dlq-exchange',
        'x-dead-letter-routing-key': 'stock.failed'
      }
    },

    // 🚀 Consumer 설정
    prefetchCount: 1,                   // 한 번에 하나씩 처리 (순차 보장)
    noAck: false,                       // 수동 ACK 모드
    consumerOptions: {
      priority: 5,                      // Consumer 우선순위
      exclusive: false,                 // 독점 모드 비활성화
    },

    // 🚨 에러 처리
    errorBehavior: 'NACK',              // 에러 시 NACK
    errorHandler: (channel, msg, error) => {
      console.error('Custom error handler:', error);
      channel.nack(msg, false, true);  // 재시도
    },
  })
  async handleWithAdvancedOptions(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    // 처리 로직
  }

  // 🎭 여러 Routing Key 구독
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: ['stock.reduce', 'stock.reserve', 'stock.release'],
    queue: 'stock-operations-queue',
  })
  async handleMultipleOperations(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    const routingKey = context.message.fields.routingKey;

    switch (routingKey) {
      case 'stock.reduce':
        await this.handleReduce(message);
        break;
      case 'stock.reserve':
        await this.handleReserve(message);
        break;
      case 'stock.release':
        await this.handleRelease(message);
        break;
    }

    context.channel.ack(context.message);
  }

  // 🔥 우선순위 처리
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.urgent',
    queue: 'stock-urgent-queue',
    queueOptions: {
      arguments: {
        'x-max-priority': 10,           // 우선순위 큐
      }
    }
  })
  async handleUrgentStock(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    // 긴급 재고 처리 (높은 우선순위)
  }

  // 💀 Dead Letter Queue 처리
  @RabbitSubscribe({
    exchange: 'dlq-exchange',
    routingKey: 'stock.failed',
    queue: 'stock-failed-queue',
  })
  async handleFailedMessages(
    @RabbitPayload() failedMessage: any,
    @RabbitContext() context: any
  ) {
    this.logger.error('실패한 메시지 처리:', failedMessage);

    // 실패 원인 분석
    // 관리자 알림
    // 수동 복구 또는 보상 트랜잭션

    context.channel.ack(context.message);
  }

  // 🎯 패턴 매칭 (Topic Exchange)
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.*',              // stock.reduce, stock.reserve 등 모두 매칭
    queue: 'stock-all-queue',
  })
  async handleAllStockOperations(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    const routingKey = context.message.fields.routingKey;
    this.logger.log(`모든 재고 작업 처리: ${routingKey}`);

    // 공통 처리 로직 (로깅, 모니터링 등)
    context.channel.ack(context.message);
  }
}
```

### Routing Key 패턴 매칭
| 패턴 | 설명 | 예시 |
|------|------|------|
| `stock.reduce` | 정확히 일치 | `stock.reduce`만 매칭 |
| `stock.*` | 한 단어 와일드카드 | `stock.reduce`, `stock.reserve` 매칭 |
| `stock.#` | 다중 단어 와일드카드 | `stock.reduce.urgent`, `stock.reserve.batch` 매칭 |
| `*.urgent` | 끝 패턴 매칭 | `stock.urgent`, `order.urgent` 매칭 |

---

## 5. 메시지 DTO 정의

### 기본 메시지 구조
```typescript
// src/inventory/dto/stock-message.dto.ts
import { IsNumber, IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum StockOperationType {
  REDUCE = 'reduce',
  RESERVE = 'reserve',
  RELEASE = 'release',
  INCREASE = 'increase',
}

export class StockReductionMessage {
  @IsNumber()
  productId: number;

  @IsNumber()
  quantity: number;

  @IsString()
  orderId: string;

  @IsString()
  customerId: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

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
  priority?: number;  // 0-10 우선순위
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
```

### 메시지 검증 파이프
```typescript
// src/common/pipes/message-validation.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';

@Injectable()
export class MessageValidationPipe implements PipeTransform {
  async transform(value: any, metadata: any) {
    const object = plainToClass(metadata.metatype, value);
    const errors = await validate(object);

    if (errors.length > 0) {
      const errorMessages = errors.map(error =>
        Object.values(error.constraints).join(', ')
      ).join('; ');

      throw new BadRequestException(`메시지 검증 실패: ${errorMessages}`);
    }

    return object;
  }
}
```

---

## 6. 모듈 통합

### App Module 설정
```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RabbitMQConfigModule } from './rabbitmq/rabbitmq.module';
import { InventoryModule } from './inventory/inventory.module';
import rabbitmqConfig from './config/rabbitmq.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [rabbitmqConfig],  // 설정 파일 로드
    }),
    RabbitMQConfigModule,      // RabbitMQ 설정
    InventoryModule,           // 비즈니스 로직
  ],
})
export class AppModule {}
```

### Inventory Module 설정
```typescript
// src/inventory/inventory.module.ts
import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryConsumer } from './inventory.consumer';  // Consumer 추가
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    InventoryConsumer,    // Consumer 등록 (자동 검색됨)
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
```

---

## 7. Producer (메시지 발송) 구현

### Service에서 메시지 발송
```typescript
// src/inventory/inventory.service.ts (기존 서비스에 추가)
import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { StockReductionMessage, StockOperationType } from './dto/stock-message.dto';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly amqpConnection: AmqpConnection,  // RabbitMQ 연결
  ) {}

  // 🚀 비동기 재고 감소 (Queue 방식)
  async reduceStockAsync(
    productId: number,
    quantity: number,
    orderId: string,
    customerId: string,
  ): Promise<{ success: boolean; message: string; jobId: string }> {

    // 1. 사전 검증 (빠른 실패)
    const product = await this.inventoryRepository.findInventoryById(productId);
    if (!product) {
      throw new BadRequestException('상품을 찾을 수 없습니다.');
    }

    // 2. 소프트 검증 (재고 여유 확인)
    if (product.stock < quantity) {
      throw new BadRequestException(`재고 부족 (현재: ${product.stock}, 요청: ${quantity})`);
    }

    // 3. 메시지 생성
    const message: StockReductionMessage = {
      productId,
      quantity,
      orderId,
      customerId,
      correlationId: `${orderId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      retryCount: 0,
      operation: StockOperationType.REDUCE,
      priority: 5,  // 기본 우선순위
    };

    // 4. 큐에 메시지 발송
    try {
      await this.amqpConnection.publish(
        'inventory-exchange',    // Exchange
        'stock.reduce',          // Routing Key
        message,                 // 메시지 내용
        {
          correlationId: message.correlationId,
          priority: message.priority,     // 우선순위 (0-10)
          expiration: 300000,            // 5분 TTL
          persistent: true,              // 영속성
          messageId: `stock-${Date.now()}`,
          timestamp: Date.now(),
          headers: {
            'x-retry-count': 0,
            'x-source': 'inventory-service',
          },
        }
      );

      this.logger.log(`재고 감소 메시지 발송: ${message.correlationId}`);

      return {
        success: true,
        message: '재고 감소 요청이 접수되었습니다.',
        jobId: message.correlationId,
      };

    } catch (error) {
      this.logger.error('메시지 발송 실패:', error);
      throw new InternalServerErrorException('재고 감소 요청 발송에 실패했습니다.');
    }
  }

  // 📦 우선순위 재고 처리 (긴급 주문)
  async reduceStockUrgent(
    productId: number,
    quantity: number,
    orderId: string,
  ): Promise<void> {
    const message = {
      productId,
      quantity,
      orderId,
      correlationId: `urgent-${orderId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operation: StockOperationType.REDUCE,
    };

    await this.amqpConnection.publish(
      'inventory-exchange',
      'stock.urgent',      // 긴급 Routing Key
      message,
      {
        priority: 10,      // 최고 우선순위
        expiration: 60000, // 1분 TTL
        persistent: true,
        headers: {
          'x-urgent': true,
          'x-source': 'inventory-service',
        },
      }
    );

    this.logger.log(`긴급 재고 감소 메시지 발송: ${message.correlationId}`);
  }

  // 📈 배치 재고 처리 (여러 상품 한번에)
  async reduceStockBatch(items: Array<{
    productId: number;
    quantity: number;
  }>): Promise<{ batchId: string; messageCount: number }> {

    const batchId = `batch-${Date.now()}`;

    // 배치 메시지 발송
    const promises = items.map((item, index) =>
      this.amqpConnection.publish(
        'inventory-exchange',
        'stock.batch',
        {
          ...item,
          batchId,
          batchIndex: index,
          totalItems: items.length,
          correlationId: `${batchId}-${index}`,
          timestamp: new Date().toISOString(),
        },
        {
          persistent: true,
          headers: {
            'x-batch-id': batchId,
            'x-batch-index': index,
            'x-batch-total': items.length,
          },
        }
      )
    );

    await Promise.all(promises);

    this.logger.log(`배치 재고 처리 메시지 발송: ${batchId}, ${items.length}개 항목`);

    return {
      batchId,
      messageCount: items.length,
    };
  }

  // 🔄 재시도 메시지 발송
  async republishMessage(
    originalMessage: StockReductionMessage,
    delay: number = 0
  ): Promise<void> {
    const retryMessage = {
      ...originalMessage,
      retryCount: (originalMessage.retryCount || 0) + 1,
      timestamp: new Date().toISOString(),
    };

    const publishOptions = {
      correlationId: retryMessage.correlationId,
      persistent: true,
      headers: {
        'x-retry-count': retryMessage.retryCount,
        'x-original-timestamp': originalMessage.timestamp,
        'x-retry-delay': delay,
      },
    };

    if (delay > 0) {
      // 지연 발송 (Delayed Message Plugin 필요)
      publishOptions.headers['x-delay'] = delay;
    }

    await this.amqpConnection.publish(
      'inventory-exchange',
      'stock.reduce',
      retryMessage,
      publishOptions
    );

    this.logger.log(`재시도 메시지 발송: ${retryMessage.correlationId}, 시도: ${retryMessage.retryCount}`);
  }

  // 📊 메시지 상태 조회
  async getMessageStatus(correlationId: string): Promise<any> {
    // 실제로는 Redis나 DB에서 상태를 조회
    // 여기서는 예시만 제공
    return {
      correlationId,
      status: 'PROCESSING', // PENDING, PROCESSING, COMPLETED, FAILED
      progress: 50,
      createdAt: new Date(),
      estimatedCompletion: new Date(Date.now() + 30000),
    };
  }
}
```

### 메시지 발송 유틸리티
```typescript
// src/common/utils/message-publisher.util.ts
import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

interface PublishOptions {
  exchange: string;
  routingKey: string;
  priority?: number;
  expiration?: number;
  persistent?: boolean;
  correlationId?: string;
  headers?: Record<string, any>;
}

@Injectable()
export class MessagePublisher {
  private readonly logger = new Logger(MessagePublisher.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  async publish(message: any, options: PublishOptions): Promise<void> {
    const publishOptions = {
      priority: options.priority || 5,
      expiration: options.expiration || 300000,
      persistent: options.persistent !== false,
      correlationId: options.correlationId || `msg-${Date.now()}`,
      messageId: `${options.routingKey}-${Date.now()}`,
      timestamp: Date.now(),
      headers: {
        'x-published-at': new Date().toISOString(),
        'x-source': 'inventory-service',
        ...options.headers,
      },
    };

    try {
      await this.amqpConnection.publish(
        options.exchange,
        options.routingKey,
        message,
        publishOptions
      );

      this.logger.log(`메시지 발송 성공: ${options.routingKey} -> ${publishOptions.correlationId}`);

    } catch (error) {
      this.logger.error(`메시지 발송 실패: ${options.routingKey}`, error);
      throw error;
    }
  }
}
```

---

## 8. Consumer (메시지 처리) 구현

### 완전한 Consumer 구현
```typescript
// src/inventory/inventory.consumer.ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, RabbitPayload, RabbitContext } from '@golevelup/nestjs-rabbitmq';
import { InventoryService } from './inventory.service';
import { StockReductionMessage, StockOperationResult } from './dto/stock-message.dto';
import { MessagePublisher } from '../common/utils/message-publisher.util';

@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly messagePublisher: MessagePublisher,
  ) {}

  // 🎯 일반 재고 감소 처리
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.reduce',
    queue: 'stock-reduce-queue',
    prefetchCount: 1,          // 순차 처리 보장
    noAck: false,              // 수동 ACK
  })
  async handleStockReduction(
    @RabbitPayload() message: StockReductionMessage,
    @RabbitContext() context: any
  ) {
    const startTime = Date.now();
    const { correlationId } = message;

    this.logger.log(`[${correlationId}] 재고 감소 처리 시작`);

    try {
      // 중복 처리 방지 (Idempotency)
      if (await this.isAlreadyProcessed(correlationId)) {
        this.logger.warn(`[${correlationId}] 이미 처리된 메시지`);
        context.channel.ack(context.message);
        return;
      }

      // 실제 재고 감소 로직 (기존 동기 메서드 활용)
      const result = await this.inventoryService.reduceStockRedisLock(
        message.productId,
        message.quantity,
        {
          maxRetries: 3,
          lockTtl: 5000,
          retryDelay: 100,
        }
      );

      if (result.success) {
        const processingTime = Date.now() - startTime;

        this.logger.log(`[${correlationId}] 재고 감소 성공: ${processingTime}ms`);

        // 처리 완료 상태 저장
        await this.markAsProcessed(correlationId, result);

        // 성공 이벤트 발행 (다른 서비스 알림)
        await this.publishSuccessEvent(message, result);

        // ACK 전송 (메시지 처리 완료)
        context.channel.ack(context.message);

      } else {
        throw new Error(result.message);
      }

    } catch (error) {
      this.logger.error(`[${correlationId}] 재고 감소 실패:`, error.message);

      // 재시도 로직
      await this.handleRetry(message, context, error);
    }
  }

  // 🔥 긴급 재고 처리
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.urgent',
    queue: 'stock-urgent-queue',
    prefetchCount: 1,
    queueOptions: {
      arguments: { 'x-max-priority': 10 }
    }
  })
  async handleUrgentStock(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    const { correlationId } = message;
    this.logger.log(`[${correlationId}] 긴급 재고 처리 시작`);

    try {
      // 긴급 처리 로직 (타임아웃 짧게)
      const result = await Promise.race([
        this.inventoryService.reduceStockRedisLock(message.productId, message.quantity),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('긴급 처리 타임아웃')), 5000)
        )
      ]);

      this.logger.log(`[${correlationId}] 긴급 재고 처리 성공`);

      // 긴급 처리 완료 알림
      await this.messagePublisher.publish(
        { ...message, result, urgent: true },
        {
          exchange: 'notification-exchange',
          routingKey: 'stock.urgent.completed',
          priority: 10,
        }
      );

      context.channel.ack(context.message);

    } catch (error) {
      this.logger.error(`[${correlationId}] 긴급 재고 처리 실패:`, error.message);

      // 긴급 실패 알림 (즉시)
      await this.publishUrgentFailureAlert(message, error);

      context.channel.nack(context.message, false, true);
    }
  }

  // 📦 배치 처리
  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.batch',
    queue: 'stock-batch-queue',
    prefetchCount: 5,  // 배치는 여러 개 동시 처리
  })
  async handleBatchStock(
    @RabbitPayload() message: any,
    @RabbitContext() context: any
  ) {
    const { batchId, batchIndex, correlationId } = message;

    this.logger.log(`[${correlationId}] 배치 처리: ${batchId}[${batchIndex}]`);

    try {
      await this.inventoryService.reduceStockRedisLock(
        message.productId,
        message.quantity
      );

      // 배치 진행상황 업데이트
      await this.updateBatchProgress(batchId, batchIndex);

      context.channel.ack(context.message);

    } catch (error) {
      this.logger.error(`[${correlationId}] 배치 처리 실패:`, error.message);

      // 배치 실패 시 전체 배치 상태 업데이트
      await this.markBatchItemFailed(batchId, batchIndex, error);

      context.channel.nack(context.message, false, false); // DLQ로 이동
    }
  }

  // 💀 실패 메시지 처리 (Dead Letter Queue)
  @RabbitSubscribe({
    exchange: 'dlq-exchange',
    routingKey: 'stock.failed',
    queue: 'stock-failed-queue',
  })
  async handleFailedStock(
    @RabbitPayload() failedMessage: any,
    @RabbitContext() context: any
  ) {
    this.logger.error('실패한 재고 처리:', failedMessage);

    try {
      // 1. 실패 원인 분석
      const analysis = await this.analyzeFailure(failedMessage);

      // 2. 관리자 알림
      await this.notifyAdministrators(failedMessage, analysis);

      // 3. 자동 복구 시도 (가능한 경우)
      if (analysis.recoverable) {
        await this.attemptAutoRecovery(failedMessage);
      } else {
        // 4. 수동 처리 큐에 추가
        await this.addToManualProcessingQueue(failedMessage);
      }

      // 5. 보상 트랜잭션 (필요한 경우)
      if (analysis.requiresCompensation) {
        await this.executeCompensation(failedMessage);
      }

      context.channel.ack(context.message);

    } catch (error) {
      this.logger.error('실패 메시지 처리 중 오류:', error);
      // 실패 처리도 실패한 경우 - 로그만 남기고 ACK
      context.channel.ack(context.message);
    }
  }

  // 🔄 재시도 로직
  private async handleRetry(
    message: StockReductionMessage,
    context: any,
    error: Error
  ): Promise<void> {
    const retryCount = message.retryCount || 0;
    const maxRetries = 3;

    if (retryCount < maxRetries) {
      // 지수 백오프 계산 (1초, 2초, 4초)
      const delay = Math.pow(2, retryCount) * 1000;

      this.logger.log(`[${message.correlationId}] 재시도 예약: ${retryCount + 1}/${maxRetries}, ${delay}ms 후`);

      // 재시도 메시지 발송 (지연)
      setTimeout(async () => {
        try {
          await this.inventoryService.republishMessage(message, delay);
        } catch (republishError) {
          this.logger.error('재시도 메시지 발송 실패:', republishError);
        }
      }, delay);

      // 현재 메시지는 ACK (새 메시지로 재시도)
      context.channel.ack(context.message);

    } else {
      // 최대 재시도 초과 - Dead Letter Queue로 이동
      this.logger.error(`[${message.correlationId}] 최대 재시도 초과, DLQ로 이동`);

      await this.publishFailureEvent(message, error);
      context.channel.nack(context.message, false, false);
    }
  }

  // 헬퍼 메서드들
  private async isAlreadyProcessed(correlationId: string): Promise<boolean> {
    // Redis 또는 DB에서 처리 여부 확인
    // 구현 예시 생략
    return false;
  }

  private async markAsProcessed(correlationId: string, result: any): Promise<void> {
    // Redis 또는 DB에 처리 완료 상태 저장
    // 구현 예시 생략
  }

  private async publishSuccessEvent(message: StockReductionMessage, result: any): Promise<void> {
    await this.messagePublisher.publish(
      {
        correlationId: message.correlationId,
        productId: message.productId,
        quantity: message.quantity,
        orderId: message.orderId,
        result,
        timestamp: new Date().toISOString(),
      },
      {
        exchange: 'notification-exchange',
        routingKey: 'stock.reduction.success',
        priority: 3,
      }
    );
  }

  private async publishFailureEvent(message: StockReductionMessage, error: Error): Promise<void> {
    await this.messagePublisher.publish(
      {
        correlationId: message.correlationId,
        productId: message.productId,
        quantity: message.quantity,
        orderId: message.orderId,
        error: error.message,
        retryCount: message.retryCount,
        timestamp: new Date().toISOString(),
      },
      {
        exchange: 'notification-exchange',
        routingKey: 'stock.reduction.failed',
        priority: 8,
      }
    );
  }

  private async publishUrgentFailureAlert(message: any, error: Error): Promise<void> {
    // 긴급 실패 알림 로직
  }

  private async updateBatchProgress(batchId: string, batchIndex: number): Promise<void> {
    // 배치 진행상황 업데이트 로직
  }

  private async markBatchItemFailed(batchId: string, batchIndex: number, error: Error): Promise<void> {
    // 배치 아이템 실패 마킹 로직
  }

  private async analyzeFailure(failedMessage: any): Promise<any> {
    // 실패 원인 분석 로직
    return {
      recoverable: false,
      requiresCompensation: true,
      category: 'BUSINESS_ERROR',
    };
  }

  private async notifyAdministrators(failedMessage: any, analysis: any): Promise<void> {
    // 관리자 알림 로직
  }

  private async attemptAutoRecovery(failedMessage: any): Promise<void> {
    // 자동 복구 로직
  }

  private async addToManualProcessingQueue(failedMessage: any): Promise<void> {
    // 수동 처리 큐 추가 로직
  }

  private async executeCompensation(failedMessage: any): Promise<void> {
    // 보상 트랜잭션 로직
  }
}
```

---

## 9. Controller API 구현

### 비동기 API 추가
```typescript
// src/inventory/inventory.controller.ts (추가)
import { Controller, Post, Get, Body, Param, Logger } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { ReduceStockDto } from './dto/reduce-stock.dto';

@Controller('inventory')
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(private readonly inventoryService: InventoryService) {}

  // 🚀 비동기 재고 감소 API
  @Post('reduce-stock-async')
  async reduceStockAsync(@Body() reduceStockDto: ReduceStockDto) {
    this.logger.log(`비동기 재고 감소 요청: ${JSON.stringify(reduceStockDto)}`);

    try {
      const result = await this.inventoryService.reduceStockAsync(
        reduceStockDto.productId,
        reduceStockDto.quantity,
        `order-${Date.now()}`,  // 실제로는 주문 시스템에서 전달
        'customer-123'          // 실제로는 인증된 사용자 ID
      );

      return {
        success: true,
        message: '재고 감소 요청이 접수되었습니다.',
        jobId: result.jobId,
        trackingUrl: `/inventory/track/${result.jobId}`,
        estimatedCompletion: '30초 이내',
        status: 'PROCESSING',
      };

    } catch (error) {
      this.logger.error('비동기 재고 감소 요청 실패', error);
      return {
        success: false,
        message: error.message,
        code: error.status || 500,
      };
    }
  }

  // ⚡ 긴급 재고 감소 API
  @Post('reduce-stock-urgent')
  async reduceStockUrgent(@Body() reduceStockDto: ReduceStockDto) {
    this.logger.log(`긴급 재고 감소 요청: ${JSON.stringify(reduceStockDto)}`);

    try {
      await this.inventoryService.reduceStockUrgent(
        reduceStockDto.productId,
        reduceStockDto.quantity,
        `urgent-order-${Date.now()}`
      );

      return {
        success: true,
        message: '긴급 재고 감소 요청이 최우선으로 처리됩니다.',
        priority: 'URGENT',
        estimatedCompletion: '10초 이내',
      };

    } catch (error) {
      this.logger.error('긴급 재고 감소 요청 실패', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // 📦 배치 재고 감소 API
  @Post('reduce-stock-batch')
  async reduceStockBatch(@Body() batchDto: { items: ReduceStockDto[] }) {
    this.logger.log(`배치 재고 감소 요청: ${batchDto.items.length}개 항목`);

    try {
      const result = await this.inventoryService.reduceStockBatch(
        batchDto.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
        }))
      );

      return {
        success: true,
        message: `${result.messageCount}개 항목의 배치 처리가 시작되었습니다.`,
        batchId: result.batchId,
        itemCount: result.messageCount,
        trackingUrl: `/inventory/track/batch/${result.batchId}`,
        estimatedCompletion: '1분 이내',
      };

    } catch (error) {
      this.logger.error('배치 재고 감소 요청 실패', error);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  // 📊 작업 상태 추적 API
  @Get('track/:jobId')
  async trackJob(@Param('jobId') jobId: string) {
    try {
      const status = await this.inventoryService.getMessageStatus(jobId);

      return {
        jobId,
        status: status.status,
        progress: status.progress,
        createdAt: status.createdAt,
        estimatedCompletion: status.estimatedCompletion,
        canCancel: status.status === 'PROCESSING',
      };

    } catch (error) {
      return {
        jobId,
        status: 'NOT_FOUND',
        message: '작업을 찾을 수 없습니다.',
      };
    }
  }

  // 📈 배치 작업 추적 API
  @Get('track/batch/:batchId')
  async trackBatch(@Param('batchId') batchId: string) {
    try {
      // 실제로는 Redis나 DB에서 배치 상태 조회
      return {
        batchId,
        status: 'PROCESSING',
        totalItems: 10,
        completedItems: 7,
        failedItems: 1,
        progress: 70,
        estimatedCompletion: '30초 남음',
        details: [
          { itemIndex: 0, productId: 1, status: 'COMPLETED' },
          { itemIndex: 1, productId: 2, status: 'COMPLETED' },
          { itemIndex: 2, productId: 3, status: 'FAILED', error: '재고 부족' },
          // ...
        ],
      };

    } catch (error) {
      return {
        batchId,
        status: 'NOT_FOUND',
        message: '배치 작업을 찾을 수 없습니다.',
      };
    }
  }

  // 🚨 작업 취소 API (가능한 경우)
  @Post('cancel/:jobId')
  async cancelJob(@Param('jobId') jobId: string) {
    try {
      // 실제로는 작업 상태를 확인하고 취소 가능 여부 판단
      // 큐에서 메시지 제거 또는 취소 플래그 설정

      return {
        success: true,
        message: '작업 취소 요청이 처리되었습니다.',
        jobId,
        status: 'CANCELLED',
      };

    } catch (error) {
      return {
        success: false,
        message: '작업 취소에 실패했습니다.',
        reason: error.message,
      };
    }
  }

  // 📋 큐 상태 모니터링 API (관리자용)
  @Get('admin/queue-stats')
  async getQueueStats() {
    try {
      // 실제로는 RabbitMQ Management API 호출
      return {
        queues: {
          'stock-reduce-queue': {
            messages: 45,
            consumers: 2,
            messageRate: 12.5,
          },
          'stock-urgent-queue': {
            messages: 2,
            consumers: 1,
            messageRate: 0.8,
          },
          'stock-failed-queue': {
            messages: 3,
            consumers: 1,
            messageRate: 0.0,
          },
        },
        overall: {
          totalMessages: 50,
          processingRate: 13.3,
          errorRate: 2.1,
        },
      };

    } catch (error) {
      return {
        error: '큐 상태 조회 실패',
        message: error.message,
      };
    }
  }
}
```

---

## 10. 개발 환경 준비

### Docker로 RabbitMQ 설정
```bash
# RabbitMQ 서버 실행 (Management UI 포함)
docker run -d \
  --name rabbitmq \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin123 \
  -v rabbitmq_data:/var/lib/rabbitmq \
  rabbitmq:3-management

# 플러그인 활성화 (필요시)
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_delayed_message_exchange
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_management
```

### Docker Compose 설정
```yaml
# docker-compose.yml
version: '3.8'

services:
  rabbitmq:
    image: rabbitmq:3-management
    container_name: rabbitmq
    ports:
      - "5672:5672"    # AMQP port
      - "15672:15672"  # Management UI
    environment:
      RABBITMQ_DEFAULT_USER: admin
      RABBITMQ_DEFAULT_PASS: admin123
      RABBITMQ_DEFAULT_VHOST: /
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  rabbitmq_data:
  redis_data:
```

### 실행 및 확인
```bash
# Docker Compose 실행
docker-compose up -d

# 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs rabbitmq

# Management UI 접속
# http://localhost:15672
# 계정: admin / admin123
```

### 환경 설정 파일
```bash
# .env.development
RABBITMQ_URL=amqp://admin:admin123@localhost:5672
RABBITMQ_EXCHANGE=inventory-exchange
RABBITMQ_PREFETCH_COUNT=1
RABBITMQ_MESSAGE_TTL=300000
RABBITMQ_MAX_RETRIES=3

# .env.production
RABBITMQ_URL=amqp://production_user:secure_password@rabbitmq-cluster:5672
RABBITMQ_EXCHANGE=inventory-exchange
RABBITMQ_PREFETCH_COUNT=1
RABBITMQ_MESSAGE_TTL=600000
RABBITMQ_MAX_RETRIES=5
```

---

## 11. 테스트 구현

### E2E 테스트
```typescript
// test/inventory.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('RabbitMQ Inventory Integration Test', () => {
  let app: INestApplication;
  let amqpConnection: AmqpConnection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    amqpConnection = app.get<AmqpConnection>(AmqpConnection);

    await app.init();

    // RabbitMQ 연결 대기
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('비동기 재고 감소 테스트', () => {
    it('정상적인 재고 감소 요청', async () => {
      // Given
      const productId = 1;
      const quantity = 5;

      // When
      const response = await request(app.getHttpServer())
        .post('/inventory/reduce-stock-async')
        .send({ productId, quantity })
        .expect(201);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.jobId).toBeDefined();
      expect(response.body.status).toBe('PROCESSING');

      // 메시지 처리 대기
      await new Promise(resolve => setTimeout(resolve, 3000));

      // 결과 확인
      const trackingResponse = await request(app.getHttpServer())
        .get(`/inventory/track/${response.body.jobId}`)
        .expect(200);

      expect(['COMPLETED', 'PROCESSING']).toContain(trackingResponse.body.status);
    });

    it('재고 부족 시 즉시 실패', async () => {
      // Given
      const productId = 999; // 존재하지 않는 상품
      const quantity = 100;

      // When & Then
      const response = await request(app.getHttpServer())
        .post('/inventory/reduce-stock-async')
        .send({ productId, quantity })
        .expect(201);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('상품을 찾을 수 없습니다');
    });
  });

  describe('긴급 재고 처리 테스트', () => {
    it('긴급 재고 감소 요청', async () => {
      // Given
      const productId = 1;
      const quantity = 2;

      // When
      const response = await request(app.getHttpServer())
        .post('/inventory/reduce-stock-urgent')
        .send({ productId, quantity })
        .expect(201);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.priority).toBe('URGENT');
      expect(response.body.estimatedCompletion).toBe('10초 이내');
    });
  });

  describe('배치 처리 테스트', () => {
    it('여러 상품 배치 처리', async () => {
      // Given
      const items = [
        { productId: 1, quantity: 2 },
        { productId: 2, quantity: 3 },
        { productId: 3, quantity: 1 },
      ];

      // When
      const response = await request(app.getHttpServer())
        .post('/inventory/reduce-stock-batch')
        .send({ items })
        .expect(201);

      // Then
      expect(response.body.success).toBe(true);
      expect(response.body.batchId).toBeDefined();
      expect(response.body.itemCount).toBe(3);

      // 배치 상태 확인
      await new Promise(resolve => setTimeout(resolve, 1000));

      const trackingResponse = await request(app.getHttpServer())
        .get(`/inventory/track/batch/${response.body.batchId}`)
        .expect(200);

      expect(trackingResponse.body.batchId).toBe(response.body.batchId);
      expect(trackingResponse.body.totalItems).toBe(3);
    });
  });

  describe('동시성 테스트', () => {
    it('동일 상품에 대한 동시 요청 처리', async () => {
      // Given
      const productId = 1;
      const quantity = 1;
      const requestCount = 10;

      // When - 동시에 여러 요청 발송
      const promises = Array.from({ length: requestCount }, () =>
        request(app.getHttpServer())
          .post('/inventory/reduce-stock-async')
          .send({ productId, quantity })
      );

      const responses = await Promise.all(promises);

      // Then - 모든 요청이 성공적으로 접수
      const successfulRequests = responses.filter(res => res.body.success);
      expect(successfulRequests.length).toBe(requestCount);

      // 메시지 처리 대기
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 최종 재고 확인 (순차 처리로 인해 정확한 재고 차감)
      const stockResponse = await request(app.getHttpServer())
        .get(`/inventory/stock/${productId}`)
        .expect(200);

      // 재고가 정확히 차감되었는지 확인
      expect(stockResponse.body.stock).toBeGreaterThanOrEqual(0);
    });
  });

  describe('실패 처리 테스트', () => {
    it('처리 실패 시 재시도 로직', async () => {
      // Given - 의도적으로 실패하는 상황 생성
      const invalidProductId = -1;
      const quantity = 1;

      // 실패 메시지 리스너 설정
      let failedMessageReceived = false;

      // Consumer Mock (실패 상황 테스트용)
      await amqpConnection.channel.consume('stock-failed-queue', (msg) => {
        if (msg) {
          const failedMessage = JSON.parse(msg.content.toString());
          if (failedMessage.productId === invalidProductId) {
            failedMessageReceived = true;
          }
          amqpConnection.channel.ack(msg);
        }
      });

      // When
      const response = await request(app.getHttpServer())
        .post('/inventory/reduce-stock-async')
        .send({ productId: invalidProductId, quantity })
        .expect(201);

      // Then
      expect(response.body.success).toBe(false);

      // DLQ 메시지 확인 (재시도 후 최종 실패)
      await new Promise(resolve => setTimeout(resolve, 10000)); // 재시도 대기
      expect(failedMessageReceived).toBe(true);
    });
  });
});
```

### 단위 테스트
```typescript
// test/inventory.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { InventoryService } from '../src/inventory/inventory.service';
import { InventoryRepository } from '../src/database/inventory.repository';

describe('InventoryService', () => {
  let service: InventoryService;
  let amqpConnection: AmqpConnection;
  let repository: InventoryRepository;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: AmqpConnection,
          useValue: {
            publish: jest.fn(),
          },
        },
        {
          provide: InventoryRepository,
          useValue: {
            findInventoryById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
    amqpConnection = module.get<AmqpConnection>(AmqpConnection);
    repository = module.get<InventoryRepository>(InventoryRepository);
  });

  describe('reduceStockAsync', () => {
    it('정상적인 메시지 발송', async () => {
      // Given
      const product = { id: 1, stock: 10 };
      jest.spyOn(repository, 'findInventoryById').mockResolvedValue(product);
      jest.spyOn(amqpConnection, 'publish').mockResolvedValue(undefined);

      // When
      const result = await service.reduceStockAsync(1, 5, 'order-1', 'customer-1');

      // Then
      expect(result.success).toBe(true);
      expect(result.jobId).toBeDefined();
      expect(amqpConnection.publish).toHaveBeenCalledWith(
        'inventory-exchange',
        'stock.reduce',
        expect.objectContaining({
          productId: 1,
          quantity: 5,
          orderId: 'order-1',
          customerId: 'customer-1',
        }),
        expect.any(Object)
      );
    });

    it('재고 부족 시 예외 발생', async () => {
      // Given
      const product = { id: 1, stock: 2 };
      jest.spyOn(repository, 'findInventoryById').mockResolvedValue(product);

      // When & Then
      await expect(
        service.reduceStockAsync(1, 5, 'order-1', 'customer-1')
      ).rejects.toThrow('재고 부족');

      expect(amqpConnection.publish).not.toHaveBeenCalled();
    });
  });
});
```

### 성능 테스트
```typescript
// test/performance.spec.ts
import { Test } from '@nestjs/testing';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { AppModule } from '../src/app.module';

describe('Performance Test', () => {
  let amqpConnection: AmqpConnection;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    amqpConnection = module.get<AmqpConnection>(AmqpConnection);
  });

  it('메시지 처리 성능 테스트', async () => {
    const messageCount = 1000;
    const startTime = Date.now();

    // 메시지 발송
    const promises = Array.from({ length: messageCount }, (_, i) =>
      amqpConnection.publish(
        'inventory-exchange',
        'stock.reduce',
        {
          productId: 1,
          quantity: 1,
          orderId: `perf-test-${i}`,
          correlationId: `perf-${i}`,
        }
      )
    );

    await Promise.all(promises);

    const publishTime = Date.now() - startTime;
    const publishRate = messageCount / (publishTime / 1000);

    console.log(`발송 성능: ${publishRate.toFixed(2)} msg/sec`);
    console.log(`발송 시간: ${publishTime}ms`);

    expect(publishRate).toBeGreaterThan(100); // 초당 100개 이상
  });
});
```

---

## 12. 핵심 포인트 요약

### 🎯 필수 구성 요소

**패키지 설치**:
```bash
npm install @golevelup/nestjs-rabbitmq amqplib
npm install -D @types/amqplib
```

**핵심 데코레이터**:
- `@RabbitSubscribe`: Consumer 정의
- `@RabbitPayload`: 메시지 내용 추출
- `@RabbitContext`: 메타데이터 및 채널 접근

**필수 설정**:
- `prefetchCount: 1`: 순차 처리 보장
- `noAck: false`: 수동 ACK 모드
- `durable: true`: 영속성 보장

### 🚀 Producer 패턴

```typescript
// 메시지 발송
await this.amqpConnection.publish(
  'exchange-name',     // Exchange
  'routing.key',       // Routing Key
  messageData,         // 메시지 내용
  {
    priority: 5,       // 우선순위 (0-10)
    persistent: true,  // 영속성
    correlationId,     // 추적 ID
  }
);
```

### 🎯 Consumer 패턴

```typescript
@RabbitSubscribe({
  exchange: 'inventory-exchange',
  routingKey: 'stock.reduce',
  queue: 'stock-reduce-queue',
  prefetchCount: 1,
  noAck: false,
})
async handleMessage(
  @RabbitPayload() message: MessageDto,
  @RabbitContext() context: any
) {
  try {
    // 비즈니스 로직 처리
    await this.processMessage(message);

    // 성공 시 ACK
    context.channel.ack(context.message);

  } catch (error) {
    // 실패 시 NACK (재시도)
    context.channel.nack(context.message, false, true);
  }
}
```

### 🔧 성능 최적화

**Queue 설정**:
- `x-max-priority`: 우선순위 지원
- `x-message-ttl`: 메시지 TTL
- `x-dead-letter-exchange`: 실패 처리

**Consumer 튜닝**:
- `prefetchCount`: 동시 처리 메시지 수
- `consumerOptions.priority`: Consumer 우선순위
- 채널별 설정 분리

### 🚨 에러 처리

**재시도 전략**:
1. 지수 백오프 (1초, 2초, 4초)
2. 최대 재시도 횟수 제한
3. Dead Letter Queue 활용

**모니터링**:
- 메시지 처리 속도
- 큐 길이 추적
- 실패율 모니터링

### 🎯 실제 적용 시 고려사항

1. **메시지 중복 처리 방지** (Idempotency)
2. **순차 처리 보장** (prefetchCount: 1)
3. **장애 복구 전략** (DLQ, 재시도)
4. **성능 모니터링** (큐 상태, 처리 속도)
5. **보안 설정** (인증, 권한 관리)
