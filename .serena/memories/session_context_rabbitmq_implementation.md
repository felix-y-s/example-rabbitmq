# RabbitMQ 구현 세션 컨텍스트

## 현재 프로젝트 상태

### 구현된 컴포넌트
1. **RabbitMQ 설정**: `src/rabbitmq/rabbitmq.module.ts`
   - Exchange: `order-exchange` (topic)
   - Queue: `order-processing-queue-v3` (durable)
   - 기본 설정만 사용 (arguments 제거)

2. **Order Consumer**: `src/order/order.consumer.ts`
   - 큐: `order-processing-queue-v3`
   - 60초 처리 시뮬레이션
   - 에러 시 Nack(true) 반환

3. **Order Service**: `src/order/order.service.ts`
   - Persistent 메시지 발송
   - userId 속성 제거 (권한 충돌 해결)
   - 헤더로 사용자 정보 전달

4. **Order Controller**: `src/order/order.controller.ts`
   - 테스트 엔드포인트: `GET /order/test/rabbitmq`

### 해결된 기술적 문제들

#### 1. 큐 설정 변경 불가 문제
- **증상**: `PRECONDITION_FAILED` 오류
- **원인**: 기존 큐에 새로운 arguments 추가 시도
- **해결**: 새 버전 큐 이름 사용 (`order-processing-queue-v3`)

#### 2. 사용자 권한 충돌
- **증상**: `user_id property set to 'test' but authenticated user was 'admin'`
- **원인**: 메시지 userId와 RabbitMQ 인증 사용자 불일치
- **해결**: userId 속성 제거, 헤더로 대체

#### 3. 로그 출력 문제
- **증상**: debug 레벨 로그 미출력
- **해결**: `logger.debug()` → `logger.log()` 변경

### 현재 설정 스택
```typescript
// Exchange 설정
{
  name: 'order-exchange',
  type: 'topic',
  options: { durable: true }
}

// Queue 설정
{
  name: 'order-processing-queue-v3',
  exchange: 'order-exchange',
  routingKey: 'order.created',
  options: { durable: true }  // 기본 설정만
}

// Consumer 설정
@RabbitSubscribe({
  exchange: 'order-exchange',
  routingKey: 'order.created',
  queue: 'order-processing-queue-v3',
  queueOptions: { durable: true }
})
```

### 추가 구현된 개념 코드

#### 1. Payment Service (`src/payment/payment.service.ts`)
- 다단계 결제 워크플로우 예시
- 상태 기반 복구 메커니즘
- 멱등성 보장 패턴

#### 2. Payment Consumer (`src/payment/payment.consumer.ts`)
- 분산 락을 이용한 중복 처리 방지
- Redis 기반 상태 저장
- 서버 재시작 시 복구 로직

#### 3. Payment Module (`src/payment/payment.module.ts`)
- OnModuleInit을 이용한 자동 복구
- 서버 시작 시 미완료 작업 감지

### 테스트 가능한 시나리오

#### 1. 기본 메시지 처리
```bash
curl http://localhost:3000/order/test/rabbitmq
# → RabbitMQ UI에서 메시지 확인 가능
# → 60초 후 메시지 처리 완료
```

#### 2. 서버 재시작 테스트
```bash
# 1. 메시지 발송
curl http://localhost:3000/order/test/rabbitmq

# 2. 처리 중 서버 재시작
npm run start:dev  # 서버 재시작

# 3. 메시지 복구 확인
# → 처리되지 않은 메시지가 큐에서 다시 처리됨
```

### 다음 세션에서 확장 가능한 영역

1. **Message Persistence 고급 설정**
   - TTL, max-length 등 추가 속성
   - Dead Letter Queue 설정

2. **실제 비즈니스 로직 구현**
   - 재고 관리 시스템 연동
   - 결제 시스템 연동

3. **모니터링 및 메트릭**
   - Prometheus 메트릭 수집
   - 큐 상태 모니터링

4. **고급 패턴 구현**
   - Saga 패턴 구현
   - Event Sourcing 패턴

### 주요 학습 포인트
- RabbitMQ 큐 불변성과 버전 관리의 중요성
- Producer/Consumer 설정 동기화 필요성
- 권한 관리와 메시지 속성 설정 주의사항
- 서버 재시작 안전성을 위한 상태 관리 패턴