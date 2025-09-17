import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { InventoryRepository } from '../database/inventory.repository';
import { RedisService } from '@liaoliaots/nestjs-redis';
import Redis from 'ioredis';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private lockRedis: Redis;

  constructor(
    private readonly inventoryRepository: InventoryRepository,
    private readonly redisService: RedisService,
  ) {
    // 분산락 전용 Redis 클라이언트 초기화
    this.lockRedis = this.redisService.getOrThrow('lock');

    // Redis 명령어 로깅 설정 (개발 환경에서만, 명시적 활성화 필요)
    if (process.env.NODE_ENV === 'development' && process.env.REDIS_LOGGING === 'true') {
      this.setupRedisLogging();
    }
  }

  // Redis 명령어 로깅 설정 (성능 최적화 적용)
  private setupRedisLogging() {
    // 연결 상태만 로깅 (부하 최소화)
    this.lockRedis.on('connect', () => {
      this.logger.log('🔗 Redis 분산락 클라이언트 연결됨');
    });

    // 특정 명령어만 로깅 (전체 명령어 로깅은 부하 위험)
    const originalSendCommand = this.lockRedis.sendCommand;
    this.lockRedis.sendCommand = function(command) {
      const commandName = command.name.toUpperCase();
      const args = command.args || [];

      // 분산락 관련 명령어만 로깅 (성능 최적화)
      const isLockCommand = ['SET', 'EVAL', 'DEL'].includes(commandName) &&
                           args.some(arg => String(arg).includes('product_lock'));

      if (isLockCommand) {
        console.log(`\n🔴 Redis Lock Query: ${commandName} ${args.join(' ')}`);
        console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
      }

      // 원래 명령어 실행
      const result = originalSendCommand.call(this, command);

      // 분산락 명령어 응답만 로깅
      if (isLockCommand) {
        result.then((response) => {
          console.log(`✅ Redis Lock Response: ${JSON.stringify(response)}\n`);
        }).catch((error) => {
          console.log(`❌ Redis Lock Error: ${error.message}\n`);
        });
      }

      return result;
    };
  }

  // 🎯 Prisma 기반 낙관적 락 재고 감소
  async reduceStockOptimistic(
    productId: number,
    quantity: number,
    maxRetries: number = 3,
  ): Promise<{ success: boolean; message: string; finalStock?: number }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `재고 감소 시도 ${attempt}/${maxRetries} - product ID: ${productId}`,
        );

        // 현재 상품 조회 (버전 포함)
        const currentProduct =
          await this.inventoryRepository.findInventoryById(productId);

        if (!currentProduct) {
          return { success: false, message: '상품을 찾을 수 없습니다.' };
        }

        if (currentProduct.stock < quantity) {
          return {
            success: false,
            message: `재고 부족 (현재: ${currentProduct.stock}, 요청: ${quantity})`,
          };
        }

        // Prisma 낙관적 락 업데이트
        const updatedProduct = await this.inventoryRepository.updateProduct(
          productId,
          {
            stock: currentProduct.stock - quantity,
            version: { increment: 1 }, // 버전 자동 증가
          },
        );

        this.logger.log(`재고 감소 성공 - 남은 재고: ${updatedProduct.stock}`);

        return {
          success: true,
          message: '재고 감소 완료',
          finalStock: updatedProduct.stock,
        };
      } catch (error) {
        // Prisma 낙관적 락 충돌 감지
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2025') {
            // Record not found - 버전 충돌 (다른 트랜잭션이 먼저 수정함)
            this.logger.warn(
              `버전 충돌 감지 - 재시도 ${attempt}/${maxRetries}`,
            );

            if (attempt < maxRetries) {
              await this.sleep(Math.random() * 50 + 10);
              continue;
            }
          }
        }

        this.logger.error('재고 감소 중 오류 발생', error);

        if (attempt === maxRetries) {
          throw error;
        }

        await this.sleep(Math.random() * 50 + 10);
      }
    }

    return {
      success: false,
      message: '알 수 없는 오류로 처리 실패',
    };
  }

  async reduceStockPessimistic(
    productId: number,
    quantity: number,
    maxRetries: number = 3,
  ) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.inventoryRepository.reduceStockWithLock(
          productId,
          quantity,
        );
      } catch (error) {
        if (attempt < maxRetries) {
          await this.sleep(Math.random() * 50 + 100);
          this.logger.debug(`재시도 ${attempt}/${maxRetries}`);
          continue;
        }

        return {
          success: false,
          message: `재고 감소 시도 최종 실패 (productId:${productId}): ${error}`,
        };
      }
    }
  }

  // Redis 분산 락
  async reduceStockWithRedisLock(
    productId: number,
    quantity: number,
  ): Promise<{ success: boolean; message: string; finalStock?: number }> {
    const lockKey = `product_lock:${productId}`;
    const lockValue = Date.now().toString();
    const lockTTL = 10000; // 10초

    // 락 획득 시도
    const lockAcquired = await this.lockRedis.set(
      lockKey,
      lockValue,
      'PX', // 밀리초 단위 TTL
      lockTTL,
      'NX', // 키가 없을 때만 설정
    );

    if (!lockAcquired) {
      return {
        success: false,
        message: '다른 요청이 처리 중입니다. 잠시 후 다시 시도해주세요.',
      };
    }

    try {
      this.logger.log(`분산락 획득 성공: ${lockKey}`);

      // 재고 감소 로직 실행
      const result = await this.reduceStockOptimistic(productId, quantity, 1);

      return result;
    } catch (error) {
      this.logger.error(`분산락 처리 중 오류: ${error}`);
      return {
        success: false,
        message: `분산락 처리 중 오류가 발생했습니다: ${error}`,
      };
    } finally {
      // 락 해제 (안전한 해제를 위해 Lua 스크립트 사용)
      await this.releaseLock(lockKey, lockValue);
    }
  }

  // 안전한 락 해제 (Lua 스크립트 사용)
  private async releaseLock(lockKey: string, lockValue: string): Promise<void> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    try {
      const result = await this.lockRedis.eval(
        luaScript,
        1,
        lockKey,
        lockValue,
      );
      if (result === 1) {
        this.logger.log(`분산락 해제 성공: ${lockKey}`);
      } else {
        this.logger.warn(`분산락 해제 실패 - 이미 만료됨: ${lockKey}`);
      }
    } catch (error) {
      this.logger.error(`분산락 해제 중 오류: ${lockKey}`, error);
    }
  }

  async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 재고 조회
  async getStock(productId: number): Promise<number | null> {
    const product = await this.inventoryRepository.findInventoryById(productId);

    return product?.stock ?? null;
  }

  // 상품 생성
  async createProduct(
    name: string,
    price: number,
    initialStock: number,
  ): Promise<Product> {
    return await this.inventoryRepository.create({
      name,
      price,
      stock: initialStock,
    });
  }

  async healthCheck() {
    return await this.inventoryRepository.healthCheck();
  }
}
