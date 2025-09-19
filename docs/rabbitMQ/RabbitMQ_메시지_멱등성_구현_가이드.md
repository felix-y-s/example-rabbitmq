# RabbitMQ 메시지 멱등성(Idempotency) 구현 가이드

메시지 큐 시스템에서 동일한 메시지가 여러 번 처리되는 것을 방지하기 위한 `correlationId` 기반 중복 처리 방지 메커니즘 구현 가이드입니다.

## 📋 목차
1. [개념 및 필요성](#개념-및-필요성)
2. [데이터베이스 방식 구현](#데이터베이스-방식-구현)
3. [Redis 방식 구현](#redis-방식-구현)
4. [하이브리드 방식 구현](#하이브리드-방식-구현)
5. [Consumer 적용 예제](#consumer-적용-예제)
6. [성능 최적화 팁](#성능-최적화-팁)

---

## 개념 및 필요성

### 멱등성(Idempotency)이란?
동일한 요청을 여러 번 수행해도 결과가 동일하게 유지되는 특성입니다.

### 왜 필요한가?
- **네트워크 장애**: 메시지 전송 중 네트워크 문제로 중복 전송
- **Consumer 재시작**: 처리 중이던 메시지가 다시 큐로 돌아감
- **재시도 메커니즘**: 실패한 메시지의 자동 재시도
- **분산 시스템**: 여러 Consumer가 동일 메시지를 받을 가능성

### CorrelationId 기반 해결책
각 메시지에 고유한 `correlationId`를 부여하고, 처리 상태를 추적하여 중복 처리를 방지합니다.

---

## 데이터베이스 방식 구현

### 1. Prisma 스키마 정의

```prisma
// prisma/schema.prisma
model MessageProcessingLog {
  id            String   @id @default(cuid())
  correlationId String   @unique  // 중복 방지를 위한 고유 키
  messageType   String   // 메시지 타입 (stock.reduce, stock.reserve 등)
  status        String   // PROCESSING, COMPLETED, FAILED
  productId     Int?     // 관련 상품 ID (선택적)
  orderId       String?  // 관련 주문 ID (선택적)
  result        Json?    // 처리 결과 (JSON)
  error         String?  // 에러 메시지 (실패 시)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  completedAt   DateTime? // 완료 시간

  @@map("message_processing_logs")
}
```

### 2. Repository 구현 (3가지 상태 지원)

```typescript
// src/database/message-processing.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export enum ProcessingStatus {
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',  
  FAILED = 'FAILED'
}

@Injectable()
export class MessageProcessingRepository {
  private readonly logger = new Logger(MessageProcessingRepository.name);
  
  constructor(private prisma: PrismaService) {}

  /**
   * 메시지 상태 확인 (완료/처리중/실패 모두 체크)
   */
  async getMessageStatus(correlationId: string): Promise<{
    status: ProcessingStatus | null;
    data?: any;
    createdAt?: Date;
    updatedAt?: Date;
  }> {
    const log = await this.prisma.messageProcessingLog.findUnique({
      where: { correlationId },
      select: {
        status: true,
        result: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!log) return { status: null };

    return {
      status: log.status as ProcessingStatus,
      data: log.result || log.error,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
    };
  }

  /**
   * 메시지가 이미 처리되었는지 확인 (완료 상태만)
   */
  async isAlreadyProcessed(correlationId: string): Promise<boolean> {
    const status = await this.getMessageStatus(correlationId);
    return status.status === ProcessingStatus.COMPLETED;
  }

  /**
   * 원자적 처리 시작 (DB 락 획득)
   */
  async tryMarkAsProcessing(
    correlationId: string,
    messageType: string,
    metadata?: {
      productId?: number;
      orderId?: string;
      customerId?: string;
    }
  ): Promise<boolean> {
    try {
      // Upsert with 조건부 업데이트
      const result = await this.prisma.messageProcessingLog.upsert({
        where: { correlationId },
        create: {
          correlationId,
          messageType,
          status: ProcessingStatus.PROCESSING,
          productId: metadata?.productId,
          orderId: metadata?.orderId,
          result: {
            processId: process.pid,
            hostname: require('os').hostname(),
            startTime: new Date().toISOString(),
            metadata,
          },
        },
        update: {
          // 이미 완료되었거나 최근에 처리 중이면 업데이트 안함
          status: ProcessingStatus.PROCESSING,
          updatedAt: new Date(),
          result: {
            processId: process.pid,
            hostname: require('os').hostname(),
            startTime: new Date().toISOString(),
            metadata,
          },
        },
        select: { status: true, createdAt: true },
      });

      // 이미 완료된 메시지면 실패 처리
      if (result.status === ProcessingStatus.COMPLETED) {
        return false;
      }

      return true;
    } catch (error) {
      // Unique constraint 위반 등의 경우
      this.logger.error('DB 처리 시작 마킹 실패:', error);
      return false;
    }
  }

  /**
   * 더 안전한 조건부 업데이트 (Raw SQL 사용)
   */
  async tryMarkAsProcessingWithCondition(
    correlationId: string,
    messageType: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      // 처리되지 않았거나 타임아웃된 경우만 업데이트
      const timeoutMinutes = 5;
      const result = await this.prisma.$executeRaw`
        INSERT INTO message_processing_logs (
          correlation_id, message_type, status, product_id, order_id, result, created_at, updated_at
        )
        VALUES (
          ${correlationId}, ${messageType}, ${ProcessingStatus.PROCESSING}, 
          ${metadata?.productId}, ${metadata?.orderId}, 
          ${JSON.stringify({
            processId: process.pid,
            hostname: require('os').hostname(),
            startTime: new Date().toISOString(),
            metadata,
          })},
          NOW(), NOW()
        )
        ON CONFLICT (correlation_id) DO UPDATE SET
          status = ${ProcessingStatus.PROCESSING},
          updated_at = NOW(),
          result = ${JSON.stringify({
            processId: process.pid,
            hostname: require('os').hostname(),
            startTime: new Date().toISOString(),
            metadata,
          })}
        WHERE 
          message_processing_logs.status != ${ProcessingStatus.COMPLETED}
          AND (
            message_processing_logs.status != ${ProcessingStatus.PROCESSING}
            OR message_processing_logs.updated_at < NOW() - INTERVAL '${timeoutMinutes} minutes'
          )
      `;

      return result > 0; // 업데이트된 행이 있으면 성공
    } catch (error) {
      this.logger.error('조건부 처리 시작 마킹 실패:', error);
      return false;
    }
  }

  /**
   * 기존 방식 호환성 유지
   */
  async markAsProcessing(
    correlationId: string,
    messageType: string,
    metadata?: {
      productId?: number;
      orderId?: string;
      customerId?: string;
    }
  ): Promise<void> {
    await this.tryMarkAsProcessing(correlationId, messageType, metadata);
  }

  /**
   * 메시지 처리 완료 마킹
   */
  async markAsCompleted(
    correlationId: string,
    result: any
  ): Promise<void> {
    await this.prisma.messageProcessingLog.update({
      where: { correlationId },
      data: {
        status: ProcessingStatus.COMPLETED,
        result,
        completedAt: new Date(),
      },
    });
  }

  /**
   * 메시지 처리 실패 마킹
   */
  async markAsFailed(
    correlationId: string,
    error: string
  ): Promise<void> {
    await this.prisma.messageProcessingLog.update({
      where: { correlationId },
      data: {
        status: ProcessingStatus.FAILED,
        error,
      },
    });
  }

  /**
   * 타임아웃된 처리 중 상태 정리
   */
  async cleanupTimedOutProcessing(timeoutMinutes: number = 10): Promise<number> {
    const result = await this.prisma.messageProcessingLog.updateMany({
      where: {
        status: ProcessingStatus.PROCESSING,
        updatedAt: {
          lt: new Date(Date.now() - timeoutMinutes * 60 * 1000),
        },
      },
      data: {
        status: ProcessingStatus.FAILED,
        error: `처리 타임아웃 (${timeoutMinutes}분)`,
      },
    });

    return result.count;
  }

  /**
   * 처리 상태 조회
   */
  async getProcessingStatus(correlationId: string): Promise<{
    status: string;
    result?: any;
    error?: string;
    createdAt: Date;
    completedAt?: Date;
  } | null> {
    return await this.prisma.messageProcessingLog.findUnique({
      where: { correlationId },
      select: {
        status: true,
        result: true,
        error: true,
        createdAt: true,
        completedAt: true,
      },
    });
  }

  /**
   * 오래된 로그 정리 (배치 작업용)
   */
  async cleanupOldLogs(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.prisma.messageProcessingLog.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
        status: 'COMPLETED',
      },
    });

    return result.count;
  }
}
```

### 3. 모듈 등록

```typescript
// src/database/database.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MessageProcessingRepository } from './message-processing.repository';

@Module({
  providers: [
    PrismaService,
    MessageProcessingRepository,
  ],
  exports: [
    PrismaService,
    MessageProcessingRepository,
  ],
})
export class DatabaseModule {}
```

---

## Redis 방식 구현 (3가지 상태 지원)

고성능이 필요한 경우 Redis를 사용하며, 완료/처리중/실패 상태를 모두 관리합니다.

### 1. Idempotency Service 구현 (개선된 버전)

```typescript
// src/common/services/idempotency.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly redis: Redis) {}

  /**
   * 완전한 상태 확인 (완료/처리중/실패 모두 체크)
   */
  async isAlreadyProcessed(correlationId: string): Promise<boolean> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.get(`completed:${correlationId}`);   // 완료 상태
      pipeline.get(`processing:${correlationId}`);  // 처리 중 락
      pipeline.get(`failed:${correlationId}`);      // 실패 상태
      
      const results = await pipeline.exec();
      
      // 1. 이미 완료된 경우
      if (results[0][1]) {
        this.logger.debug(`[${correlationId}] 이미 완료된 메시지`);
        return true;
      }
      
      // 2. 처리 중인 경우 (락이 있는 경우)
      if (results[1][1]) {
        const processingData = JSON.parse(results[1][1]);
        const startTime = new Date(processingData.startTime);
        const timeoutMs = 5 * 60 * 1000; // 5분 타임아웃
        
        if (Date.now() - startTime.getTime() < timeoutMs) {
          this.logger.warn(`[${correlationId}] 다른 프로세스에서 처리 중`);
          return true; // 중복 실행 방지
        } else {
          // 타임아웃된 처리 락 정리
          this.logger.warn(`[${correlationId}] 처리 타임아웃, 락 해제`);
          await this.redis.del(`processing:${correlationId}`);
        }
      }
      
      // 3. 최근에 실패한 경우 (재시도 간격 확인)
      if (results[2][1]) {
        const failedData = JSON.parse(results[2][1]);
        const failedTime = new Date(failedData.failedAt);
        const retryIntervalMs = 60 * 1000; // 1분 재시도 간격
        
        if (Date.now() - failedTime.getTime() < retryIntervalMs) {
          this.logger.debug(`[${correlationId}] 재시도 간격 대기 중`);
          return true; // 너무 빠른 재시도 방지
        }
      }
      
      return false; // 처리 가능
    } catch (error) {
      this.logger.error('처리 상태 확인 실패:', error);
      return false;
    }
  }

  /**
   * 원자적 처리 시작 (SET NX로 락 획득)
   */
  async tryAcquireProcessingLock(
    correlationId: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      // SET NX로 원자적 락 획득
      const lockData = JSON.stringify({
        status: 'PROCESSING',
        startTime: new Date().toISOString(),
        processId: process.pid,
        hostname: require('os').hostname(),
        metadata: metadata || {},
      });
      
      const result = await this.redis.set(
        `processing:${correlationId}`,
        lockData,
        'EX', 300, // 5분 TTL
        'NX'       // 키가 없을 때만 설정
      );
      
      return result === 'OK';
    } catch (error) {
      this.logger.error('처리 락 획득 실패:', error);
      return false;
    }
  }

  /**
   * 처리 완료 마킹 (락 해제 + 완료 상태 저장)
   */
  async markAsCompleted(correlationId: string, result: any): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      // 완료 상태 저장 (24시간 TTL)
      pipeline.setex(
        `completed:${correlationId}`,
        86400,
        JSON.stringify({
          status: 'COMPLETED',
          result,
          completedAt: new Date().toISOString(),
        })
      );
      
      // 처리 락 해제
      pipeline.del(`processing:${correlationId}`);
      
      // 실패 상태 정리 (재시도에서 성공한 경우)
      pipeline.del(`failed:${correlationId}`);
      
      await pipeline.exec();
      
      this.logger.debug(`[${correlationId}] 처리 완료 마킹`);
    } catch (error) {
      this.logger.error('처리 완료 마킹 실패:', error);
      throw error;
    }
  }

  /**
   * 처리 실패 마킹 (락 해제 + 실패 상태 저장)
   */
  async markAsFailed(correlationId: string, error: string): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      // 실패 상태 저장 (1시간 TTL - 재시도 간격 제어용)
      pipeline.setex(
        `failed:${correlationId}`,
        3600,
        JSON.stringify({
          status: 'FAILED',
          error,
          failedAt: new Date().toISOString(),
        })
      );
      
      // 처리 락 해제
      pipeline.del(`processing:${correlationId}`);
      
      await pipeline.exec();
      
      this.logger.debug(`[${correlationId}] 처리 실패 마킹`);
    } catch (error) {
      this.logger.error('처리 실패 마킹 실패:', error);
    }
  }

  /**
   * 락 해제 (에러 상황에서 사용)
   */
  async releaseLock(correlationId: string): Promise<void> {
    try {
      await this.redis.del(`processing:${correlationId}`);
      this.logger.debug(`[${correlationId}] 처리 락 해제`);
    } catch (error) {
      this.logger.error(`[${correlationId}] 락 해제 실패:`, error);
    }
  }

  /**
   * 처리 상태 조회
   */
  async getProcessingStatus(correlationId: string): Promise<{
    status: string;
    data?: any;
  } | null> {
    try {
      const pipeline = this.redis.pipeline();
      pipeline.get(`processed:${correlationId}`);
      pipeline.get(`processing:${correlationId}`);
      pipeline.get(`failed:${correlationId}`);
      pipeline.get(`result:${correlationId}`);
      
      const results = await pipeline.exec();
      
      if (results[0][1] === 'COMPLETED') {
        const resultData = results[3][1] ? JSON.parse(results[3][1]) : null;
        return { status: 'COMPLETED', data: resultData };
      }
      
      if (results[1][1]) {
        const processingData = JSON.parse(results[1][1]);
        return { status: 'PROCESSING', data: processingData };
      }
      
      if (results[2][1]) {
        const failedData = JSON.parse(results[2][1]);
        return { status: 'FAILED', data: failedData };
      }
      
      return null;
    } catch (error) {
      this.logger.error('Redis 상태 조회 실패:', error);
      return null;
    }
  }

  /**
   * 처리 타임아웃 체크 및 정리
   */
  async cleanupStaleProcessing(timeoutMinutes: number = 60): Promise<number> {
    try {
      const pattern = 'processing:*';
      const keys = await this.redis.keys(pattern);
      
      let cleanedCount = 0;
      const cutoffTime = new Date(Date.now() - timeoutMinutes * 60 * 1000);
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          const startTime = new Date(parsed.startTime);
          
          if (startTime < cutoffTime) {
            await this.redis.del(key);
            cleanedCount++;
          }
        }
      }
      
      this.logger.log(`정리된 오래된 처리 중 상태: ${cleanedCount}개`);
      return cleanedCount;
    } catch (error) {
      this.logger.error('처리 중 상태 정리 실패:', error);
      return 0;
    }
  }
}
```

---

## 하이브리드 방식 구현 (이중 락 시스템)

실제 운영 환경에서는 Redis와 Database를 함께 사용하여 **이중 락 시스템**을 구현합니다.

### 1. 통합 Idempotency Service (완전한 버전)

```typescript
// src/common/services/hybrid-idempotency.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { MessageProcessingRepository, ProcessingStatus } from '../../database/message-processing.repository';

@Injectable()
export class HybridIdempotencyService {
  private readonly logger = new Logger(HybridIdempotencyService.name);

  constructor(
    private readonly redisIdempotency: IdempotencyService,
    private readonly dbRepository: MessageProcessingRepository,
  ) {}

  /**
   * 완전한 상태 확인 (Redis → DB 순서)
   */
  async isAlreadyProcessed(correlationId: string): Promise<boolean> {
    try {
      // 1단계: Redis에서 빠른 체크
      const redisProcessed = await this.redisIdempotency.isAlreadyProcessed(correlationId);
      if (redisProcessed) {
        this.logger.debug(`[${correlationId}] Redis에서 처리 불가 상태 확인`);
        return true;
      }

      // 2단계: DB에서 확실한 체크
      const dbStatus = await this.dbRepository.getMessageStatus(correlationId);
      if (dbStatus.status === ProcessingStatus.COMPLETED) {
        this.logger.debug(`[${correlationId}] DB에서 완료 상태 확인, Redis 캐시 갱신`);
        
        // Redis 캐시 갱신
        await this.redisIdempotency.markAsCompleted(correlationId, dbStatus.data);
        return true;
      }

      if (dbStatus.status === ProcessingStatus.PROCESSING) {
        // DB에서 처리 중인 경우 타임아웃 체크
        const processingTime = Date.now() - dbStatus.updatedAt.getTime();
        const timeoutMs = 5 * 60 * 1000; // 5분

        if (processingTime < timeoutMs) {
          this.logger.warn(`[${correlationId}] DB에서 처리 중 상태 확인`);
          // Redis에도 처리 중 상태 동기화
          await this.redisIdempotency.tryAcquireProcessingLock(correlationId);
          return true;
        } else {
          this.logger.warn(`[${correlationId}] DB 처리 타임아웃, 상태 정리`);
          // 타임아웃된 상태 정리
          await this.dbRepository.markAsFailed(correlationId, '처리 타임아웃');
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`[${correlationId}] 상태 확인 실패:`, error);
      return false; // 안전을 위해 처리 허용
    }
  }

  /**
   * 원자적 처리 시작 (Redis + DB 이중 락)
   */
  async tryAcquireProcessingLock(
    correlationId: string,
    messageType: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      // 1단계: Redis 락 획득 (빠른 중복 방지)
      const redisLockAcquired = await this.redisIdempotency.tryAcquireProcessingLock(
        correlationId,
        metadata
      );

      if (!redisLockAcquired) {
        this.logger.debug(`[${correlationId}] Redis 락 획득 실패`);
        return false;
      }

      // 2단계: DB 락 획득 (영속적 상태 관리)
      const dbLockAcquired = await this.dbRepository.tryMarkAsProcessingWithCondition(
        correlationId,
        messageType,
        metadata
      );

      if (!dbLockAcquired) {
        this.logger.debug(`[${correlationId}] DB 락 획득 실패, Redis 락 해제`);
        // DB 락 실패 시 Redis 락 해제
        await this.redisIdempotency.releaseLock(correlationId);
        return false;
      }

      this.logger.debug(`[${correlationId}] 이중 락 획득 성공 (Redis + DB)`);
      return true;

    } catch (error) {
      this.logger.error(`[${correlationId}] 락 획득 실패:`, error);
      
      // 에러 시 Redis 락 해제
      try {
        await this.redisIdempotency.releaseLock(correlationId);
      } catch (cleanupError) {
        this.logger.error(`[${correlationId}] 락 정리 실패:`, cleanupError);
      }
      
      return false;
    }
  }

  /**
   * 기존 방식 호환성 유지
   */
  async markAsProcessing(
    correlationId: string,
    messageType: string,
    metadata?: any
  ): Promise<void> {
    const success = await this.tryAcquireProcessingLock(correlationId, messageType, metadata);
    if (!success) {
      throw new Error(`처리 시작 마킹 실패: ${correlationId}`);
    }
  }

  /**
   * 처리 완료 (Redis + DB 동시 업데이트)
   */
  async markAsCompleted(correlationId: string, result: any): Promise<void> {
    try {
      // 병렬로 Redis와 DB 업데이트
      await Promise.all([
        this.redisIdempotency.markAsCompleted(correlationId, result),
        this.dbRepository.markAsCompleted(correlationId, result),
      ]);

      this.logger.debug(`[${correlationId}] 처리 완료 마킹 (Redis + DB)`);
    } catch (error) {
      this.logger.error(`[${correlationId}] 처리 완료 마킹 실패:`, error);
      throw error;
    }
  }

  /**
   * 처리 실패 (Redis + DB 동시 업데이트)
   */
  async markAsFailed(correlationId: string, error: string): Promise<void> {
    try {
      // 병렬로 Redis와 DB 업데이트
      await Promise.all([
        this.redisIdempotency.markAsFailed(correlationId, error),
        this.dbRepository.markAsFailed(correlationId, error),
      ]);

      this.logger.debug(`[${correlationId}] 처리 실패 마킹 (Redis + DB)`);
    } catch (markError) {
      this.logger.error(`[${correlationId}] 처리 실패 마킹 실패:`, markError);
    }
  }

  /**
   * 처리 상태 조회 (Redis 우선, 없으면 DB)
   */
  async getProcessingStatus(correlationId: string): Promise<any> {
    try {
      // Redis에서 먼저 조회
      const redisStatus = await this.redisIdempotency.getProcessingStatus(correlationId);
      if (redisStatus) {
        return redisStatus;
      }

      // Redis에 없으면 DB에서 조회
      const dbStatus = await this.dbRepository.getProcessingStatus(correlationId);
      return dbStatus;
    } catch (error) {
      this.logger.error(`[${correlationId}] 상태 조회 실패:`, error);
      return null;
    }
  }

  /**
   * 처리 상태 조회 (Redis 우선, 없으면 DB)
   */
  async getProcessingStatus(correlationId: string): Promise<any> {
    try {
      // Redis에서 먼저 조회
      const redisStatus = await this.redisIdempotency.getProcessingStatus(correlationId);
      if (redisStatus) {
        return redisStatus;
      }

      // Redis에 없으면 DB에서 조회
      const dbStatus = await this.dbRepository.getProcessingStatus(correlationId);
      return dbStatus;
    } catch (error) {
      this.logger.error(`[${correlationId}] 상태 조회 실패:`, error);
      return null;
    }
  }
}
```

---

## Consumer 적용 예제

### 1. 하이브리드 Consumer 패턴 (완전한 버전)

```typescript
// src/inventory/inventory.consumer.ts
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, RabbitPayload, MessageHandlerErrorBehavior, Nack } from '@golevelup/nestjs-rabbitmq';
import { ConsumeMessage } from 'amqplib';
import { HybridIdempotencyService } from '../common/services/hybrid-idempotency.service';
import { InventoryService } from './inventory.service';
import { StockReductionMessage } from './dto/stock-message.dto';

@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly hybridIdempotencyService: HybridIdempotencyService,
  ) {}

  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.reduce',
    queue: 'stock-reduce-queue',
    prefetchCount: 1,
    errorBehavior: MessageHandlerErrorBehavior.NACK,
  })
  async handleStockReduction(
    @RabbitPayload() message: StockReductionMessage,
    amqpMsg: ConsumeMessage
  ) {
    const { correlationId, productId, quantity } = message;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] 재고 감소 처리 시작 - 상품: ${productId}, 수량: ${quantity}`);

    try {
      // 1. 통합 상태 확인 (Redis + DB)
      if (await this.hybridIdempotencyService.isAlreadyProcessed(correlationId)) {
        this.logger.warn(`[${correlationId}] 처리 불가 (완료/처리중/대기중)`);
        return; // 자동 ACK
      }

      // 2. 이중 락 획득 (Redis + DB)
      const lockAcquired = await this.hybridIdempotencyService.tryAcquireProcessingLock(
        correlationId,
        'stock.reduce',
        {
          productId: message.productId,
          orderId: message.orderId,
          customerId: message.customerId,
          attempt: message.retryCount || 0,
        }
      );

      if (!lockAcquired) {
        this.logger.warn(`[${correlationId}] 이중 락 획득 실패`);
        return; // 자동 ACK
      }

      this.logger.log(`[${correlationId}] 처리 시작 - 이중 락 획득 성공`);

      // 3. 비즈니스 로직 처리
      const result = await this.inventoryService.reduceStockRedisLock(
        message.productId,
        message.quantity,
        {
          maxRetries: 3,
          lockTtl: 5000,
          retryDelay: 100,
        }
      );

      if (!result.success) {
        throw new Error(result.message);
      }

      // 4. 처리 완료 (Redis + DB 동시 업데이트)
      await this.hybridIdempotencyService.markAsCompleted(correlationId, {
        success: true,
        finalStock: result.finalStock,
        processingTime: Date.now() - startTime,
        completedAt: new Date().toISOString(),
      });

      this.logger.log(`[${correlationId}] 재고 감소 성공 (이중 저장 완료) - ${Date.now() - startTime}ms`);

      // 5. 성공 이벤트 발행 (필요시)
      await this.publishSuccessEvent(message, result);

      // 성공 시 자동 ACK
      return;

    } catch (error) {
      this.logger.error(`[${correlationId}] 재고 감소 실패:`, error.message);

      // 처리 실패 (Redis + DB 동시 업데이트)
      await this.hybridIdempotencyService.markAsFailed(correlationId, error.message);

      // 재시도 여부 결정
      const retryCount = message.retryCount || 0;
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        this.logger.log(`[${correlationId}] 재시도 예정: ${retryCount + 1}/${maxRetries}`);
        
        // 재시도 메시지 발송
        setTimeout(async () => {
          await this.republishMessage(message);
        }, Math.pow(2, retryCount) * 1000); // 지수 백오프

        return; // 현재 메시지는 ACK
      } else {
        this.logger.error(`[${correlationId}] 최대 재시도 초과, DLQ로 이동`);
        return new Nack(); // DLQ로 이동
      }
    }
  }

  /**
   * 처리 성공 이벤트 발행
   */
  private async publishSuccessEvent(message: StockReductionMessage, result: any): Promise<void> {
    // 구현 생략 - 다른 서비스에 알림
  }

  /**
   * 재시도 메시지 발송
   */
  private async republishMessage(message: StockReductionMessage): Promise<void> {
    // 구현 생략 - 재시도 로직
  }
}
```

### 2. 트랜잭션과 하이브리드 멱등성 함께 사용

```typescript
// 트랜잭션 내에서 하이브리드 멱등성 보장
async handleStockReductionWithTransaction(
  message: StockReductionMessage
): Promise<void> {
  const { correlationId } = message;

  try {
    // 1. 사전 체크 (트랜잭션 외부에서)
    if (await this.hybridIdempotencyService.isAlreadyProcessed(correlationId)) {
      this.logger.warn(`[${correlationId}] 이미 처리된 메시지`);
      return;
    }

    // 2. 이중 락 획득 시도
    const lockAcquired = await this.hybridIdempotencyService.tryAcquireProcessingLock(
      correlationId,
      'stock.reduce',
      { productId: message.productId }
    );

    if (!lockAcquired) {
      this.logger.warn(`[${correlationId}] 락 획득 실패`);
      return;
    }

    // 3. 트랜잭션 실행 (DB 부분만)
    await this.prisma.$transaction(async (tx) => {
      // 재고 감소 처리
      const inventory = await tx.inventory.update({
        where: { productId: message.productId },
        data: { stock: { decrement: message.quantity } },
      });

      // DB 상태만 업데이트 (Redis는 별도)
      await tx.messageProcessingLog.update({
        where: { correlationId },
        data: {
          status: ProcessingStatus.COMPLETED,
          result: { finalStock: inventory.stock },
          completedAt: new Date(),
        },
      });

      // 트랜잭션 성공 후 Redis 동기화
      await this.redisIdempotency.markAsCompleted(correlationId, {
        finalStock: inventory.stock
      });
    });

    this.logger.log(`[${correlationId}] 트랜잭션 + 멱등성 처리 완료`);

  } catch (error) {
    this.logger.error(`[${correlationId}] 트랜잭션 처리 실패:`, error);
    
    // 실패 시 상태 정리
    await this.hybridIdempotencyService.markAsFailed(correlationId, error.message);
    throw error;
  }
}
```

---

## 성능 최적화 팁

### 1. Redis 연결 풀 최적화

```typescript
// Redis 연결 설정
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  lazyConnect: true,
  // 연결 풀 설정
  family: 4,
  keepAlive: 30000,
  // 명령어 큐 설정
  maxMemoryPolicy: 'allkeys-lru',
});
```

### 2. DB 인덱스 최적화

```sql
-- correlationId에 고유 인덱스
CREATE UNIQUE INDEX idx_message_processing_correlation_id 
ON message_processing_logs(correlation_id);

