# 개발 명령어 및 스크립트

## 핵심 개발 명령어
### 빌드 및 실행
- `npm run build`: NestJS 애플리케이션 빌드
- `npm run start`: 프로덕션 모드 실행
- `npm run start:dev`: 개발 모드 실행 (watch)
- `npm run start:debug`: 디버그 모드 실행
- `npm run start:prod`: 빌드된 파일로 프로덕션 실행

### 코드 품질
- `npm run lint`: ESLint 실행 및 자동 수정
- `npm run format`: Prettier로 코드 포매팅

### 테스트
- `npm test`: Jest 단위 테스트 실행
- `npm run test:watch`: 테스트 감시 모드
- `npm run test:cov`: 테스트 커버리지 확인
- `npm run test:debug`: 테스트 디버그 모드
- `npm run test:e2e`: E2E 테스트 실행

## 데이터베이스 명령어 (Prisma)
- `npx prisma generate`: Prisma 클라이언트 생성
- `npx prisma migrate dev`: 개발 환경 마이그레이션
- `npx prisma studio`: 데이터베이스 GUI 도구
- `npx prisma db push`: 스키마를 DB에 직접 푸시

## 권장 개발 워크플로우
1. 개발 시작: `npm run start:dev`
2. 코드 작성
3. 테스트: `npm run test:watch`
4. 코드 품질 검사: `npm run lint`
5. 포매팅: `npm run format`
6. 커밋 전 최종 검사: `npm run test:cov`

## 환경 설정
- **.env 파일**: 환경 변수 설정 필요
- **데이터베이스**: PostgreSQL 연결 설정
- **Redis**: 캐싱 및 락 설정
- **RabbitMQ**: 메시지 큐 연결 설정

## 성능 모니터링
- 동시성 테스트: `/inventory/test/concurrent-reduce` 엔드포인트
- 헬스체크: `/inventory/health` 엔드포인트