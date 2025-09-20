# DLQ 없는 상황에서 Nack 분석

## 문제 시나리오

### 현재 설정
```typescript
@RabbitSubscribe({
  exchange: 'order-exchange',
  routingKey: 'order.created',
  queue: 'order-processing-queue',
  queueOptions: {
    durable: true,
    arguments: {
      'x-message-ttl': 60000, // 60초 TTL만 설정
      // ❌ DLQ 설정 없음
    },
  },
})
```

## Nack 동작 분석

### 1. Nack(true) - 무한 재시도
```
시간: 0초   - 메시지 처리 시작
시간: 0.1초 - 에러 발생, Nack(true) 반환
시간: 0.2초 - 메시지 큐 맨 앞으로 이동
시간: 0.3초 - 즉시 다시 처리 시작
시간: 0.4초 - 에러 발생, Nack(true) 반환
...
무한 반복 (CPU 100% 사용)
```

### 2. Nack(false) - 메시지 손실
```
시간: 0초   - 메시지 처리 시작
시간: 0.1초 - 에러 발생, Nack(false) 반환
시간: 0.2초 - 메시지 완전 삭제
결과: 주문 데이터 손실 🚨
```

### 3. TTL 만료
```
시간: 0초   - 메시지 큐에 도착
시간: 60초  - TTL 만료
결과: 메시지 삭제 (DLQ 없으므로)
```

## 위험 요소

### 무한 재시도 (Nack(true))
- **CPU 과부하**: 100% 사용률
- **로그 폭증**: 에러 로그 무한 생성
- **시스템 다운**: 리소스 고갈
- **다른 메시지 처리 불가**: 큐 블로킹

### 메시지 손실 (Nack(false))
- **주문 손실**: 고객 주문이 사라짐
- **재고 불일치**: 재고 차감 후 주문 사라짐
- **매출 손실**: 결제 처리 실패
- **고객 불만**: 주문했는데 처리 안됨

## 해결 방안

### 1. DLQ 추가 (권장)
```typescript
queueOptions: {
  durable: true,
  arguments: {
    'x-message-ttl': 60000,
    'x-dead-letter-exchange': 'dlq-exchange', // DLQ 추가
    'x-dead-letter-routing-key': 'order.failed',
  },
}
```

### 2. Quorum Queue + Delivery Limit
```typescript
queueOptions: {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum',
    'x-delivery-limit': 3, // 3번 재시도 후 DLQ
    'x-dead-letter-exchange': 'dlq-exchange',
  },
}
```

### 3. 애플리케이션 레벨 재시도 제어
```typescript
async handleOrderCreated(@RabbitPayload() message: CreateOrderEvent) {
  const maxRetries = 3;
  const retryCount = message.retryCount || 0;

  try {
    await processOrder(message);
  } catch (error) {
    if (retryCount < maxRetries) {
      // 지연 후 재시도
      setTimeout(() => {
        this.publishRetry(message, retryCount + 1);
      }, 5000); // 5초 지연
      return; // ACK
    } else {
      // 최대 재시도 초과, 로깅 후 ACK
      this.logger.error('최대 재시도 초과:', message);
      return; // ACK (메시지 제거)
    }
  }
}
```

## 권장 설정

### 주문 처리 큐 (중요도: 높음)
```typescript
queueOptions: {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum',
    'x-delivery-limit': 3,
    'x-dead-letter-exchange': 'dlq-exchange',
    'x-dead-letter-routing-key': 'order.failed',
    'x-message-ttl': 300000, // 5분
  },
}
```

### DLQ 처리 큐
```typescript
@RabbitSubscribe({
  exchange: 'dlq-exchange',
  routingKey: 'order.failed',
  queue: 'order-failed-queue'
})
async handleFailedOrder(@RabbitPayload() message: CreateOrderEvent) {
  // 1. 관리자에게 알림
  // 2. 데이터베이스에 실패 기록
  // 3. 수동 처리를 위한 대시보드 표시
}
```