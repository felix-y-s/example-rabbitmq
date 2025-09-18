import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { InventoryRepository } from '../database/inventory.repository';
import { randomUUID } from 'crypto';
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
    this.lockRedis = this.redisService.getOrThrow('lock');
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

  async reduceStockRedisLock(
    productId: number,
    quantity: number,
    maxRetries: number = 3,
  ): Promise<{
    success: boolean;
    message: string;
    finalStock?: number;
    duration: number;
  }> {
    this.logger.debug(
      `재고 감소 요청(redisLock) productId:${productId}, quantity:${quantity}`,
    );
    const startTime = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const lockKey = 'product-lock:' + productId;
      const lockValue = randomUUID();
      let lockAcquired: 'OK' | null = null;
      try {
        // 레디스 락 획득
        lockAcquired = await this.lockRedis.set(
          lockKey,
          lockValue,
          'PX',
          5000,
          'NX',
        );
        if (lockAcquired) {
          this.logger.debug(
            `분산락 획득 성공: (LockKey: ${lockKey}, LockValue: ${lockValue})`,
          );
        } else {
          throw new Error(`다른 트랜잭션이 작업 중입니다.`);
        }

        const product =
          await this.inventoryRepository.findInventoryById(productId);
        if (product === null) {
          return {
            success: false,
            message: `제품을 확인할 수 없습니다. (productId:${productId})`,
            duration: Date.now() - startTime,
          };
        }
        if (quantity > product.stock) {
          return {
            success: false,
            message: `재고 부족: 요청 수량(${quantity}), 보유 수량(${product.stock})`,
            duration: Date.now() - startTime,
          };
        }

        const updatedProduct = await this.inventoryRepository.updateProduct(
          productId,
          { stock: { increment: -quantity } },
        );

        return {
          success: true,
          message: '재고 감소 성공',
          finalStock: updatedProduct.stock,
          duration: Date.now() - startTime,
        };
      } catch (error) {
        // 예상된 오류로 재시도 조건
        if (
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002') ||
          error.message.includes('다른 트랜잭션이 작업 중입니다.')
        ) {
          // prisma 오류
          if (error instanceof Prisma.PrismaClientKnownRequestError) {
            // 낙관적 락 발생
            if (error.code === 'P2002')
              this.logger.debug(
                `🍏 낙관적 락 발생: (LockKey: ${lockKey}, LockValue: ${lockValue})`,
              );
          }

          // 트랜잭션 락
          if (error.message.includes('다른 트랜잭션이 작업 중입니다.')) {
            this.logger.debug(
              `🍎 다른 트랜잭션이 작업 중: (LockKey: ${lockKey})`,
            );
          }

          this.logger.debug(`재고 감소 재요청(${attempt}/${maxRetries})`);
          await this.sleep(Math.random() * 100 + 50);
          continue;
        }

        // 예상되지 않는 예외 사항은 재시도 하지 않는다.
        throw error;
      } finally {
        if (lockAcquired) this.releaseLock(lockKey, lockValue);
      }
    }

    // 모든 재시도가 실패한 경우
    return {
      success: false,
      message: '재고 감소 최종 실패: 모든 재시도 횟수 소진',
      duration: Date.now() - startTime,
    };
  }

  async releaseLock(lockKey: string, lockValue: string) {
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
        this.logger.debug(
          `분산락 해제 성공: (LockKey: ${lockKey}, LockValue: ${lockValue})`,
        );
      } else {
        this.logger.debug(
          `분산락 해제 실패 - 이미 만료됨: (LockKey: ${lockKey}, LockValue: ${lockValue})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `분산락 해제 중 오류: (LockKey: ${lockKey}, LockValue: ${lockValue})`,
        error,
      );
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
