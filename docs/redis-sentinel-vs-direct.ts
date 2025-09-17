// Redis 연결 방식 비교: Direct vs Sentinel

import { Module } from '@nestjs/common';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';

// ===== 1. 직접 연결 방식 (현재 프로젝트) =====
@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        config: [
          {
            namespace: 'cache',
            host: configService.get('REDIS_HOST', 'localhost'), // ← 직접 호스트 지정
            port: configService.get('REDIS_PORT', 6379),
            password: configService.get('REDIS_PASSWORD'),
            db: 0,
          },
          {
            namespace: 'session',
            host: configService.get('REDIS_HOST', 'localhost'), // ← 직접 호스트 지정
            port: configService.get('REDIS_PORT', 6379),
            password: configService.get('REDIS_PASSWORD'),
            db: 1,
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DirectConnectionModule {}

// ===== 2. Sentinel 방식 (고가용성) =====
@Module({
  imports: [
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        config: [
          {
            namespace: 'cache',
            // host 없음! ← Sentinel이 동적으로 결정
            name: configService.get('REDIS_MASTER_NAME', 'mymaster'),
            sentinels: [
              {
                host: configService.get('SENTINEL_HOST_1', 'sentinel-1'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
              {
                host: configService.get('SENTINEL_HOST_2', 'sentinel-2'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
              {
                host: configService.get('SENTINEL_HOST_3', 'sentinel-3'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
            ],
            role: 'master', // 마스터에만 연결
            password: configService.get('REDIS_PASSWORD'),
            db: 0,
          },
          {
            namespace: 'session',
            // host 없음! ← Sentinel이 동적으로 결정
            name: configService.get('REDIS_MASTER_NAME', 'mymaster'),
            sentinels: [
              {
                host: configService.get('SENTINEL_HOST_1', 'sentinel-1'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
              {
                host: configService.get('SENTINEL_HOST_2', 'sentinel-2'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
              {
                host: configService.get('SENTINEL_HOST_3', 'sentinel-3'),
                port: configService.get('SENTINEL_PORT', 26379)
              },
            ],
            role: 'master', // 마스터에만 연결
            password: configService.get('REDIS_PASSWORD'),
            db: 1,
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class SentinelConnectionModule {}

/*
 * 환경변수 (.env) 예시
 */

// 직접 연결용 환경변수
// REDIS_HOST=redis-server.example.com
// REDIS_PORT=6379
// REDIS_PASSWORD=your_password

// Sentinel용 환경변수
// REDIS_MASTER_NAME=mymaster
// SENTINEL_HOST_1=sentinel-1.example.com
// SENTINEL_HOST_2=sentinel-2.example.com
// SENTINEL_HOST_3=sentinel-3.example.com
// SENTINEL_PORT=26379
// REDIS_PASSWORD=your_password

/*
 * 동작 차이점
 */

// 직접 연결 방식:
// 클라이언트 → redis-server.example.com:6379 (고정)
// 장애 시 → 수동 복구 필요

// Sentinel 방식:
// 클라이언트 → Sentinel → 현재 마스터 (동적)
// 장애 시 → 자동 장애조치