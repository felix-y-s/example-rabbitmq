// app.module.ts - Redis 마스터/슬레이브 설정 예시
/*
 * Redis 연결 옵션 설명:
 *
 * retryDelayOnFailover: 장애 조치 시 재시도 간격 (밀리초)
 *   - Redis 서버가 응답하지 않을 때 재시도하기 전 대기 시간
 *   - 권장값: 100ms (빠른 복구) ~ 1000ms (안정적 복구)
 *
 * maxRetriesPerRequest: 요청당 최대 재시도 횟수
 *   - 각 Redis 명령이 실패할 때 최대 재시도 횟수
 *   - 권장값: 3회 (균형) ~ 5회 (안정성 우선)
 *   - null: 무제한 재시도 (권장하지 않음)
 *
 * readOnly: 읽기 전용 설정
 *   - true: 쓰기 명령 차단, 읽기만 허용
 *   - 슬레이브 서버에만 설정
 *
 * db: Redis 데이터베이스 번호 지정
 *   - 0~15: 기본적으로 16개 DB 지원
 *   - 마스터와 슬레이브는 같은 DB 번호를 사용해야 복제됨
 *   - 다른 DB 번호 사용 시 독립적인 데이터 공간
 *
 * 주의: 복제 설정은 Redis 서버 설정에서 이루어집니다!
 *       - 슬레이브 서버: replicaof [마스터IP] [마스터포트]
 *       - 마스터 인증: masterauth [마스터비밀번호]
 */

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@liaoliaots/nestjs-redis';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        readyLog: true,
        errorLog: true,
        config: [
          // 마스터 Redis (쓰기 전용)
          {
            namespace: 'master',
            host: configService.get<string>('REDIS_MASTER_HOST', 'localhost'),
            port: configService.get<number>('REDIS_MASTER_PORT', 6379),
            password: configService.get<string>('REDIS_MASTER_PASSWORD'),
            db: 0,
            retryDelayOnFailover: 100, // 장애 조치 시 재시도 간격 (밀리초)
            maxRetriesPerRequest: 3, // 요청당 최대 재시도 횟수
          },
          // 슬레이브 Redis (읽기 전용)
          {
            namespace: 'slave',
            host: configService.get<string>('REDIS_SLAVE_HOST', 'localhost'),
            port: configService.get<number>('REDIS_SLAVE_PORT', 6379),
            password: configService.get<string>('REDIS_SLAVE_PASSWORD'),
            db: 0,
            retryDelayOnFailover: 100, // 장애 조치 시 재시도 간격 (밀리초)
            maxRetriesPerRequest: 3, // 요청당 최대 재시도 횟수
            readOnly: true, // 읽기 전용 설정
          },
          // 세션용 Redis
          {
            namespace: 'session',
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: configService.get<string>('REDIS_PASSWORD'),
            db: 1,
          },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}