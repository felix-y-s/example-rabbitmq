// src/rabbitmq/rabbitmq.module.ts
import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        // 🔗 연결 설정 (config 파일에서 가져오기)
        uri: configService.get<string>('rabbitmq.url')!,

        // 🏗️ Exchange 자동 생성
        exchanges: [
          {
            name: 'order-exchange',
            type: 'topic',
            options: {
              durable: true,
            },
          },
        ],

        // 📦 Queue 자동 생성
        queues: [
          {
            name: 'order-processing-queue-v3',
            exchange: 'order-exchange',
            routingKey: 'order.created',
            options: {
              durable: true, // 큐 지속성
              // arguments 제거하여 기본 설정 사용
            },
          },
        ],

        // ⚙️ 연결 옵션
        connectionInitOptions: { wait: false },
        enableControllerDiscovery: true, // 자동 Consumer 검색

        // 🔧 성능 튜닝
        channels: {
          'stock-channel': {
            prefetchCount: configService.get<number>('rabbitmq.prefetchCount'), // 설정 파일에서 가져오기
            default: true,
          },
          'notification-channel': {
            prefetchCount: 100, // 병렬 처리
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [RabbitMQModule],
})
export class RabbitMQConfigModule {}
