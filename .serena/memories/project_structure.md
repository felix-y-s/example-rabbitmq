# 프로젝트 구조

## 루트 디렉토리
```
example-rabbitmq/
├── src/                   # 소스 코드
├── docs/                  # 프로젝트 문서
├── prisma/                # 데이터베이스 스키마
├── test/                  # 테스트 파일
├── .vscode/               # VS Code 설정
├── .serena/               # Serena MCP 설정
└── .claude/               # Claude 설정
```

## 소스 코드 구조 (src/)
```
src/
├── main.ts               # 애플리케이션 엔트리 포인트
├── app.module.ts         # 루트 모듈
├── app.controller.ts     # 루트 컨트롤러
├── app.service.ts        # 루트 서비스
├── config/               # 설정 파일
│   └── rabbitmq.config.ts
├── database/             # 데이터 접근 계층
│   ├── database.module.ts
│   ├── base.repository.ts
│   └── inventory.repository.ts
├── inventory/            # 재고 관리 모듈
│   ├── inventory.module.ts
│   ├── inventory.controller.ts
│   ├── inventory.service.ts
│   └── dto/
│       ├── create-product.dto.ts
│       └── reduce-stock.dto.ts
├── rabbitmq/             # 메시지 큐 모듈
│   └── rabbitmq.module.ts
└── user/                 # 사용자 모듈 (미구현)
```

## 모듈 구조 패턴
- **Module**: 기능별 모듈 분리
- **Controller**: HTTP 요청 처리
- **Service**: 비즈니스 로직
- **Repository**: 데이터 접근
- **DTO**: 데이터 전송 객체

## 설정 파일
- **nest-cli.json**: NestJS CLI 설정
- **tsconfig.json**: TypeScript 컴파일러 설정
- **eslint.config.mjs**: ESLint 규칙
- **.prettierrc**: 코드 포매팅 규칙

## 문서 구조 (docs/)
- **RabbitMQ_도입_이유_및_아키텍처_분석.md**: RabbitMQ 도입 배경
- **NestJS_RabbitMQ_연동_가이드.md**: 구현 가이드
- **inventory_service_동시성_분석.md**: 동시성 분석