// Redis Sentinel 클라이언트 설정 - 자동 장애조치

import { Module } from '@nestjs/common';
import { RedisModule, RedisService } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        config: {
          // Sentinel 방식 - 자동 장애조치
          name: 'mymaster', // Sentinel에서 모니터링하는 마스터 이름
          sentinels: [
            { host: 'sentinel-1', port: 26379 },
            { host: 'sentinel-2', port: 26379 },
            { host: 'sentinel-3', port: 26379 },
          ],
          password: configService.get('REDIS_PASSWORD'),

          // 자동 역할 감지
          role: 'master', // 또는 'slave'

          // 장애조치 설정
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          enableOfflineQueue: false,

          // 연결 풀 설정
          lazyConnect: true,
          keepAlive: 30000,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}

/*
 * 서비스에서 사용 - 역할 구분 없이 사용
 */
export class InventoryService {
  constructor(private redisService: RedisService) {}

  // 읽기 작업
  async getStock(productId: number) {
    const redis = this.redisService.getOrThrow(); // Sentinel이 자동으로 적절한 노드 선택
    return await redis.get(`stock:${productId}`);
  }

  // 쓰기 작업
  async setStock(productId: number, stock: number) {
    const redis = this.redisService.getOrThrow(); // Sentinel이 자동으로 마스터 선택
    return await redis.setex(`stock:${productId}`, 300, stock.toString());
  }
}

/*
 * 또는 읽기/쓰기 분리가 필요한 경우
 */
@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        config: [
          // 쓰기 전용 - 마스터 연결
          {
            namespace: 'master',
            name: 'mymaster',
            sentinels: [
              { host: 'sentinel-1', port: 26379 },
              { host: 'sentinel-2', port: 26379 },
              { host: 'sentinel-3', port: 26379 },
            ],
            role: 'master', // 마스터에만 연결
            password: configService.get('REDIS_PASSWORD'),
          },

          // 읽기 전용 - 슬레이브 연결
          {
            namespace: 'slave',
            name: 'mymaster',
            sentinels: [
              { host: 'sentinel-1', port: 26379 },
              { host: 'sentinel-2', port: 26379 },
              { host: 'sentinel-3', port: 26379 },
            ],
            role: 'slave', // 슬레이브에만 연결
            password: configService.get('REDIS_PASSWORD'),
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModuleWithRoleSeparation {}

export class InventoryServiceWithRoles {
  constructor(private redisService: RedisService) {}

  // 읽기 - 슬레이브 사용
  async getStock(productId: number) {
    const slaveRedis = this.redisService.getOrThrow('slave');
    return await slaveRedis.get(`stock:${productId}`);
  }

  // 쓰기 - 마스터 사용
  async setStock(productId: number, stock: number) {
    const masterRedis = this.redisService.getOrThrow('master');
    return await masterRedis.setex(`stock:${productId}`, 300, stock.toString());
  }
}