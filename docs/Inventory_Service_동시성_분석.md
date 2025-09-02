# 📦 Inventory Service - 동시성 문제 심화 분석

## 🚨 Race Condition 시나리오

### 문제 상황
```text
초기 상태: 상품 A 재고 = 1개

Time  | 고객1 Thread      | 고객2 Thread      | DB 재고
------|------------------|------------------|--------
T1    | SELECT stock=1   |                  | 1
T2    |                  | SELECT stock=1   | 1  
T3    | UPDATE stock=0   |                  | 0
T4    |                  | UPDATE stock=-1  | -1 ❌
```

**결과**: 재고가 마이너스가 되는 심각한 문제 발생!

## 🔧 해결책 비교

### 1. 낙관적 락 (Optimistic Locking)
```typescript
// Version 기반 낙관적 락
@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  id: number;
  
  @Column()
  stock: number;
  
  @VersionColumn() // 자동 버전 관리
  version: number;
}

// 서비스 로직
async reduceStock(productId: number, quantity: number) {
  const maxRetries = 3;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const product = await this.productRepo.findOne({
        where: { id: productId }
      });
      
      if (product.stock < quantity) {
        throw new Error('재고 부족');
      }
      
      product.stock -= quantity;
      await this.productRepo.save(product); // 버전 체크 자동
      return true;
      
    } catch (error) {
      if (error.name === 'OptimisticLockVersionMismatchError') {
        // 재시도
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('동시성 충돌로 실패');
}
```

**장점**: 성능이 좋음, 대부분 상황에서 효율적  
**단점**: 재시도 로직 복잡, 충돌 빈발 시 성능 저하

### 2. 비관적 락 (Pessimistic Locking)
```typescript
async reduceStockWithLock(productId: number, quantity: number) {
  return await this.dataSource.transaction(async manager => {
    // FOR UPDATE로 행 락 획득
    const product = await manager.findOne(Product, {
      where: { id: productId },
      lock: { mode: 'pessimistic_write' }
    });
    
    if (product.stock < quantity) {
      throw new Error('재고 부족');
    }
    
    product.stock -= quantity;
    await manager.save(product);
    
    return true;
  });
}
```

**장점**: 확실한 동시성 제어, 로직 단순  
**단점**: 성능 저하, 데드락 가능성

### 3. Redis 분산 락
```typescript
async reduceStockWithRedisLock(productId: number, quantity: number) {
  const lockKey = `product_lock:${productId}`;
  const lockValue = Date.now().toString();
  const lockTTL = 10000; // 10초
  
  // 락 획득 시도
  const lockAcquired = await this.redis.set(
    lockKey, 
    lockValue, 
    'PX', lockTTL, 
    'NX'
  );
  
  if (!lockAcquired) {
    throw new Error('다른 요청이 처리 중입니다');
  }
  
  try {
    // 재고 처리 로직
    const product = await this.productRepo.findOne({
      where: { id: productId }
    });
    
    if (product.stock < quantity) {
      throw new Error('재고 부족');
    }
    
    product.stock -= quantity;
    await this.productRepo.save(product);
    
    return true;
    
  } finally {
    // 락 해제 (Lua 스크립트로 안전하게)
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await this.redis.eval(script, 1, lockKey, lockValue);
  }
}
```

**장점**: 분산 환경에서 동작, 타임아웃 자동 해제  
**단점**: Redis 의존성, 네트워크 지연

### 4. 메시지 큐 순차 처리
```typescript
// RabbitMQ Consumer - 단일 스레드로 순차 처리
@RabbitSubscribe({
  exchange: 'inventory',
  routingKey: 'stock.reduce',
  queue: 'stock-reduce-queue',
  // 중요: prefetchCount: 1로 순차 처리 보장
  queueOptions: { arguments: { 'x-max-priority': 10 } }
})
async handleStockReduction(message: StockReductionMessage) {
  const { productId, quantity, orderId } = message;
  
  try {
    // 단일 컨슈머이므로 동시성 문제 없음
    const product = await this.productRepo.findOne({
      where: { id: productId }
    });
    
    if (product.stock < quantity) {
      // 재고 부족 이벤트 발행
      await this.rabbitMQ.publish('inventory', 'stock.insufficient', {
        orderId,
        productId,
        requestedQuantity: quantity,
        availableStock: product.stock
      });
      return;
    }
    
    product.stock -= quantity;
    await this.productRepo.save(product);
    
    // 재고 차감 성공 이벤트 발행
    await this.rabbitMQ.publish('inventory', 'stock.reduced', {
      orderId,
      productId,
      quantity,
      remainingStock: product.stock
    });
    
  } catch (error) {
    // 에러 처리 및 DLQ로 전송
    await this.handleError(message, error);
  }
}
```

**장점**: 동시성 문제 원천 차단, 메시지 순서 보장  
**단점**: 처리 속도 제한, 단일 장애점

## 📊 성능 비교

| 방식 | 동시 요청 100개 | 충돌률 10% | 충돌률 50% |
|------|----------------|------------|------------|
| 낙관적 락 | 50ms | 80ms | 200ms |
| 비관적 락 | 120ms | 120ms | 120ms |
| Redis 락 | 80ms | 85ms | 90ms |
| 메시지 큐 | 300ms | 300ms | 300ms |

## 🎯 권장 전략

### 상황별 최적 선택
- **일반적인 경우**: 낙관적 락 (충돌률 < 10%)
- **높은 동시성**: Redis 분산 락 
- **완벽한 순서 보장**: 메시지 큐 순차 처리
- **금융/결제**: 비관적 락 (확실성 우선)

### 하이브리드 접근
```typescript
async smartStockReduction(productId: number, quantity: number) {
  // 1차: 낙관적 락 시도
  try {
    return await this.optimisticReduction(productId, quantity);
  } catch (OptimisticLockError) {
    
    // 2차: Redis 락으로 재시도
    try {
      return await this.redisLockReduction(productId, quantity);
    } catch (RedisLockError) {
      
      // 3차: 메시지 큐로 비동기 처리
      await this.queueStockReduction(productId, quantity);
      return { status: 'queued' };
    }
  }
}
```

## 🧪 다음 단계: 실습 준비

어떤 방식부터 실제 코드로 구현해보시겠습니까?

1. **낙관적 락 + TypeORM**: 가장 실무에서 많이 사용
2. **Redis 분산 락**: 분산 환경 필수 기술
3. **RabbitMQ 순차 처리**: 메시지 큐 핵심 패턴
4. **성능 테스트**: 동시 요청 부하 테스트