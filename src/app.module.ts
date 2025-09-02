import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 imports 불필요!
      envFilePath: ['.env'],
      validationSchema: envValidationSchema, // Joi 스키마로 환경변수 검증
      validationOptions: {
        allowUnknown: true, // 정의되지 않은 환경변수 허용 (개발 편의성)
        abortEarly: true, // 모든 validation 에러 수집 후 한번에 표시
      },
    }),
    InventoryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
