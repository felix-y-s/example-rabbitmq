import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    RabbitMQModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('RABBITMQ_URL')!,
        exchanges: [
          {
            name: 'order-exchange',
            type: 'topic',
            options: {
              durable: true,
            },
          },
          {
            name: 'notification-exchange',
            type: 'topic',
            options: {
              durable: true,
            },
          },
          {
            name: 'dlq-exchange',
            type: 'topic',
            options: {
              durable: true,
            }
          },
        ],
        connectionInitOptions: { wait: true }, // NOTE: 연결 완료까지 대기 (안전한 메시지 발송 보장)
        enableControllerDiscovery: true, // NOTE: 컨트롤러 자동 검색 활성화 (데코레이터 기반 핸들러 등록)
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [RabbitMQModule],
})
export class RabbitmqModule {}
