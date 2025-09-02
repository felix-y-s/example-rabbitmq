# 환경변수 Validation 설정 가이드

NestJS ConfigModule + Joi를 사용한 환경변수 검증 시스템

## 📦 설치

```bash
npm install joi
```

## 🔧 설정 단계

### 1. Validation 스키마 생성 (`src/config/env.validation.ts`)

```typescript
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
    .description('데이터베이스 연결 문자열'),

  // 로깅 설정  
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('info'),
});
```

### 2. AppModule에 적용 (`src/app.module.ts`)

```typescript
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // 다른 모듈에서 imports 불필요!
      envFilePath: ['.env'],
      validationSchema: envValidationSchema, // 🎯 스키마 적용
      validationOptions: {
        allowUnknown: true,  // 정의되지 않은 환경변수 허용
        abortEarly: false,   // 모든 에러 수집 후 표시
      },
    }),
  ],
})
```

## 🎯 Validation 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `allowUnknown` | false | 스키마에 없는 환경변수 허용 여부 |
| `abortEarly` | true | 첫 번째 에러에서 중단 vs 모든 에러 수집 |
| `presence` | optional | required/optional/forbidden |
| `stripUnknown` | false | 알 수 없는 키 제거 여부 |

## 🚨 에러 예시

**잘못된 NODE_ENV**:
```
ValidationError: "NODE_ENV" must be one of [development, production, test]
```

**필수값 누락**:
```
ValidationError: "DATABASE_URL" is required
```

**타입 에러**:
```
ValidationError: "PORT" must be a number
```

## 💡 활용 예시

### ConfigService에서 사용
```typescript
@Injectable()
export class MyService {
  constructor(private configService: ConfigService) {}
  
  getDbUrl() {
    // 이미 validation된 값이므로 안전
    return this.configService.get<string>('DATABASE_URL');
  }
}
```

### 환경별 설정
```typescript
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('dev', 'prod').required(),
  
  // 개발환경에서만 허용
  DEBUG_MODE: Joi.when('NODE_ENV', {
    is: 'dev',
    then: Joi.boolean().default(true),
    otherwise: Joi.forbidden()
  }),
});
```

## ⚡ 장점

- **타입 안전성**: 잘못된 환경변수로 런타임 에러 방지
- **명확한 에러**: validation 실패 시 구체적인 메시지
- **기본값 설정**: 누락된 환경변수에 대한 fallback
- **문서화 효과**: 필요한 환경변수 명세서 역할