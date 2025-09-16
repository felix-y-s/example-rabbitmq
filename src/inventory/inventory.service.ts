import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { InventoryRepository } from '../database/inventory.repository';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly inventoryRepository: InventoryRepository) {}

  // 🎯 Prisma 기반 낙관적 락 재고 감소
  async reduceStockOptimistic(
    productId: number,
    quantity: number,
    maxRetries: number = 3,
  ): Promise<{ success: boolean; message: string; finalStock?: number }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `재고 감소 시도 ${attempt}/${maxRetries} - product ID: ${productId}`,
        );

        // 현재 상품 조회 (버전 포함)
        const currentProduct =
          await this.inventoryRepository.findInventoryById(productId);

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
        const updatedProduct = await this.inventoryRepository.updateProduct(
          productId,
          {
            stock: currentProduct.stock - quantity,
            version: { increment: 1 }, // 버전 자동 증가
          },
        );

        this.logger.log(`재고 감소 성공 - 남은 재고: ${updatedProduct.stock}`);

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
            this.logger.warn(
              `버전 충돌 감지 - 재시도 ${attempt}/${maxRetries}`,
            );

            if (attempt < maxRetries) {
              await this.sleep(Math.random() * 50 + 10);
              continue;
            }
          }
        }

        this.logger.error('재고 감소 중 오류 발생', error);

        if (attempt === maxRetries) {
          throw error;
        }

        await this.sleep(Math.random() * 50 + 10);
      }
    }

    return {
      success: false,
      message: '알 수 없는 오류로 처리 실패',
    };
  }

  async reduceStockPessimistic(
    productId: number,
    quantity: number,
    maxRetries: number = 3,
  ) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.inventoryRepository.reduceStockWithLock(
          productId,
          quantity,
        );
      } catch (error) {
        if (attempt < maxRetries) {
          await this.sleep(Math.random() * 50 + 100);
          this.logger.debug(`재시도 ${attempt}/${maxRetries}`);
          continue;
        }

        return {
          success: false,
          message: `재고 감소 시도 최종 실패 (productId:${productId}): ${error}`,
        };
      }
    }
  }

  async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 재고 조회
  async getStock(productId: number): Promise<number | null> {
    const product = await this.inventoryRepository.findInventoryById(productId);

    return product?.stock ?? null;
  }

  // 상품 생성
  async createProduct(
    name: string,
    price: number,
    initialStock: number,
  ): Promise<Product> {
    return await this.inventoryRepository.create({
      name,
      price,
      stock: initialStock,
    });
  }

  async healthCheck() {
    return await this.inventoryRepository.healthCheck();
  }
}
