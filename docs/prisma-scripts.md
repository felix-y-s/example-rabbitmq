# Prisma Scripts 사용 가이드

package.json에 추가된 Prisma 관련 스크립트들의 사용법과 설명

## 🚀 개발 환경 스크립트

### `npm run db:dev`
```bash
prisma dev
```
- **목적**: 로컬 Prisma PostgreSQL 서버 시작
- **포트**: 51213-51215 자동 할당
- **용도**: 개발 중 로컬 DB 서버 구동
- **주의**: 백그라운드에서 계속 실행됨

### `npm run db:studio`
```bash
prisma studio
```
- **목적**: 브라우저 기반 데이터베이스 GUI 도구
- **접속**: http://localhost:5555 (기본)
- **기능**: 데이터 조회, 편집, 삭제 (GUI)
- **용도**: 개발 중 데이터 확인 및 관리

### `npm run db:push`
```bash
prisma db push
```
- **목적**: 스키마 변경사항을 DB에 즉시 반영
- **특징**: 마이그레이션 파일 생성 없음
- **용도**: 프로토타입 단계, 빠른 스키마 테스트
- **주의**: 프로덕션에서는 사용 금지

## 📊 마이그레이션 관리

### `npm run db:migrate`
```bash
prisma migrate dev
```
- **목적**: 새 마이그레이션 생성 및 적용
- **과정**: 스키마 변경 감지 → 마이그레이션 파일 생성 → DB 적용
- **용도**: 개발 중 스키마 변경사항 버전 관리
- **결과**: prisma/migrations/ 폴더에 SQL 파일 생성

### `npm run db:status`
```bash
prisma migrate status
```
- **목적**: 마이그레이션 상태 확인
- **정보**: 적용된/대기중인 마이그레이션 목록
- **용도**: drift 감지, 마이그레이션 문제 진단
- **출력**: 적용 상태, 충돌 여부, 다음 액션 가이드

### `npm run db:reset`
```bash
prisma migrate reset
```
- **목적**: 데이터베이스 완전 초기화
- **과정**: 모든 데이터 삭제 → 마이그레이션 재실행
- **주의**: ⚠️ **모든 데이터 영구 삭제**
- **용도**: 개발 초기, 마이그레이션 문제 해결

## 🚀 배포 관련

### `npm run db:deploy`
```bash
prisma migrate deploy
```
- **목적**: 프로덕션 환경에서 마이그레이션 적용
- **특징**: 새 마이그레이션 생성 없음, 기존 마이그레이션만 적용
- **용도**: CI/CD 파이프라인, 프로덕션 배포
- **안전성**: 프로덕션용으로 설계됨

### `npm run db:generate`
```bash
prisma generate
```
- **목적**: Prisma 클라이언트 코드 재생성
- **타이밍**: 스키마 변경 후, 배포 전
- **결과**: node_modules/@prisma/client 업데이트
- **용도**: 타입 정의 업데이트, 클라이언트 동기화

## 📦 데이터 관리

### `npm run db:seed`
```bash
prisma db seed
```
- **목적**: 시드 데이터 삽입
- **설정**: package.json의 prisma.seed 설정 필요
- **용도**: 개발/테스트 환경 초기 데이터 구성
- **예시**: 기본 사용자, 카테고리, 테스트 상품 등

## 🔄 일반적인 워크플로우

### 개발 시작
```bash
npm run db:dev          # 로컬 서버 시작
npm run db:studio       # 데이터 확인
```

### 스키마 변경
```bash
# schema.prisma 수정 후
npm run db:migrate      # 마이그레이션 생성 및 적용
npm run db:generate     # 클라이언트 재생성
```

### 문제 해결
```bash
npm run db:status       # 상태 확인
npm run db:reset        # 문제 시 초기화
```

### 배포 준비
```bash
npm run db:generate     # 클라이언트 생성
npm run db:deploy       # 프로덕션 적용
```

## ⚠️ 주의사항

- **db:reset**: 모든 데이터 삭제됨
- **db:push**: 마이그레이션 히스토리 없음
- **db:deploy**: 프로덕션 전용
- **db:dev**: 개발 환경에서만 사용