-- 상태별 조회 최적화
CREATE INDEX idx_message_processing_status_created 
ON message_processing_logs(status, created_at);

-- 정리 작업용 인덱스
CREATE INDEX idx_message_processing_cleanup 
ON message_processing_logs(created_at, status)
WHERE status = 'COMPLETED';
```

### 3. 배치 정리 작업

```typescript
// src/tasks/cleanup.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MessageProcessingRepository } from '../database/message-processing.repository';
import { IdempotencyService } from '../common/services/idempotency.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly messageRepo: MessageProcessingRepository,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  // 매일 새벽 2시에 실행
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldLogs(): Promise<void> {
    this.logger.log('오래된 처리 로그 정리 시작');

    try {
      // 30일 이상 된 완료 로그 삭제
      const dbCleanedCount = await this.messageRepo.cleanupOldLogs(30);
      
      // Redis 타임아웃된 처리 중 상태 정리
      const redisCleanedCount = await this.idempotencyService.cleanupStaleProcessing(60);

      this.logger.log(
        `정리 완료 - DB: ${dbCleanedCount}개, Redis: ${redisCleanedCount}개`
      );
    } catch (error) {
      this.logger.error('정리 작업 실패:', error);
    }
  }
}
```

### 4. 모니터링 및 알림

```typescript
// src/monitoring/idempotency-monitor.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { MessageProcessingRepository } from '../database/message-processing.repository';

