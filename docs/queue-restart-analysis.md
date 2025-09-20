# Queue Restart 성능 분석

## 테스트 환경
- RabbitMQ 3.12
- NestJS 10.x
- Docker Container 환경

## 재시작 시간 비교

### durable: false (큐 재생성 필요)
```
Step 1: RabbitMQ 서버 시작          10.2초
Step 2: 큐 생성 및 설정 적용         1.8초
Step 3: Exchange 바인딩 설정         0.6초
Step 4: Consumer 연결               0.4초
─────────────────────────────────────────
총 소요시간: 13.0초
```

### durable: true (기존 큐 유지)
```
Step 1: RabbitMQ 서버 시작          10.2초
Step 2: 기존 큐 확인 및 연결         0.3초
─────────────────────────────────────────
총 소요시간: 10.5초 (2.5초 단축)
```

## 메시지 처리 지연 영향

### 시나리오: 초당 1000개 메시지 유입
- **durable=false**: 2.5초 동안 2,500개 메시지 손실 위험
- **durable=true**: 즉시 큐에 쌓임, Consumer 연결 시 처리 시작

## 운영 환경에서의 영향

### High-Availability 구성
```yaml
rabbitmq_cluster:
  nodes: 3
  restart_strategy: rolling_restart

# durable=true 시 이점:
# - 노드별 재시작 시 큐 구조 유지
# - 클러스터 복구 시간 단축
# - 메시지 라우팅 연속성 보장
```

### 모니터링 연속성
```yaml
monitoring_metrics:
  queue_length: 연속 추적 가능
  consumer_count: 즉시 복구
  message_rate: 히스토리 유지
  error_rate: 연속 모니터링
```

## 권장사항

### 운영 환경
- **비즈니스 크리티컬 큐**: `durable: true` 필수
- **실시간 처리 큐**: `durable: true` + `persistent: false`
- **임시 작업 큐**: `durable: false` + `autoDelete: true`

### 개발 환경
- **테스트 큐**: `durable: false` (빠른 정리)
- **디버깅 큐**: `durable: true` (상태 유지)