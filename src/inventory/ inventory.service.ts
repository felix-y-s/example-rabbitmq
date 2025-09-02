import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'nestjs-prisma';
import { Prisma } from '@prisma/client';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

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
            version: currentProduct.version, // 낙관적 락 조건
          },
          data: {
            stock: currentProduct.stock - quantity,
            version: { increment: 1 }, // 버전 자동 증가
          },
        });

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

  async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 재고 조회
  async getStock(productId: number): Promise<number | null> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    return product?.stock ?? null;
  }

  // 상품 생성
  async createProduct(
    name: string,
    price: number,
    initialStock: number,
  ): Promise<any> {
    return this.prisma.product.create({
      data: {
        name,
        price,
        stock: initialStock,
      },
    });
  }

  async healthCheck(): Promise<{ database: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        database: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('데이터베이스 연결 실패', error);
      return {
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
