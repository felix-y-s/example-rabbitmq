# 기술 스택 및 설정

## 백엔드 프레임워크
- **NestJS 11.0.1**: TypeScript 기반 Node.js 프레임워크
- **Node.js**: ES2023, nodenext 모듈 해상도
- **TypeScript**: 엄격한 타입 검사, 데코레이터 지원

## 데이터베이스
- **PostgreSQL**: 메인 데이터베이스
- **Prisma 6.15.0**: ORM, 마이그레이션, 스키마 관리
- **nestjs-prisma**: NestJS-Prisma 통합

## 캐싱 및 락킹
- **Redis**: 캐싱 및 분산 락
- **@liaoliaots/nestjs-redis 10.0.0**: NestJS-Redis 통합
- **ioredis 5.7.0**: Redis 클라이언트

## 메시지 큐
- **RabbitMQ**: 비동기 메시지 처리
- **@golevelup/nestjs-rabbitmq 6.0.2**: NestJS-RabbitMQ 통합
- **amqplib 0.10.9**: AMQP 프로토콜 구현

## 개발 도구
- **ESLint 9.18.0**: TypeScript ESLint 규칙
- **Prettier**: 코드 포매팅 (singleQuote, trailingComma)
- **Jest**: 테스트 프레임워크
- **Supertest**: E2E 테스트

## 검증 및 변환
- **class-validator**: DTO 유효성 검사
- **class-transformer**: 데이터 변환
- **@nestjs/mapped-types**: DTO 타입 매핑

## 설정
- **@nestjs/config**: 환경 변수 관리
- **ValidationPipe**: 글로벌 유효성 검사
- **CORS**: 크로스 오리진 요청 허용