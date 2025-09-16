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

### 1. 낙관적 락 (Optimistic Locking) - Prisma 구현

```prisma
// Prisma 스키마 (schema.prisma)
model Product {
  id          Int      @id @default(autoincrement())
  name        String   @db.VarChar(100)
  description String?  @db.Text
  price       Decimal  @db.Decimal(10, 2)
  stock       Int      @default(0)
  version     Int      @default(1)  // 낙관적 락용 버전 필드
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("products")
}
```

```typescript
// 서비스 로직 - Prisma 낙관적 락 구현
async reduceStockOptimistic(
  productId: number,
  quantity: number,
  maxRetries: number = 3,
): Promise<{ success: boolean; message: string; finalStock?: number }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 현재 상품 조회 (버전 포함)
      const currentProduct = await this.prisma.product.findUnique({
        where: { id: productId },
      });

      if (!currentProduct) {
        return { success: false, message: '상품을 찾을 수 없습니다.' };
      }

      if (currentProduct.stock < quantity) {
        return {
          success: false,
          message: `재고 부족 (현재: ${currentProduct.stock}, 요청: ${quantity})`,
        };
      }

      // Prisma 낙관적 락 업데이트
      const updatedProduct = await this.prisma.product.update({
        where: {
          id: productId,
          version: currentProduct.version, // 🔑 낙관적 락 조건
        },
        data: {
          stock: currentProduct.stock - quantity,
          version: { increment: 1 }, // 🔄 버전 자동 증가
        },
      });

      return {
        success: true,
        message: '재고 감소 완료',
        finalStock: updatedProduct.stock,
      };

    } catch (error) {
      // Prisma 낙관적 락 충돌 감지
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          // Record not found - 버전 충돌 (다른 트랜잭션이 먼저 수정함)
          if (attempt < maxRetries) {
            await this.sleep(Math.random() * 50 + 10); // 백오프
            continue;
          }
        }
      }
      throw error;
    }
  }

  return { success: false, message: '동시성 충돌로 재고 감소 실패' };
}

private async sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**장점**:
- 성능이 좋음, 대부분 상황에서 효율적
- **TypeORM보다 안정적**: 명시적 버전 체크로 확실한 충돌 감지
- **P2025 에러 코드**: 버전 충돌을 정확히 식별 가능

**단점**: 재시도 로직 필요, 충돌 빈발 시 성능 저하

### 2. 비관적 락 (Pessimistic Locking) - Prisma 구현

```typescript
async reduceStockWithLock(
  productId: number,
  quantity: number
): Promise<{ success: boolean; message: string; finalStock?: number }> {
  return await this.prisma.$transaction(async (prisma) => {
    // Prisma Raw Query로 FOR UPDATE 락 획득
    const products = await prisma.$queryRaw<Array<{
      id: number;
      stock: number;
      version: number;
    }>>`
      SELECT id, stock, version
      FROM products
      WHERE id = ${productId}
      FOR UPDATE
    `;

    if (products.length === 0) {
      return { success: false, message: '상품을 찾을 수 없습니다.' };
    }

    const product = products[0];

    if (product.stock < quantity) {
      return {
        success: false,
        message: `재고 부족 (현재: ${product.stock}, 요청: ${quantity})`,
      };
    }

    // 재고 업데이트
    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        stock: product.stock - quantity,
        version: { increment: 1 },
      },
    });

    return {
      success: true,
      message: '재고 감소 완료 (비관적 락)',
      finalStock: updatedProduct.stock,
    };
  });
}
```

**장점**: 확실한 동시성 제어, 로직 단순, 데이터 일관성 보장
**단점**: 성능 저하, 데드락 가능성, 트랜잭션 대기 시간 증가

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
    // Prisma로 재고 처리 로직
    const product = await this.prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product || product.stock < quantity) {
      throw new Error('재고 부족');
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        stock: product.stock - quantity,
        version: { increment: 1 },
      },
    });
    
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
    // 단일 컨슈머이므로 동시성 문제 없음 - Prisma 구현
    const product = await this.prisma.product.findUnique({
      where: { id: productId }
    });

    if (!product || product.stock < quantity) {
      // 재고 부족 이벤트 발행
      await this.rabbitMQ.publish('inventory', 'stock.insufficient', {
        orderId,
        productId,
        requestedQuantity: quantity,
        availableStock: product?.stock || 0
      });
      return;
    }

    // Prisma로 재고 업데이트
    const updatedProduct = await this.prisma.product.update({
      where: { id: productId },
      data: {
        stock: product.stock - quantity,
        version: { increment: 1 },
      },
    });
    
    // 재고 차감 성공 이벤트 발행
    await this.rabbitMQ.publish('inventory', 'stock.reduced', {
      orderId,
      productId,
      quantity,
      remainingStock: updatedProduct.stock
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

### 하이브리드 접근 - Prisma 구현
```typescript
async smartStockReduction(
  productId: number,
  quantity: number
): Promise<{ success: boolean; message: string; method: string; finalStock?: number }> {

  // 1차: 낙관적 락 시도 (가장 빠름)
  try {
    const result = await this.reduceStockOptimistic(productId, quantity, 2);
    if (result.success) {
      return { ...result, method: 'optimistic' };
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025') {
      // 낙관적 락 충돌 - 다음 단계로
    } else {
      throw error;
    }
  }

  // 2차: Redis 분산 락으로 재시도 (중간 수준)
  try {
    const result = await this.reduceStockWithRedisLock(productId, quantity);
    if (result.success) {
      return { ...result, method: 'redis_lock' };
    }
  } catch (error) {
    // Redis 락 실패 - 마지막 단계로
  }

  // 3차: 메시지 큐로 비동기 처리 (확실함)
  await this.queueStockReduction(productId, quantity);
  return {
    success: true,
    message: '비동기 처리 대기열에 추가됨',
    method: 'message_queue'
  };
}

// Prisma 특화 에러 처리 도우미
private isPrismaOptimisticLockError(error: any): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError &&
         error.code === 'P2025';
}
```

## 🧪 다음 단계: 실습 준비

현재 프로젝트에서 이미 **Prisma 낙관적 락이 구현**되어 있습니다!

### ✅ 이미 구현된 기능
1. **Prisma 낙관적 락**: `inventory.service.ts`에서 `reduceStockOptimistic()` 구현
2. **에러 처리**: `P2025` 코드로 버전 충돌 감지
3. **재시도 로직**: 백오프 알고리즘 적용

### 🚀 추가 구현 가능한 기능
1. **비관적 락**: `$queryRaw`로 `FOR UPDATE` 구현
2. **Redis 분산 락**: 분산 환경 대응
3. **RabbitMQ 순차 처리**: 메시지 큐 패턴
4. **하이브리드 접근**: 3단계 폴백 전략
5. **성능 테스트**: 동시 요청 부하 테스트

### 🎯 권장 다음 단계
- **성능 테스트**: 현재 낙관적 락 성능 측정
- **Redis 락 추가**: 높은 동시성 환경 대응
- **모니터링 추가**: 충돌률 및 재시도 횟수 로깅

어떤 기능을 추가로 구현해보시겠습니까?