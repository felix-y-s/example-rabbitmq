import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // 애플리케이션 환경
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  
  PORT: Joi.number()
    .port()
    .default(3000),

  // 데이터베이스 설정
  DATABASE_URL: Joi.string()
    .required()
    .description('Prisma 데이터베이스 연결 문자열'),

  // 로깅 설정
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),

  // 선택적 환경변수들
  API_PREFIX: Joi.string()
    .default('api'),
    
  CORS_ORIGIN: Joi.string()
    .default('*'),
});