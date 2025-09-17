// Redis 로깅 모듈 - Prisma 스타일 로깅 구현
// ⚠️주의: 메모리 버퍼링, CPU 오버헤드의 문제를 유발하므로 개발 환경에서 짧은 시간 사용만 허용

import { Module, Global, OnModuleInit } from '@nestjs/common';
import { RedisModule, RedisService } from '@liaoliaots/nestjs-redis';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Global()
@Module({})
export class RedisLoggingModule implements OnModuleInit {
  private readonly logger = new Logger('RedisLogger');

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit() {
    // 개발 환경에서만 Redis 쿼리 로깅 활성화
    if (process.env.NODE_ENV === 'development' || process.env.REDIS_LOGGING === 'true') {
      this.setupGlobalRedisLogging();
    }
  }

  private setupGlobalRedisLogging() {
    try {
      // 모든 Redis 네임스페이스에 로깅 적용
      const namespaces = ['cache', 'session', 'lock'];

      namespaces.forEach(namespace => {
        try {
          const redis = this.redisService.getOrThrow(namespace);
          this.addLoggingToRedisClient(redis, namespace);
          this.logger.log(`✅ Redis 로깅 활성화: ${namespace}`);
        } catch (error) {
          this.logger.warn(`⚠️ Redis 네임스페이스 없음: ${namespace}`);
        }
      });
    } catch (error) {
      this.logger.error('Redis 로깅 설정 실패:', error);
    }
  }

  private addLoggingToRedisClient(redis: Redis, namespace: string) {
    const originalSendCommand = redis.sendCommand;

    redis.sendCommand = function(command) {
      const commandName = command.name.toUpperCase();
      const args = command.args || [];
      const startTime = Date.now();

      // Prisma 스타일 로깅
      console.log(`\n🔴 Redis [${namespace}] Query: ${commandName} ${args.join(' ')}`);
      console.log(`⏰ Timestamp: ${new Date().toISOString()}`);

      // 원본 명령어 실행
      const result = originalSendCommand.call(this, command);

      // 응답 및 실행 시간 로깅
      result
        .then((response: any) => {
          const duration = Date.now() - startTime;
          console.log(`✅ Redis [${namespace}] Response: ${JSON.stringify(response)} (${duration}ms)\n`);
        })
        .catch((error: any) => {
          const duration = Date.now() - startTime;
          console.log(`❌ Redis [${namespace}] Error: ${error.message} (${duration}ms)\n`);
        });

      return result;
    };
  }
}

// app.module.ts에서 사용법
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        config: [
          {
            namespace: 'cache',
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
            password: configService.get('REDIS_PASSWORD'),
            db: 0,
          },
          {
            namespace: 'session',
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
            password: configService.get('REDIS_PASSWORD'),
            db: 1,
          },
          {
            namespace: 'lock',
            host: configService.get('REDIS_HOST', 'localhost'),
            port: configService.get('REDIS_PORT', 6379),
            password: configService.get('REDIS_PASSWORD'),
            db: 2,
          },
        ],
      }),
      inject: [ConfigService],
    }),
    RedisLoggingModule, // 👈 글로벌 Redis 로깅 모듈 추가
  ],
})
export class AppModule {}

// .env 파일에서 로깅 제어
// NODE_ENV=development  # 개발 환경에서 자동 활성화
// REDIS_LOGGING=true    # 명시적 로깅 활성화