@Injectable()
export class IdempotencyMonitorService {
  private readonly logger = new Logger(IdempotencyMonitorService.name);

  constructor(
    private readonly messageRepo: MessageProcessingRepository,
  ) {}

  /**
   * 처리 중인 메시지 모니터링
   */
  async getProcessingMetrics(): Promise<{
    processingCount: number;
    avgProcessingTime: number;
    failureRate: number;
  }> {
    // 구현 생략 - 메트릭 수집 로직
    return {
      processingCount: 0,
      avgProcessingTime: 0,
      failureRate: 0,
    };
  }

  /**
   * 장기간 처리 중인 메시지 알림
   */
  async alertStuckMessages(): Promise<void> {
    // 1시간 이상 처리 중인 메시지 조회
    const stuckMessages = await this.prisma.messageProcessingLog.findMany({
      where: {
        status: 'PROCESSING',
        createdAt: {
          lt: new Date(Date.now() - 60 * 60 * 1000), // 1시간 전
        },
      },
    });

    if (stuckMessages.length > 0) {
      this.logger.warn(`장기간 처리 중인 메시지 발견: ${stuckMessages.length}개`);
      // 알림 로직 (Slack, 이메일 등)
    }
  }
}
```

---

## 결론

멱등성 구현을 통해 다음과 같은 이점을 얻을 수 있습니다:

### ✅ 장점
- **데이터 일관성**: 중복 처리로 인한 데이터 불일치 방지
- **시스템 안정성**: 네트워크 장애나 재시작 상황에서도 안전
- **운영 편의성**: 처리 상태 추적 및 모니터링 가능
- **디버깅 지원**: 메시지 처리 이력을 통한 문제 분석

### ⚠️ 주의사항
- **성능 오버헤드**: 매 메시지마다 상태 확인 및 저장
- **저장소 관리**: 로그 데이터의 증가로 인한 용량 관리 필요
- **복잡성 증가**: 에러 처리 및 예외 상황 고려 필요

### 🎯 권장사항
1. **하이브리드 방식** 사용 (Redis + Database)
2. **적절한 TTL** 설정으로 저장소 관리
3. **모니터링 및 알림** 시스템 구축
4. **정기적인 정리 작업** 스케줄링
5. **성능 테스트**를 통한 최적화

이런 방식으로 구현하면 안정적이고 확장 가능한 메시지 처리 시스템을 구축할 수 있습니다.