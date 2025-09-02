import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 속성 제거
      forbidNonWhitelisted: true, // 허용되지 않은 속성 시. 에러
      transform: true,
      disableErrorMessages: false,
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const configService = app.get(ConfigService); // 코드 설명
  const port = configService.get<number>('PORT', 3000);

  await app.listen(process.env.PORT ?? 3000);

  logger.log(`애플리케이션이 포트 ${port}에서 실행 중입니다.`);
  logger.log(`환경: ${process.env.NODE_ENV}`);
  
  // DATABASE_URL에서 호스트 정보 추출
  const databaseUrl = configService.get<string>('DATABASE_URL', '');
  let dbInfo = 'Unknown';
  
  if (databaseUrl.startsWith('prisma+postgres://')) {
    dbInfo = 'Prisma Local Server (localhost:51213-51215)';
  } else if (databaseUrl.includes('localhost')) {
    dbInfo = 'localhost';
  } else {
    try {
      const url = new URL(databaseUrl.replace('prisma+postgres://', 'http://'));
      dbInfo = `${url.hostname}:${url.port || '5432'}`;
    } catch {
      dbInfo = 'Prisma Database';
    }
  }
  
  logger.log(`🗄️ 데이터베이스: ${dbInfo}`);
}
bootstrap();
