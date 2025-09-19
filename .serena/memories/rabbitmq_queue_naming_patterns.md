# RabbitMQ 큐 네이밍 및 설정 변경 패턴

## 핵심 발견사항

### 큐 불변성 원칙
- **RabbitMQ 큐는 한 번 생성된 후 속성 변경 불가능**
- 설정 변경 시도 시 `PRECONDITION_FAILED` 오류 발생
- Management UI에서 삭제해도 메타데이터 캐싱으로 인한 재사용 문제

### 안전한 큐 변경 전략

#### 1. 버전 관리 패턴 (권장)
```typescript
// 배포별 버전 관리
'order-processing-queue-v1'  // 초기 버전 (기본 설정)
'order-processing-queue-v2'  // TTL 추가 시도 → 실패
'order-processing-queue-v3'  // 기본 설정으로 재설정
```

#### 2. 환경별 네이밍
```typescript
'order-processing-queue-dev'
'order-processing-queue-staging'
'order-processing-queue-prod'
```

#### 3. 날짜 기반 네이밍
```typescript
'order-processing-queue-20250920'
```

### 실제 경험한 오류 패턴

#### 설정 변경 시 오류
```
PRECONDITION_FAILED - inequivalent arg 'x-message-ttl' for queue 'order-processing-queue' 
in vhost '/': received the value '3600000' of type 'signedint' but current is none
```

#### 사용자 권한 오류
```
PRECONDITION_FAILED - user_id property set to 'test' but authenticated user was 'admin'
```

### 해결된 패턴

#### 1. 큐 설정 변경
```typescript
// ❌ 실패: 기존 큐에 새 속성 추가
{
  name: 'order-processing-queue',
  options: {
    durable: true,
    arguments: {
      'x-message-ttl': 3600000  // 기존 큐에 추가 시도
    }
  }
}

// ✅ 성공: 새 버전 큐 생성
{
  name: 'order-processing-queue-v3',
  options: {
    durable: true  // 기본 설정만 사용
  }
}
```

#### 2. Producer/Consumer 동기화
```typescript
// RabbitMQ Module
queues: [{
  name: 'order-processing-queue-v3',  // 새 버전
  exchange: 'order-exchange',
  routingKey: 'order.created'
}]

// Consumer
@RabbitSubscribe({
  exchange: 'order-exchange',
  routingKey: 'order.created',
  queue: 'order-processing-queue-v3',  // 동일한 버전
})
```

#### 3. 메시지 권한 문제
```typescript
// ❌ 실패: userId 설정으로 권한 충돌
{
  persistent: true,
  userId: orderCreatedEvent.customerId,  // 'test' vs 'admin' 충돌
}

// ✅ 성공: userId 제거, 헤더로 대체
{
  persistent: true,
  headers: {
    'x-user-id': orderCreatedEvent.customerId  // 헤더로 전달
  }
}
```

## 점진적 마이그레이션 전략

### Blue-Green 배포 패턴
1. **새 버전 큐 생성 및 Consumer 배포**
2. **트래픽 점진적 이동** (10% → 50% → 100%)
3. **구 버전 안전 제거** (서버 재시작 없이)

### 안전한 구 버전 제거
```bash
# Management UI 또는 CLI로 제거
docker exec rabbitmq rabbitmqctl delete_queue order-processing-queue-v1

# 확인: Ready: 0, Unacked: 0 상태에서만 제거
```

## 서버 재시작 안전성

### Node.js 서버 재시작 시 복구 전략
1. **상태 기반 복구**: Redis에 처리 상태 저장
2. **분산 락**: 중복 처리 방지
3. **멱등성 보장**: 동일 작업 중복 실행 방지
4. **복구 로직**: 서버 시작 시 미완료 작업 재개

### 핵심 패턴
```typescript
// 1. 분산 락 획득
const lockKey = `payment:lock:${orderId}`;
const lockAcquired = await redis.set(lockKey, 'locked', 'PX', 300000, 'NX');

// 2. 상태 저장
await redis.hset(`payment:state:${orderId}`, {
  status: 'processing',
  startedAt: new Date().toISOString()
});

// 3. 멱등성 체크
const existingResult = await redis.hget(stateKey, 'step1Result');
if (existingResult) return JSON.parse(existingResult);
```

## 실무 권장사항

### 1. 처음부터 완벽한 설계
- 필요한 모든 속성을 초기 설계에 포함
- 향후 확장 가능성 고려한 설정

### 2. 큐 이름 재사용 금지
- 설정 변경 시 항상 새로운 버전 이름 사용
- 환경별, 날짜별 구분으로 체계적 관리

### 3. 마이그레이션 체크리스트
- 트래픽 이동 전 충분한 테스트
- 단계별 모니터링과 롤백 계획
- 잔여 메시지 완전 처리 후 구 버전 제거

### 4. 권한 관리
- 메시지 속성에서 사용자 권한 충돌 주의
- 필요시 헤더로 대체하여 권한 문제 회피

## 문서 참조
- `docs/RabbitMQ_서버_재시작_안전성_가이드.md`: 서버 재시작 안전성 상세 가이드
- `docs/큐_마이그레이션_체크리스트.md`: 마이그레이션 체크리스트