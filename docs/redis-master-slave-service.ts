// inventory.controller.ts - 마스터/슬레이브 사용 예시

import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@liaoliaots/nestjs-redis';

@Injectable()
export class InventoryController {
  private readonly logger = new Logger(InventoryController.name);

  constructor(private readonly redisService: RedisService) {}

  // 읽기 작업 - 슬레이브 사용
  async getStock(productId: number) {
    try {
      const slaveRedis = this.redisService.getOrThrow('slave');
      const cacheKey = `stock:${productId}`;

      // 슬레이브에서 캐시 조회
      const cachedStock = await slaveRedis.get(cacheKey);
      if (cachedStock !== null) {
        this.logger.log(`슬레이브에서 재고 조회: ${productId}`);
        return parseInt(cachedStock);
      }

      // DB에서 조회 후 마스터에 캐시 저장
      const stock = await this.getStockFromDatabase(productId);

      // 마스터에 캐시 저장
      const masterRedis = this.redisService.getOrThrow('master');
      await masterRedis.setex(cacheKey, 300, stock.toString());

      return stock;
    } catch (error) {
      this.logger.error('재고 조회 중 오류:', error);
      throw error;
    }
  }

  // 쓰기 작업 - 마스터 사용
  async reduceStock(productId: number, quantity: number) {
    try {
      // 재고 감소 로직 실행
      const result = await this.reduceStockInDatabase(productId, quantity);

      if (result.success) {
        // 마스터에서 캐시 무효화
        const masterRedis = this.redisService.getOrThrow('master');
        const cacheKey = `stock:${productId}`;
        await masterRedis.del(cacheKey);

        this.logger.log(`마스터에서 캐시 무효화: ${productId}`);
      }

      return result;
    } catch (error) {
      this.logger.error('재고 감소 중 오류:', error);
      throw error;
    }
  }

  // 헬스체크 - 마스터/슬레이브 상태 확인
  async healthCheck() {
    try {
      const masterRedis = this.redisService.getOrThrow('master');
      const slaveRedis = this.redisService.getOrThrow('slave');

      const masterStatus = await masterRedis.ping();
      const slaveStatus = await slaveRedis.ping();

      return {
        master: masterStatus === 'PONG' ? 'healthy' : 'unhealthy',
        slave: slaveStatus === 'PONG' ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Redis 헬스체크 실패:', error);
      return {
        master: 'error',
        slave: 'error',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async getStockFromDatabase(productId: number): Promise<number> {
    // 실제 데이터베이스에서 재고 조회 로직
    return 0; // 예시
  }

  private async reduceStockInDatabase(productId: number, quantity: number) {
    // 실제 데이터베이스에서 재고 감소 로직
    return { success: true }; // 예시
  }
}