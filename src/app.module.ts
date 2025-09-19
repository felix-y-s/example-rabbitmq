import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryModule } from './inventory/inventory.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import rabbitmqConfig from './config/rabbitmq.config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from '@liaoliaots/nestjs-redis';
import { OrderModule } from './order/order.module';

@Module({
  imports: [
    OrderModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [rabbitmqConfig], // 설정 파일 로드
      envFilePath: ['.env'],
      validationOptions: {
        allowUnknown: true, // 설명:
        abortEarly: false,
      },
    }),
    DatabaseModule,
    InventoryModule,
    // RabbitMQConfigModule,
    RedisModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        readyLog: true,
        errorLog: true,
        config: [
          {
            namespace: 'cache',
            host: configService.get<string>('REDIS_HOST', 'localhost'),
            port: configService.get<number>('REDIS_PORT', 6379),
            password: configService.get<string>('REDIS_PASSWORD'),
            db: 0,
          },
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
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
